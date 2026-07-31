import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CliEntry } from './lib/queue';

export interface FollowUp {
  label: string;
  text: string;
}

export interface CliRowProps {
  entry: CliEntry;
  timeoutMs: number;
  followUps: FollowUp[];
  onRetry: (entry: CliEntry) => void;
  onEdit: (text: string) => void;
  onCancel: (id: string) => void;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// A 47ms tick, live only while active. Drives the in-flight elapsed counter.
function useTick(active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => force((n) => n + 1), 47);
    return () => clearInterval(t);
  }, [active]);
}

function MsCounter({ from, done }: { from: number; done: number | null }) {
  useTick(done == null);
  const ms = (done ?? Date.now()) - from;
  return <span className="font-mono text-[11px] tabular-nums text-cs-text-dim">{ms.toLocaleString('en-US')} ms</span>;
}

export function CliRow({ entry, timeoutMs, followUps, onRetry, onEdit, onCancel }: CliRowProps) {
  const inFlight = entry.state === 'sending';
  const failed = entry.state === 'timeout' || (entry.state === 'error' && entry.error?.kind !== 'refused');
  const isTimeout = entry.state === 'timeout' || entry.error?.kind === 'timeout';
  const isSuperseded = entry.error?.kind === 'superseded';
  const isTransport = entry.error?.kind === 'transport';
  const truncated = entry.reply != null && byteLength(entry.reply) >= 156;

  return (
    <div className={`px-4 py-1.5 ${inFlight ? 'opacity-50' : ''}`}>
      <div className="flex items-baseline gap-2">
        <span className={`shrink-0 font-mono text-[12.5px] ${failed ? 'text-cs-danger' : 'text-cs-accent'}`}>$</span>
        <span
          data-testid="cli-echo"
          className={`min-w-0 flex-1 break-all font-mono text-[12.5px] ${failed ? 'text-cs-danger' : 'text-cs-text'}`}
        >
          {entry.text}
        </span>
        {inFlight ? (
          <span className="flex shrink-0 items-center gap-2">
            <span
              data-testid="cli-cursor"
              className="inline-block animate-pulse bg-cs-accent"
              style={{ width: 7, height: 12 }}
            />
            <MsCounter from={entry.startedAt ?? Date.now()} done={null} />
          </span>
        ) : entry.state === 'sent' ? (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
            sent · no reply expected
          </span>
        ) : entry.state === 'queued' ? (
          <button
            type="button"
            aria-label="Cancel queued command"
            onClick={() => onCancel(entry.id)}
            className="shrink-0 text-cs-text-dim hover:text-cs-danger"
          >
            <X size={12} aria-hidden="true" />
          </button>
        ) : entry.startedAt != null && entry.endedAt != null ? (
          <MsCounter from={entry.startedAt} done={entry.endedAt} />
        ) : null}
      </div>

      {entry.reply != null && entry.reply.length > 0 ? (
        <div className="pl-4 pt-0.5">
          {entry.reply.split('\n').map((line, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: reply lines are positional within immutable text
              key={i}
              className={`whitespace-pre-wrap break-all font-mono text-[12.5px] leading-snug ${/^err/i.test(line) ? 'text-cs-danger' : 'text-cs-text-muted'}`}
            >
              {line}
            </div>
          ))}
          {truncated ? <div className="pt-0.5 text-[10px] text-cs-text-dim">may be truncated by firmware</div> : null}
        </div>
      ) : null}

      {isSuperseded ? (
        <div className="pl-4 pt-1 text-[11px] text-cs-danger">
          cancelled — another client sent a command to this repeater
        </div>
      ) : null}

      {isTimeout ? (
        <div className="flex flex-wrap items-center gap-2 pl-4 pt-1">
          <span className="font-mono text-[11px] text-cs-danger">no reply after {(timeoutMs / 1000).toFixed(0)} s</span>
          {entry.cmd?.serialOnly ? (
            <span className="text-[11px] text-cs-text-dim">— this command is serial-console only</span>
          ) : null}
          <button
            type="button"
            onClick={() => onRetry(entry)}
            className="flex items-center gap-1 rounded border border-cs-danger/30 bg-cs-danger/15 px-1.5 py-0.5 text-[10px] text-cs-danger"
          >
            <RefreshCw size={10} aria-hidden="true" />
            Retry
          </button>
          <button
            type="button"
            onClick={() => onEdit(entry.text)}
            className="text-[10px] text-cs-text-dim underline-offset-2 hover:text-cs-text-muted hover:underline"
          >
            edit and resend
          </button>
        </div>
      ) : null}

      {isTransport ? (
        <div className="flex flex-wrap items-center gap-2 pl-4 pt-1">
          <span className="font-mono text-[11px] text-cs-danger">{entry.error?.message}</span>
          <button
            type="button"
            onClick={() => onRetry(entry)}
            className="flex items-center gap-1 rounded border border-cs-danger/30 bg-cs-danger/15 px-1.5 py-0.5 text-[10px] text-cs-danger"
          >
            <RefreshCw size={10} aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : null}

      {followUps.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-4 pt-1.5">
          {followUps.map((f) => (
            <span key={f.text} className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">{f.label}</span>
              <button
                type="button"
                onClick={() => onEdit(f.text)}
                className="rounded border border-cs-border bg-cs-bg-3 px-1.5 py-0.5 font-mono text-[11px] text-cs-text-muted hover:border-cs-accent/40 hover:text-cs-accent"
              >
                {f.text}
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
