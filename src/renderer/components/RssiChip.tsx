import { cn } from '@/lib/utils';

interface Props {
  rssi: number;
  hops?: number;
  /** When false, suppress the trailing `· Nh` hop segment (the caller renders
   *  hops elsewhere, e.g. the message meta row's path-stats label). */
  showHops?: boolean;
  className?: string;
}

// Map dBm → bars (0..4). MeshCore radios in BLE proximity typically run
// -30 to -90 dBm; below -95 is essentially unusable.
function barsFor(rssi: number): number {
  if (rssi >= -55) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -85) return 2;
  if (rssi >= -95) return 1;
  return 0;
}

export function RssiChip({ rssi, hops, showHops = true, className }: Props) {
  const bars = barsFor(rssi);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 font-mono text-[10px] text-cs-text-muted', className)}
      title={`${rssi} dBm${showHops && hops != null ? ` · ${hops} hops` : ''}`}
    >
      <span className="flex items-end gap-px" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'w-0.5 rounded-sm',
              i < bars ? 'bg-cs-accent' : 'bg-cs-border-strong',
              i === 0 && 'h-1',
              i === 1 && 'h-1.5',
              i === 2 && 'h-2',
              i === 3 && 'h-2.5',
            )}
          />
        ))}
      </span>
      <span className="tabular-nums">{rssi} dBm</span>
      {showHops && hops != null && <span className="tabular-nums">· {hops}h</span>}
    </span>
  );
}
