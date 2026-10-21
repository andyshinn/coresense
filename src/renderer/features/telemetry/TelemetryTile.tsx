import { Map as MapIcon } from 'lucide-react';
import type { DescribedReading } from '../../../shared/telemetry/describe';
import { fmtFeet, formatNumber, withUnit } from '../../../shared/telemetry/format';
import { isGpsValue } from '../../../shared/telemetry/lpp';
import { readingDelta } from '../../../shared/telemetry/previous';
import type { PreviousReading } from '../../../shared/telemetry/types';
import { CopyButton } from '../../components/CopyButton';
import { KeyValueRow } from '../../components/ui/KeyValueRow';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { fmtGap, fmtWhen, previousText } from './format';
import { telemetryIcon } from './icons';
import { LABEL_CAPS, META, telemetryButtonClass } from './ui';

export interface LatLon {
  lat: number;
  lon: number;
}

interface Props {
  reading: DescribedReading;
  /**
   * The most recent earlier saved value of this reading (same ch + type +
   * occurrence). Absent or null: no "was … at …" line (a new sensor, or the
   * first request).
   */
  previous?: PreviousReading | null;
  /** The node's advertised position; a GPS tile adds "N m from advertised". */
  advertPosition?: LatLon | null;
  /** GPS tile: "View on map". The button is hidden without it. */
  onViewOnMap?: () => void;
  /**
   * `panel` (default) is the repeater/history tile. `card` is My Node's
   * compact instrument tile: caps label, big numeral, the secondary value on
   * the right, a thin battery bar and a plain "was … at …" line.
   */
  variant?: 'panel' | 'card';
}

/** My Node's compact tile. Shares the reading description and the previous
 *  lookup with the panel tile; only the layout differs. */
function CardTile({ reading, previous }: Pick<Props, 'reading' | 'previous'>) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const Icon = telemetryIcon(reading.icon);
  const gps = reading.kind === 'gps' && isGpsValue(reading.reading.value);
  const battery = reading.kind === 'battery';
  // Battery: the charge estimate; anything else: its imperial/derived line.
  const secondary = battery
    ? reading.batteryPercent !== null
      ? `${reading.batteryPercent}%`
      : null
    : reading.kind === 'mcuTemp' || reading.reading.typeId === 103
      ? reading.secondary
      : null;
  return (
    <div data-testid="telemetry-tile" className="flex min-w-0 flex-col gap-1 rounded-md bg-cs-bg-3 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-1.5 text-cs-text-muted">
        <Icon aria-hidden="true" className="size-3 shrink-0 text-cs-accent" />
        <span className="label-caps min-w-0 truncate">{reading.label}</span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={cn(
            'min-w-0 truncate text-cs-text',
            gps ? 'font-mono text-[16px] leading-9 tabular-nums' : 'stat-numeral',
          )}
          title={reading.text}
        >
          {reading.value}
        </span>
        {!gps && reading.unit && <span className="shrink-0 text-[13px] text-cs-text-muted">{reading.unit}</span>}
        {secondary && (
          <span
            className="ml-auto shrink-0 font-mono text-[12px] tabular-nums text-cs-text-muted"
            title={battery ? 'Estimated from the LiPo voltage curve' : undefined}
          >
            {secondary}
          </span>
        )}
      </div>
      {battery && reading.batteryPercent !== null && (
        <div data-testid="battery-bar" aria-hidden="true" className="h-[3px] overflow-hidden rounded-full bg-cs-bg-2">
          <div className="h-full bg-cs-online" style={{ width: `${reading.batteryPercent}%` }} />
        </div>
      )}
      {previous && (
        <div data-testid="tile-delta" className="truncate font-mono text-[11px] tabular-nums text-cs-text-muted">
          was {previousText(reading, previous.reading)} at {fmtWhen(previous.requestedAt, timeFormat)}
        </div>
      )}
    </div>
  );
}

function DeltaLine({
  reading,
  previous,
  advertGap,
}: {
  reading: DescribedReading;
  previous?: PreviousReading | null;
  advertGap: string | null;
}) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  if (!previous && !advertGap) return null;
  const advert = advertGap ? `${advertGap} from advertised` : null;
  // Env tiles separate the history line with a seam; battery and GPS don't (mockup).
  const seam = reading.kind !== 'battery' && reading.kind !== 'gps';
  const className = cn('font-mono text-[11px] tabular-nums text-cs-text-muted', seam && 'border-t border-cs-border pt-1.25');

  if (!previous) {
    return (
      <div data-testid="tile-delta" className={className}>
        <span className="text-cs-text-dim">{advert}</span>
      </div>
    );
  }

  // Guest and failed requests in between are skipped, so "previous" can be days back.
  const at = fmtWhen(previous.requestedAt, timeFormat);
  const delta = readingDelta(reading.reading, previous.reading, reading.baseUnit);
  const tail = advert ? <span className="text-cs-text-dim"> · {advert}</span> : null;
  if (delta.direction === 'same') {
    return (
      <div data-testid="tile-delta" className={className}>
        = unchanged since {at}
        {tail}
      </div>
    );
  }
  if (delta.direction === 'moved') {
    return (
      <div data-testid="tile-delta" className={className}>
        {delta.text} since {at}
        {tail}
      </div>
    );
  }
  const up = delta.direction === 'up';
  return (
    <div data-testid="tile-delta" className={className}>
      <span aria-hidden="true">{up ? '▲' : '▼'} </span>
      <span className="sr-only">{up ? 'up ' : 'down '}</span>
      {delta.text}
      <span className="text-cs-text-dim">
        {' '}
        · was {previousText(reading, previous.reading)} at {at}
      </span>
      {tail}
    </div>
  );
}

