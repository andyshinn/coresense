import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../../../../lib/utils';

/** Δ vs the previous equal period. Direction only — green/coral are a sign, not a
 *  verdict, so there is deliberately no alarm styling on a decline. Render this
 *  only when trendPct() returned a number; a null trend has no chip at all. */
export function TrendChip({ pct, showVsPrev }: { pct: number; showVsPrev: boolean }) {
  const up = pct >= 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'ml-auto inline-flex items-center gap-[3px] whitespace-nowrap rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        up ? 'bg-cs-trend-up/13 text-cs-trend-up' : 'bg-cs-trend-down/13 text-cs-trend-down',
      )}
    >
      <Icon aria-hidden="true" className="size-2.5" />
      <span className="sr-only">{up ? 'up ' : 'down '}</span>
      {/* Own element so the percentage is a single matchable text node. */}
      <span>{Math.abs(pct)}%</span>
      {showVsPrev && <span className="ml-px font-normal opacity-70">vs prev</span>}
    </span>
  );
}
