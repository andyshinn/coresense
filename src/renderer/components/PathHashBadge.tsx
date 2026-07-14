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

const NEUTRAL = 'bg-cs-bg-3 text-cs-text-dim border-cs-border';

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
        'gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
        tone,
        className,
      )}
    >
      <TrendingUpDown className="size-3" aria-hidden />
      {bytes}
      <span className="font-normal opacity-55">b</span>
    </Badge>
  );
}
