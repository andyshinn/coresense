import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CLI_BY_NAME } from '../../../shared/repeater-cli/catalog';
import type { Contact, RepeaterAdminSession } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { type CliGuest, CliPrompt } from './cli/CliPrompt';
import type { FollowUp } from './cli/CliRow';
import { CliTranscript } from './cli/CliTranscript';
import { resolveCommand } from './cli/lib/parse';
import { type CliHistoryEntry, loadHistory, patchStatusById, pushHistory, saveHistory } from './cli/lib/persistence';
import { abortAll, beginNext, type CliEntry, type CliQueueState, cancel, enqueue, settle } from './cli/lib/queue';
import { settlePatchForError, settlePatchForReply } from './cli/lib/send';
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

export function CliTab({ contact, client, session, sessionChecked, pending, onPending }: Props) {
  const radioSettings = useStore((s) => s.radioSettings);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  const hops = Math.max(1, contact.hops ?? 1);

  const [queue, setQueue] = useState<CliQueueState>({ entries: [] });
  const [history, setHistory] = useState<CliHistoryEntry[]>(() => loadHistory(contact.publicKeyHex));
  const [nodeValues, setNodeValues] = useState<Record<string, string>>({});
  const [lineToSet, setLineToSet] = useState<{ text: string; nonce: number } | null>(null);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  // One controller per in-flight send; aborted by the unmount/switch cleanup so
  // the main-process pendingCli entry is cleared instead of stranded for the full
  // 30s timeout (§7.1). Deliberately a ref, not queue state — queue state stays
  // pure/serialisable (§2.5).
  const abortRef = useRef<AbortController | null>(null);

  const guest: CliGuest = !sessionChecked ? 'checking' : session?.role === 'admin' ? 'admin' : 'guest';
  const ctx: CliSuggestCtx = useMemo(() => ({ recent: deriveRecent(history), nodeValues }), [history, nodeValues]);
  const queuedCount = queue.entries.filter((e) => e.state === 'queued').length;

  // Patch by the submit's stable id — shared with the queue entry — so a
  // command queued more than once settles onto its own history line instead of
  // the newest line with the same text (which left earlier duplicates stuck at
  // `sent` and skewed deriveRecent).
  const patchStatus = useCallback(
    (id: string, status: CliHistoryEntry['status']) => {
      setHistory((h) => {
        const next = patchStatusById(h, id, status);
        if (next === h) return h; // id not found (collapsed/aged out) — nothing to persist
        saveHistory(contact.publicKeyHex, next);
        return next;
      });
    },
    [contact.publicKeyHex],
  );

  const submit = useCallback(
    (text: string) => {
      if (guest !== 'admin') return; // §8: only an admin session may send (covers RebootStrip + retry, not just the prompt)
      const trimmed = text.trim();
      if (trimmed === '') return;
      const cmd = resolveCommand(trimmed);
      const id = newId();
      // History is pushed on submit (so ↑ recalls immediately); status patched
      // at settle by this same id, which the queue entry below also carries.
      setHistory((h) => {
        const next = pushHistory(h, { text: trimmed, status: 'sent' as const, id });
        saveHistory(contact.publicKeyHex, next);
        return next;
      });
      const entry: CliEntry = {
        id,
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
    [contact.publicKeyHex, guest],
  );

  // Drain: start the next entry whenever nothing is sending.
  useEffect(() => {
    if (sendingRef.current || !client) return;
    const { state, next } = beginNext(queue);
    if (!next) return;
    sendingRef.current = true;
    setQueue(state);
    void (async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const expectReply = !next.cmd?.noReply; // fire-and-forget for noReply cmds
      try {
        const res = await api.repeaterCli(client, contact.key, next.text, {
          expectReply,
          signal: ctrl.signal,
        });
        const patch = settlePatchForReply(res, Date.now());
        setQueue((q) => settle(q, next.id, patch));
        patchStatus(next.id, patch.state as CliHistoryEntry['status']);
        const refused = patch.error?.kind === 'refused';
        // Node value only exists on a reply-bearing settle (never on `sent`).
        if (!refused && patch.reply != null && next.cmd?.key && next.cmd.name.startsWith('get ')) {
          const v = extractNodeValue(next.cmd, patch.reply);
          if (v != null) setNodeValues((nv) => ({ ...nv, [next.cmd?.key as string]: v }));
        }
        // §6: arm reboot-pending on a reboot-required `set` that reaches a
        // SUCCESS terminal — this branch now runs for BOTH `ok` (reply) and
        // `sent` (no-reply), because api.repeaterCli resolves for both. No
        // state check needed: error/timeout go to catch and never reach here;
        // a refused reply is gated out.
        if (mountedRef.current && !refused && next.cmd?.reboot && next.cmd.name.startsWith('set '))
          onPending(armReboot(pending, next.cmd));
        // §6 observable win: `reboot`/`clkreboot` are noReply → now settle
        // `sent` (Phase 2 timed out here and this never fired). markRebootSent
        // finally runs.
        if (mountedRef.current && !refused && (next.text === 'reboot' || next.text === 'clkreboot'))
          onPending(markRebootSent(pending, Date.now()));
      } catch (err) {
        if (ctrl.signal.aborted) return; // abortAll already moved this entry to cancelled
        const patch = settlePatchForError(err, Date.now());
        setQueue((q) => settle(q, next.id, patch));
        patchStatus(next.id, patch.state as CliHistoryEntry['status']);
      } finally {
        sendingRef.current = false;
      }
    })();
  }, [queue, client, contact.key, patchStatus, onPending, pending]);

  // Abort the queue on unmount / repeater switch: abort the live send first —
  // which clears the main-process pendingCli entry (§7.1) instead of leaving
  // it registered for the full timeout — then move every non-terminal entry
  // (including a sending one) to cancelled so beginNext can never wedge. Also
  // flip mountedRef so the orphaned continuation can't call the PARENT's
  // shared onPending after this CliTab (and its repeater) is gone — otherwise
  // a reboot-required set that settles just after a repeater switch would
  // arm/mark-sent reboot-pending for whichever repeater is now mounted.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      mountedRef.current = false;
      setQueue((q) => abortAll(q));
    },
    [],
  );

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
