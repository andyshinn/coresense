import { AlertTriangle } from 'lucide-react';
import type { Contact, MessageHop } from '../../../shared/types';
import { fmtAgoShort } from '../../lib/time';
import { cn } from '../../lib/utils';
import { fmtSnr, snrTokenVar } from './SignalBars';

export function ConflictPanel({ hop, candidates }: { hop: MessageHop; candidates: Contact[] }) {
  return (
    <div className="mt-2 rounded border border-cs-warn/40 bg-cs-warn/5 px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-cs-warn">
        <AlertTriangle size={11} aria-hidden />
        <span>
          {candidates.length} Prefix <code className="rounded bg-cs-bg-3 px-1 text-cs-text">{hop.shortId}</code> conflicts
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {candidates.map((c) => {
          const lastSeenLabel = c.lastSeenMs ? fmtAgoShort(c.lastSeenMs) : '—';
          const stale = c.lastSeenMs ? Date.now() - c.lastSeenMs > 7 * 24 * 3600 * 1000 : false;
          const snr = c.snr ?? null;
          return (
            <div key={c.key} className="flex items-center gap-2 rounded border border-transparent px-2 py-1 text-cs-text">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', stale ? 'bg-cs-text-dim' : 'bg-cs-online')} />
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-[12px] font-medium', stale && 'opacity-70')}>{c.name}</div>
                <div className="mt-px flex items-center gap-1.5 font-mono text-[10px] text-cs-text-dim">
                  <span className="truncate">{c.publicKeyHex.slice(0, 16)}…</span>
                  <span aria-hidden>·</span>
                  <span>{lastSeenLabel}</span>
                </div>
              </div>
              {snr != null && (
                <span className="font-mono text-[10px]" style={{ color: `rgb(var(${snrTokenVar(snr)}))` }}>
                  {fmtSnr(snr)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-cs-text-dim">
        MeshCore identifies repeaters by the first byte(s) of their public key, so any of these could have relayed it.
      </p>
    </div>
  );
}
