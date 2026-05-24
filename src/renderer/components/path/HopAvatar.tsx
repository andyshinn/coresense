import type { MessageHop } from '../../../shared/types';
import { cn } from '../../lib/utils';

/** Circular per-hop avatar showing the first 2 chars of a hop's shortId. */
export function HopAvatar({ hop, size = 28 }: { hop: MessageHop; size?: number }) {
  const cls =
    hop.kind === 'origin'
      ? 'bg-pink-600 text-white'
      : hop.kind === 'sink'
        ? 'bg-cyan-600 text-white'
        : 'bg-cs-border-strong text-cs-text';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-mono font-semibold',
        cls,
        hop.unnamed && 'border-2 border-dashed border-cs-border opacity-60',
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        letterSpacing: 0.5,
      }}
    >
      {hop.shortId.slice(0, 2)}
    </div>
  );
}
