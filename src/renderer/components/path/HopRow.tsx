import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { Contact, MessageHop } from '../../../shared/types';
import { cn } from '../../lib/utils';
import { ConflictPanel } from './ConflictPanel';
import { HopAvatar } from './HopAvatar';
import { candidatesFor } from './resolveRepeater';

export function HopRow({
  hop,
  hopIndex,
  isLast,
  knownRepeaters,
  conflictOpen,
  onToggleConflict,
  onHopClick,
  onSelectCandidate,
}: {
  hop: MessageHop;
  hopIndex: number | null;
  isLast: boolean;
  knownRepeaters: Contact[];
  conflictOpen: boolean;
  onToggleConflict: () => void;
  onHopClick?: (hop: MessageHop) => void;
  onSelectCandidate?: (hop: MessageHop, contact: Contact) => void;
}) {
  const AVATAR = 28;
  const ROW_PAD = 10;
  const candidates = hop.kind === 'hop' ? candidatesFor(hop, knownRepeaters) : [];
  const hasConflict = candidates.length > 1;
  const resolved = candidates[0] ?? null;
  const displayName = resolved ? resolved.name : hop.unnamed ? null : (hop.name ?? null);
  const displayPk = resolved ? resolved.publicKeyHex : (hop.pk ?? null);
  const showAsUnnamed = !resolved && hop.unnamed;

  const rowProps = onHopClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: () => onHopClick(hop),
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onHopClick(hop);
          }
        },
      }
    : {};
  return (
    <div className="relative">
      <div
        {...rowProps}
        className={cn(
          'relative flex w-full gap-2.5 rounded text-left transition-colors',
          onHopClick ? 'cursor-pointer hover:bg-cs-bg-3' : '',
        )}
        style={{ padding: `${ROW_PAD}px 0` }}
      >
        {!isLast && (
          <span
            aria-hidden
            className="absolute z-0 bg-cs-border"
            style={{
              left: AVATAR / 2 - 0.5,
              top: ROW_PAD + AVATAR / 2,
              bottom: -ROW_PAD,
              width: 1,
            }}
          />
        )}
        <span className="relative z-10">
          <HopAvatar hop={hop} size={AVATAR} />
        </span>
        <div className="relative z-10 min-w-0 flex-1 pt-0.5">
          <div
            className={cn('truncate text-[12.5px]', showAsUnnamed ? 'italic text-cs-text-dim' : 'font-medium text-cs-text')}
          >
            {showAsUnnamed ? 'Unknown repeater' : (displayName ?? 'Unknown repeater')}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-cs-text-dim">
            {hop.kind === 'origin' && 'Sent the message'}
            {hop.kind === 'sink' && 'You received the message'}
            {hop.kind === 'hop' &&
              (showAsUnnamed
                ? `Hop ${hopIndex} · prefix ${hop.shortId} · no advert seen`
                : `Hop ${hopIndex} · ${displayPk ?? hop.shortId}`)}
          </div>
          {hop.kind === 'hop' && hasConflict && (
            <div className="mt-1 flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleConflict();
                }}
                aria-expanded={conflictOpen}
                aria-label={`${candidates.length} repeaters match this prefix — click to resolve`}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded border border-cs-warn/40 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-cs-warn transition-colors',
                  conflictOpen ? 'bg-cs-warn/10' : 'hover:bg-cs-warn/10',
                )}
              >
                <AlertTriangle size={9} aria-hidden />
                <span>{candidates.length} known repeaters</span>
                <span aria-hidden className="ml-0.5 inline-flex opacity-70">
                  {conflictOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                </span>
              </button>
            </div>
          )}
          {hop.kind === 'hop' && hasConflict && conflictOpen && (
            <ConflictPanel hop={hop} candidates={candidates} onSelectCandidate={onSelectCandidate} />
          )}
        </div>
      </div>
    </div>
  );
}