/**
 * One reading: icon + caps label + "type · id", the big mono value, and a
 * secondary line. Battery adds the "≈ N% est." figure and bar (only inside the
 * LiPo range); GPS adds altitude, distance from the advertised position, and
 * map/copy actions. A history line shows only when `previous` exists.
 */
export function TelemetryTile({ reading, previous, advertPosition, onViewOnMap, variant = 'panel' }: Props) {
  if (variant === 'card') return <CardTile reading={reading} previous={previous} />;
  const Icon = telemetryIcon(reading.icon);
  const gps = reading.kind === 'gps' && isGpsValue(reading.reading.value) ? reading.reading.value : null;
  const advertGap = gps && advertPosition ? fmtGap(gps, advertPosition) : null;

  return (
    <div
      data-testid="telemetry-tile"
      // Right + bottom seams drawn inside the tile; TelemetryGroup clips the
      // outer edge. (A `gap-px` on a border-coloured grid would paint the
      // empty cells of a wrapped last row border-coloured.)
      className="flex min-w-0 flex-col gap-1.25 bg-cs-bg-2 px-3.5 py-3 shadow-[inset_-1px_-1px_0_0_rgb(var(--cs-border))]"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-cs-accent">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className={cn(LABEL_CAPS, 'min-w-0 truncate')}>{reading.label}</span>
        {/* The caption gives way first on a narrow tile: the name is what identifies the reading. */}
        <span
          className={cn(META, 'ml-auto min-w-0 shrink-[100] truncate whitespace-nowrap')}
          title={`${reading.typeName} · ${reading.reading.typeId}`}
        >
          {reading.typeName} · {reading.reading.typeId}
        </span>
      </div>

      {reading.kind === 'battery' ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="font-mono text-[30px] leading-9 tabular-nums text-cs-text">{reading.value}</span>
          <span className="font-mono text-[12px] text-cs-text-muted">{reading.unit}</span>
          {reading.batteryPercent !== null && (
            <span className="ml-2.5 font-mono text-[12px] text-cs-text-muted">{reading.secondary}</span>
          )}
        </div>
      ) : gps ? (
        <div className="truncate font-mono text-[18px] leading-9 tabular-nums text-cs-text" title={reading.value}>
          {reading.value}
        </div>
      ) : (
        <div className="flex min-w-0 items-baseline gap-1.25">
          <span className="truncate font-mono text-[22px] leading-7.5 tabular-nums text-cs-text">{reading.value}</span>
          {reading.unit && <span className="shrink-0 font-mono text-[11px] text-cs-text-muted">{reading.unit}</span>}
        </div>
      )}

      {reading.kind === 'battery' && reading.batteryPercent !== null && (
        <div data-testid="battery-bar" aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-cs-bg-3">
          <div className="h-full bg-cs-online" style={{ width: `${reading.batteryPercent}%` }} />
        </div>
      )}

      {gps ? (
        <KeyValueRow label="Altitude" mono value={`${withUnit(formatNumber(gps.alt, 2), 'm')} · ${fmtFeet(gps.alt)}`} />
      ) : (
        reading.kind !== 'battery' &&
        reading.secondary && <div className="truncate font-mono text-[11px] text-cs-text-muted">{reading.secondary}</div>
      )}

      <DeltaLine reading={reading} previous={previous} advertGap={advertGap} />

      {gps && (
        <div className="mt-0.5 flex flex-wrap gap-2">
          {onViewOnMap && (
            <button type="button" onClick={onViewOnMap} className={telemetryButtonClass()}>
              <MapIcon aria-hidden="true" />
              View on map
            </button>
          )}
          {/* Plain ASCII digits: the clipboard copy has to paste into other apps. */}
          <CopyButton value={`${gps.lat}, ${gps.lon}`} copiedLabel="Copied" className={telemetryButtonClass()}>
            Copy
          </CopyButton>
        </div>
      )}
    </div>
  );
}
