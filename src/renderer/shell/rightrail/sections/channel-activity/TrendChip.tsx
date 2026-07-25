import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../../../../lib/utils';

/** Δ vs the previous equal period. Direction only — green/coral are a sign, not a
 *  verdict, so there is deliberately no alarm styling on a decline. Render this
 *  only when trendPct() returned a number; a null trend has no chip at all. */
export function TrendChip({ pct, showVsPrev }: { pct: number; showVsPrev: boolean }) {
  const up = pct > 0;
  const down = pct < 0;
  return (
    <span
      className={cn(
        'ml-auto inline-flex items-center gap-[3px] whitespace-nowrap rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        up && 'bg-cs-trend-up/13 text-cs-trend-up',
        down && 'bg-cs-trend-down/13 text-cs-trend-down',
        // A flat period has no direction to assert, so it borrows neither the up
        // nor the down treatment — no arrow, no --cs-trend-* colour. Measured
        // against the chip's own bg-cs-bg-3 fill: 8.15:1 dark / 6.01:1 light,
        // comfortably over AA, without inventing a new token.
        !up && !down && 'bg-cs-bg-3 text-cs-text-muted',
      )}
    >
      {up && <ArrowUp aria-hidden="true" className="size-2.5" />}
      {down && <ArrowDown aria-hidden="true" className="size-2.5" />}
      <span className="sr-only">{up ? 'up ' : down ? 'down ' : 'unchanged '}</span>
      {/* Own element so the percentage is a single matchable text node. */}
      <span>{Math.abs(pct)}%</span>
      {showVsPrev && <span className="ml-px font-normal opacity-70">vs prev</span>}
    </span>
  );
}
