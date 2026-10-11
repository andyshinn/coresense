import type { DescribedReading } from '../../../shared/telemetry/describe';
import { cn } from '../../lib/utils';
import { telemetryIcon } from './icons';

/**
 * The row's value. Compact is the value alone; otherwise the battery estimate
 * and the temperature's °F ride along ("4.25 V · ≈ 98% est.", "24.6 °C ·
 * 76.3 °F"), the two secondaries short enough for a 240 px rail. Longer ones
 * (dew point, altitude in ft) stay on the tile.
 */
export function rowValue(d: DescribedReading, compact = false): string {
  if (compact || !d.secondary) return d.text;
  if (d.kind === 'battery' || d.secondary.endsWith('°F')) return `${d.text} · ${d.secondary}`;
  return d.text;
}

interface Props {
  reading: DescribedReading;
  /** Overrides the reading's label, e.g. "Ch 3 voltage" in the rail. */
  label?: string;
  /** Value only, no secondary. */
  compact?: boolean;
  /** Muted value (an older request). */
  muted?: boolean;
  className?: string;
}

/**
 * A compact KeyValueRow-style line with the reading's type icon: caps label
 * left, mono value right. For the right rail, the state cards and the
 * compare table. Source-agnostic: callers describe readings first.
 */
export function TelemetryRow({ reading, label, compact, muted, className }: Props) {
  const Icon = telemetryIcon(reading.icon);
  const value = rowValue(reading, compact);
  const full = reading.secondary ? `${reading.text} · ${reading.secondary}` : reading.text;
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-3 text-xs', className)}>
      <span className="flex shrink-0 items-center gap-1.5 self-center text-cs-text-dim">
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        <span className="text-[10px] uppercase tracking-wider">{label ?? reading.label}</span>
      </span>
      <span
        title={full}
        className={cn(
          'truncate text-right font-mono text-[11px] tabular-nums',
          muted ? 'text-cs-text-muted' : 'text-cs-text',
        )}
      >
        {value}
      </span>
    </div>
  );
}
