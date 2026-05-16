import { useRef, useState } from 'react';
import type { Contact } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

interface Entry {
  id: string;
  command: string;
  reply: string | null;
  error: string | null;
  ts: number;
}

const SUGGESTIONS = ['get acl', 'discover.neighbors'];

export function CliTab({ contact, client }: Props) {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const histRef = useRef<HTMLDivElement | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || busy || command.trim().length === 0) return;
    const cmd = command.trim();
    setCommand('');
    setBusy(true);
    const id = `cli-${Date.now().toString(36)}`;
    const entry: Entry = { id, command: cmd, reply: null, error: null, ts: Date.now() };
    setHistory((h) => [...h, entry]);
    try {
      const res = await api.repeaterCli(client, contact.key, cmd);
      setHistory((h) => h.map((x) => (x.id === id ? { ...x, reply: res.reply } : x)));
    } catch (err) {
      setHistory((h) => h.map((x) => (x.id === id ? { ...x, error: (err as Error).message } : x)));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        histRef.current?.scrollTo({ top: histRef.current.scrollHeight });
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={histRef} className="flex-1 overflow-auto p-4 font-mono text-[12px]">
        {history.length === 0 && (
          <p className="text-cs-text-dim">
            Type a repeater CLI command (e.g.{' '}
            {SUGGESTIONS.map((s, i) => (
              <span key={s}>
                {i > 0 ? ', ' : ''}
                <button
                  type="button"
                  onClick={() => setCommand(s)}
                  className="rounded bg-cs-bg-3 px-1 hover:bg-cs-accent-soft/30"
                >
                  {s}
                </button>
              </span>
            ))}
            ).
          </p>
        )}
        {history.map((e) => (
          <div key={e.id} className="mb-3">
            <div className="text-cs-accent">$ {e.command}</div>
            {e.reply !== null && <pre className="whitespace-pre-wrap text-cs-text">{e.reply}</pre>}
            {e.error !== null && (
              <pre className="whitespace-pre-wrap text-cs-error">error: {e.error}</pre>
            )}
            {e.reply === null && e.error === null && (
              <span className="text-cs-text-dim">waiting…</span>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 gap-2 border-t border-cs-border bg-cs-bg-2 p-2"
      >
        <span className="self-center font-mono text-[12px] text-cs-text-muted">$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="repeater command"
          disabled={!client || busy}
          className="flex-1 rounded border border-cs-border bg-cs-bg px-2 py-1 font-mono text-[12px] text-cs-text"
        />
        <button
          type="submit"
          disabled={!client || busy || command.trim().length === 0}
          className="rounded border border-cs-border bg-cs-accent-soft/30 px-3 py-1 text-[12px] text-cs-text hover:bg-cs-accent-soft/50 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Run'}
        </button>
      </form>
    </div>
  );
}
