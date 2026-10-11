import type { ReactNode } from 'react';
import type { ChannelGroup } from '../../../shared/telemetry/describe';
import type { PreviousReading } from '../../../shared/telemetry/types';
import { cn } from '../../lib/utils';
import { channelPermission } from './format';
import { type LatLon, TelemetryTile } from './TelemetryTile';
import { LABEL_MONO, META, TelemetryCard, TelemetryChip } from './ui';

interface Props {
  /** One channel from describeChannels(): name, match caption and described readings. */
  group: ChannelGroup;
  /** Earlier values by reading offset (see previousByOffset); a reading without one gets no history line. */
  previous?: ReadonlyMap<number, PreviousReading>;
  /** Show the channel's permission chip ("Base · Location", "Environment"). Off where grants are unknown. */
  showPermission?: boolean;
  advertPosition?: LatLon | null;
  onViewOnMap?: () => void;
  /** One more tile after the readings, in the same grid (My radio's GPS-off tile on ch 1). */
  extraTile?: ReactNode;
}

/**
 * One card per LPP channel: "Ch N", its name ("Self", "Environment", …), the
 * field-set caption and the permission chip, over a grid of tiles. The grid
 * fills as many ≥150 px columns as fit, so it reflows from the mockup's one
 * row down to a single column in a narrow pane.
 */
export function TelemetryGroup({ group, previous, showPermission, advertPosition, onViewOnMap, extraTile }: Props) {
  return (
    <TelemetryCard
      aria-label={`Channel ${group.ch}`}
      header={
        <>
          <span className={cn(LABEL_MONO, 'text-cs-text')}>Ch {group.ch}</span>
          <span className="text-[12.5px] font-medium text-cs-text">{group.name}</span>
          {group.caption && <span className={cn(META, 'min-w-0 truncate')}>{group.caption}</span>}
          {showPermission && (
            <TelemetryChip tone="off" className="ml-auto" title="Permission this channel needs">
              {channelPermission(group)}
            </TelemetryChip>
          )}
        </>
      }
    >
      {/* Tiles draw their own right/bottom seams; the -1px margins push the
          outermost ones under this wrapper's clip. */}
      <div className="overflow-hidden">
        <div className="-mr-px -mb-px grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))]">
          {group.readings.map((d) => (
            <TelemetryTile
              key={d.reading.offset}
              reading={d}
              previous={previous?.get(d.reading.offset) ?? null}
              advertPosition={advertPosition}
              onViewOnMap={onViewOnMap}
            />
          ))}
          {extraTile}
        </div>
      </div>
    </TelemetryCard>
  );
}
