import { History, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NODE_TELEMETRY_KEY } from '../../../../shared/keys';
import { describeChannels } from '../../../../shared/telemetry/describe';
import { fmtAge } from '../../../../shared/telemetry/format';
import { previousForRequest } from '../../../../shared/telemetry/previous';
import type { PreviousReading, SelfLiveReadDto } from '../../../../shared/telemetry/types';
import { Button } from '../../../components/ui/button';
import type { StreamState } from '../../../features/my-node/poll';
import { snapshotLine } from '../../../features/my-node/snapshotLine';
import { TelemetryTile } from '../../../features/telemetry/TelemetryTile';
import { useNowTick } from '../../../hooks/useNowTick';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { useEnsureTelemetryLoaded, useTelemetryRequests } from '../../../lib/telemetry';
import { CardLink, NodeCard, UpdatedAgo } from '../NodeCard';

/** Main refuses to save a live read older than this (telemetry/service.ts):
 *  two polls. The button follows the same rule. */
const SNAPSHOT_MAX_AGE_MS = 20_000;
/** Snapshot rows shown under the tiles; "View all" opens the rest. */
const RECENT_SNAPSHOTS = 2;

interface Props {
  stream: StreamState<SelfLiveReadDto>;
  connected: boolean;
  ownerKey: string;
  className?: string;
}

/** The companion's own readings, live while the page is open, plus "Save
 *  snapshot" into the same history repeaters use. Each tile's "was … at …"
 *  line comes from the latest saved snapshot that has that reading. */
export function TelemetryCard({ stream, connected, ownerKey, className }: Props) {
  const client = useApiClient();
  const setActiveKey = useStore((s) => s.setActiveKey);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  useEnsureTelemetryLoaded(client, ownerKey);
  const snapshots = useTelemetryRequests(ownerKey);
  const now = useNowTick(1_000);
  const [saving, setSaving] = useState(false);
  const live = stream.value;

  const tiles = useMemo(() => {
    if (!live) return [];
    const previous = previousForRequest(snapshots, {
      id: 'live',
      requestedAt: live.at,
      outcome: 'ok',
      readings: live.readings,
      source: 'companion',
    });
    // previousForRequest aligns with payload order; describeChannels groups
    // by channel, so pair them up by each reading's byte offset.
    const byOffset = new Map<number, PreviousReading | null>(live.readings.map((r, i) => [r.offset, previous[i]]));
    return describeChannels(live.readings, 'companion')
      .flatMap((g) => g.readings)
      .map((reading) => ({ reading, previous: byOffset.get(reading.reading.offset) ?? null }));
  }, [live, snapshots]);

  const fresh = live !== null && now - live.at <= SNAPSHOT_MAX_AGE_MS;
  const canSave = connected && fresh && !saving && !!client;

  const save = async () => {
    if (!client || !canSave) return;
    setSaving(true);
    try {
      await api.saveSelfTelemetrySnapshot(client);
      notify.success('Snapshot saved');
    } catch (err) {
      notify.failure('Save snapshot', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <NodeCard
      icon={Zap}
      title="Telemetry"
      className={className}
      extras={
        <>
          <UpdatedAgo
            text={stream.updatedAt !== null ? `Updated ${fmtAge(stream.updatedAt, now)}` : null}
            warn={stream.warn}
          />
          <Button variant="outline" size="xs" onClick={() => void save()} disabled={!canSave}>
            <History aria-hidden="true" />
            Save snapshot
          </Button>
        </>
      }
    >
      {!stream.supported ? (
        <p className="text-[12px] text-cs-text-muted">This firmware can't report its own telemetry.</p>
      ) : tiles.length === 0 ? (
        <p className="text-[12px] text-cs-text-muted">{stream.error ? `Read failed: ${stream.error}` : 'Reading…'}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 @min-[360px]/card:grid-cols-2">
          {tiles.map(({ reading, previous }) => (
            <TelemetryTile
              key={`${reading.reading.ch}:${reading.reading.offset}`}
              reading={reading}
              previous={previous}
              variant="card"
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="label-caps text-cs-text-muted">Snapshots</span>
          {snapshots.length > 0 && (
            <span className="ml-auto">
              <CardLink onClick={() => setActiveKey(NODE_TELEMETRY_KEY)}>View all {snapshots.length}</CardLink>
            </span>
          )}
        </div>
        {snapshots.length === 0 ? (
          <p className="text-[11px] text-cs-text-muted">None yet. Save one to compare readings later.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {snapshots.slice(0, RECENT_SNAPSHOTS).map((s) => (
              <li key={s.id} className="truncate font-mono text-[11px] tabular-nums text-cs-text-muted">
                {snapshotLine(s, timeFormat, now)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </NodeCard>
  );
}
