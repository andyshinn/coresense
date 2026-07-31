import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CLI_BY_NAME, type CliCommand } from '../../../shared/repeater-cli/catalog';
import type { Contact, RepeaterAdminSession } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { type CliGuest, CliPrompt } from './cli/CliPrompt';
import type { FollowUp } from './cli/CliRow';
import { CliTranscript } from './cli/CliTranscript';
import { parseCliLine } from './cli/lib/parse';
import { type CliHistoryEntry, loadHistory, saveHistory } from './cli/lib/persistence';
import { abortAll, beginNext, type CliEntry, type CliQueueState, cancel, enqueue, settle } from './cli/lib/queue';
import { type CliSuggestCtx, deriveRecent, extractNodeValue } from './cli/lib/suggest';
import { armReboot, markRebootSent, type RebootPendingState, RebootStrip } from './cli/RebootPending';

interface Props {
  contact: Contact;
  client: ApiClient | null;
  session: RepeaterAdminSession | null;
  sessionChecked: boolean;
  pending: RebootPendingState;
  onPending: (next: RebootPendingState) => void;
}

const CLI_TIMEOUT_MS = 30_000;
let seq = 0;
const newId = () => `cli-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// Phase 2 best-effort classification (phase 3 replaces this with server codes).
function classify(err: Error): CliEntry['error'] {
  const msg = err.message;
  if (/superseded by newer CLI command/i.test(msg)) return { kind: 'superseded', message: msg };
  if (/timeout|no reply|timed out/i.test(msg)) return { kind: 'timeout', message: msg };
  return { kind: 'transport', message: msg };
}

export function CliTab({ contact, client, session, sessionChecked, pending, onPending }: Props) {
  const radioSettings = useStore((s) => s.radioSettings);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  const hops = Math.max(1, contact.hops ?? 1);

  const [queue, setQueue] = useState<CliQueueState>({ entries: [] });
  const [history, setHistory] = useState<CliHistoryEntry[]>(() => loadHistory(contact.publicKeyHex));
  const [nodeValues, setNodeValues] = useState<Record<string, string>>({});
  const [lineToSet, setLineToSet] = useState<{ text: string; nonce: number } | null>(null);
  const sendingRef = useRef(false);

  const guest: CliGuest = !sessionChecked ? 'checking' : session?.role === 'admin' ? 'admin' : 'guest';
  const ctx: CliSuggestCtx = useMemo(() => ({ recent: deriveRecent(history), nodeValues }), [history, nodeValues]);
  const queuedCount = queue.entries.filter((e) => e.state === 'queued').length;

  const patchStatus = useCallback(
    (text: string, status: CliHistoryEntry['status']) => {
      setHistory((h) => {
        const idx = [...h].reverse().findIndex((e) => e.text === text);
        if (idx === -1) return h;
        const at = h.length - 1 - idx;
        const next = h.map((e, i) => (i === at ? { ...e, status } : e));
        saveHistory(contact.publicKeyHex, next);
        return next;
      });
    },
    [contact.publicKeyHex],
  );

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') return;
      const cmd =
        CLI_BY_NAME[trimmed] ??
        (parseCliLine(trimmed, trimmed.length).mode === 'arg'
          ? (parseCliLine(trimmed, trimmed.length) as { cmd: CliCommand }).cmd
          : null);
      // History is pushed on submit (so ↑ recalls immediately); status patched at settle.
      setHistory((h) => {
        if (h[h.length - 1]?.text === trimmed) return h; // collapse consecutive dupes
        const next = [...h, { text: trimmed, status: 'sent' as const }].slice(-200);
        saveHistory(contact.publicKeyHex, next);
        return next;
      });
      const entry: CliEntry = {
        id: newId(),
        text: trimmed,
        cmd,
        state: 'queued',
        queuedAt: Date.now(),
        startedAt: null,
        endedAt: null,
        reply: null,
        error: null,
      };
      setQueue((q) => enqueue(q, entry));
    },
    [contact.publicKeyHex],
  );

  // Drain: start the next entry whenever nothing is sending.
  useEffect(() => {
    if (sendingRef.current || !client) return;
    const { state, next } = beginNext(queue);
    if (!next) return;
    sendingRef.current = true;
    setQueue(state);
    void (async () => {
      try {
        const res = await api.repeaterCli(client, contact.key, next.text);
        const refused = /^err/i.test(res.reply.trim());
        setQueue((q) =>
          settle(q, next.id, {
            state: refused ? 'error' : 'ok',
            reply: res.reply,
            endedAt: Date.now(),
            error: refused ? { kind: 'refused', message: res.reply } : null,
          }),
        );
        patchStatus(next.text, refused ? 'error' : 'ok');
        if (!refused && next.cmd?.key && next.cmd.name.startsWith('get ')) {
          const v = extractNodeValue(next.cmd, res.reply);
          if (v != null) setNodeValues((nv) => ({ ...nv, [next.cmd?.key as string]: v }));
        }
        // Reboot-pending: arm on a reboot-required set reaching ok; mark sent
        // when the reboot command itself settles. NOTE §6 also arms on `sent`,
        // but the `sent` terminal (reboot+noReply commands) only exists once
        // phase 3's drain lands (phase-3 Task 5); wire arm-on-`sent` there so a
        // reboot+noReply command is not silently lost.
        if (!refused && next.cmd?.reboot && next.cmd.name.startsWith('set ')) onPending(armReboot(pending, next.cmd));
        if (!refused && (next.text === 'reboot' || next.text === 'clkreboot'))
          onPending(markRebootSent(pending, Date.now()));
      } catch (err) {
        const error = classify(err as Error);
        setQueue((q) =>
          settle(q, next.id, { state: error?.kind === 'timeout' ? 'timeout' : 'error', endedAt: Date.now(), error }),
        );
        patchStatus(next.text, error?.kind === 'timeout' ? 'timeout' : 'error');
      } finally {
        sendingRef.current = false;
      }
    })();
  }, [queue, client, contact.key, patchStatus, onPending, pending]);

  // Abort the queue on unmount / repeater switch: move every non-terminal entry
  // (including a sending one) to cancelled so beginNext can never wedge. The
  // in-flight fetch itself is orphaned — no signal on today's transport (§2.5).
  useEffect(() => () => setQueue((q) => abortAll(q)), []);

  const onClear = useCallback(() => setQueue({ entries: [] }), []);
  const onCancel = useCallback((id: string) => setQueue((q) => cancel(q, id)), []);
  const onRetry = useCallback((entry: CliEntry) => submit(entry.text), [submit]);
  const onEdit = useCallback((text: string) => setLineToSet({ text, nonce: Date.now() }), []);

  const followUpsFor = useCallback(
    (entry: CliEntry): FollowUp[] => {
      const out: FollowUp[] = [];
      const cmd = entry.cmd;
      if (entry.state === 'ok' && cmd?.key && cmd.name.startsWith('get ')) {
        const setName = Object.values(CLI_BY_NAME).find((c) => c.key === cmd.key && c.name.startsWith('set '))?.name;
        const value = nodeValues[cmd.key];
        if (setName && value) out.push({ label: 'Change this value', text: `${setName} ${value}` });
      }
      if (entry.state === 'ok' && cmd?.reboot && cmd.name.startsWith('set '))
        out.push({ label: 'Apply with', text: 'reboot' });
      return out;
    },
    [nodeValues],
  );

  return (
    <div className="flex h-full flex-col">
      <RebootStrip
        pending={pending}
        onRunVerify={(verify) => submit(verify)}
        onRebootNow={() => submit('reboot')}
        onDismiss={() => onPending({ ...pending, dismissed: true })}
      />
      <CliTranscript
        entries={queue.entries}
        timeoutMs={CLI_TIMEOUT_MS}
        followUpsFor={followUpsFor}
        onRetry={onRetry}
        onEdit={onEdit}
        onCancel={onCancel}
      />
      <CliPrompt
        history={history}
        ctx={ctx}
        radioSettings={radioSettings}
        hops={hops}
        guest={guest}
        queuedCount={queuedCount}
        onSubmit={submit}
        onClearTranscript={onClear}
        onLoginAsAdmin={() => setRepeaterAdminTab('login')}
        lineToSet={lineToSet}
      />
    </div>
  );
}
