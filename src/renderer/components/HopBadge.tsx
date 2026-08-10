import { hopTint, hopTitle } from '../lib/hopWarmth';
import { Badge } from './ui/badge';

/** Monospace badge for a relay hop count. Sibling to PathHashBadge: same
 *  geometry and the same de-emphasised trailing unit, so `4h` and `2b` read as
 *  one family — but unfilled, which is what keeps the two apart when they sit
 *  side by side in the same meta line. Colour warms with distance; see
 *  lib/hopWarmth.ts for the ramp and index.css for the endpoints.
 *
 *  Renders nothing when `hops` is null. 0 is a real value (direct). */
export function HopBadge({ hops, hashMode }: { hops: number | null; hashMode: number | null }) {
  if (hops == null) return null;
  return (
    <Badge
      variant="outline"
      title={hopTitle(hops, hashMode)}
      // Continuous ramp ⇒ no Tailwind class can express it. Inline colour from
      // a token is precedented here (see path/PathItem.tsx's snrTokenVar).
      style={hopTint(hops, hashMode)}
      // Geometry mirrors PathHashBadge. `leading-none` is load-bearing — see
      // the note there for why an arbitrary text size needs it pinned.
      className="rounded-sm border px-1 py-0.5 font-mono text-[10px] leading-none font-semibold tabular-nums"
    >
      {/* One flex child: badgeVariants ships `gap-1`, so a bare text node beside
          the unit span would render "4 h". Weight alone de-emphasises the unit —
          an opacity knock-down drops it under 3:1, as PathHashBadge found. */}
      <span>
        {hops}
        <span className="font-normal">h</span>
      </span>
    </Badge>
  );
}
