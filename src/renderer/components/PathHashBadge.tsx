import { TrendingUpDown } from 'lucide-react';
import type { PathHashSize } from '../../shared/types';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

// Distinct triad — soft tint per hue: bg /15, text 100%, border /25. Colour is
// driven by mode only (never state or signal). Hues come from the packet-log
// field palette (see --cs-hash-* in index.css).
const MODE: Record<PathHashSize, string> = {
  1: 'bg-cs-hash-1/15 text-cs-hash-1 border-cs-hash-1/25',
  2: 'bg-cs-hash-2/15 text-cs-hash-2 border-cs-hash-2/25',
  3: 'bg-cs-hash-3/15 text-cs-hash-3 border-cs-hash-3/25',
};

// `text-muted`, not `text-dim`: dim on bg-3 is 3.76:1 dark / 3.03:1 light, both
// under AA. Muted clears it at 8.15 / 6.01.
const NEUTRAL = 'bg-cs-bg-3 text-cs-text-muted border-cs-border';

/** Monospace badge for the path-hash mode (bytes-per-hop). Renders `{n}b` tinted
 *  per mode. `bytes` is widened to `number` because call sites hold a raw
 *  `hashMode`; anything outside 1/2/3 renders a neutral chip. */
export function PathHashBadge({ bytes, className }: { bytes: number; className?: string }) {
  const tone = MODE[bytes as PathHashSize] ?? NEUTRAL;
  return (
    <Badge
      variant="secondary"
      title={`Path hash size: ${bytes} byte${bytes === 1 ? '' : 's'} per hop`}
      className={cn(
        // `leading-none` is load-bearing: `text-[10px]` is an arbitrary value, so
        // Tailwind emits font-size only and the badge would inherit a *unitless*
        // line-height from its ancestors (1.5 from preflight, 1.25 under the
        // sidebar, 1.333 inside KeyValueRow) — three different heights, all far
        // taller than the 10px meta text it sits beside. Pinning it renders 16px
        // uniformly at every call site.
        // Icon size must be set here, not on the <svg>: badgeVariants ships
        // `[&>svg]:size-3`, whose (0,1,1) specificity beats a bare `size-*` on
        // the icon. From the parent, tailwind-merge displaces it cleanly.
        'gap-0.5 rounded-sm border px-1 py-0.5 font-mono text-[10px] leading-none font-semibold tabular-nums [&>svg]:size-2.5',
        tone,
        className,
      )}
    >
      <TrendingUpDown aria-hidden />
      {/* Number + unit are one flex child so the badge's gap spaces only the
          icon; the "b" stays tight to the number ("2b", not "2 b"). Weight alone
          de-emphasises the unit — an opacity knock-down here drops the glyph
          under 3:1 in both themes. */}
      <span>
        {bytes}
        <span className="font-normal">b</span>
      </span>
    </Badge>
  );
}
