import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { Contact, MessageHop, MessagePath } from '../../../shared/types';
import { cn } from '../../lib/utils';
import { HopAvatar } from './HopAvatar';
import { PathTimeline } from './PathTimeline';
import { candidatesFor } from './resolveRepeater';
import { fmtSnr, SignalBars, snrTokenVar } from './SignalBars';

export function PathItem({
  path,
  knownRepeaters,
  open,
  onToggle,
  onHopClick,
  onSelectCandidate,
}: {
  path: MessagePath;
  knownRepeaters: Contact[];
  open: boolean;
  onToggle: () => void;
  onHopClick?: (hop: MessageHop) => void;
  onSelectCandidate?: (hop: MessageHop, contact: Contact) => void;
}) {
  const lastRepeater = path.hops[path.hops.length - 2] ?? path.hops[path.hops.length - 1];
  const lastRepeaterMatch = lastRepeater.kind === 'hop' ? candidatesFor(lastRepeater, knownRepeaters)[0] : null;
  const lastRepeaterLabel = lastRepeaterMatch?.name ?? (lastRepeater.unnamed ? null : (lastRepeater.name ?? null));
  const hopCount = path.hops.filter((h) => h.kind === 'hop').length;
  const conflictCount = useMemo(() => {
    return path.hops.reduce((n, h) => {
      if (h.kind !== 'hop') return n;
      const cands = candidatesFor(h, knownRepeaters);
      return cands.length > 1 ? n + 1 : n;
    }, 0);
  }, [path.hops, knownRepeaters]);

  return (
    <div className="border-t border-cs-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 px-1 py-2 text-left transition-colors',
          open ? 'bg-cs-bg-3' : 'hover:bg-cs-bg-3/60',
        )}
      >
        <span className="inline-flex w-3 shrink-0 text-cs-text-dim" aria-hidden>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <HopAvatar hop={lastRepeater} size={24} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-cs-text">{lastRepeaterLabel ?? 'Unknown repeater'}</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-cs-text-dim">
            <span>{hopCount} hops</span>
            <span aria-hidden>·</span>
            <span title="Bytes of each hop's pubkey carried in the routing path">{path.hashMode}-byte path</span>
            {conflictCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5 text-cs-warn">
                  <AlertTriangle size={10} aria-hidden />
                  {conflictCount}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <SignalBars snr={path.finalSnr} />
          <span className="font-mono text-[10px]" style={{ color: `rgb(var(${snrTokenVar(path.finalSnr)}))` }}>
            {fmtSnr(path.finalSnr)}
          </span>
        </div>
      </button>
      {open && (
        <PathTimeline
          hops={path.hops}
          knownRepeaters={knownRepeaters}
          onHopClick={onHopClick}
          onSelectCandidate={onSelectCandidate}
        />
      )}
    </div>
  );
}
