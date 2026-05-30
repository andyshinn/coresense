import { copyToClipboard } from '../../../components/ContextMenu';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import type { ApiClient } from '../../../lib/api';
import {
  distanceKm,
  fmtDistance,
  type ResolvedContact,
  resolveContact,
} from '../../../lib/contactDetail';
import { publish as publishMapBus } from '../../../lib/map/bus';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { fmtDateTime, fmtRelative } from '../../../lib/time';
import { StatusPill, TypeGlyph } from '../../../panels/contacts/ContactRows';
import { Placeholder } from '../atoms';

const KIND_LABEL: Record<ResolvedContact['kind'], string> = {
  chat: 'Chat',
  repeater: 'Repeater',
  room: 'Room',
  sensor: 'Sensor',
};

interface Props {
  publicKeyHex: string | null;
  client: ApiClient | null;
  /** Render the embedded path subsection. False where the rail already has a
   *  dedicated Path section (dm/repeater view). Default true. */
  showPath?: boolean;
}

/** Center the Map panel on a resolved contact's last position. */
function flyToContact(rc: ResolvedContact) {
  useStore.getState().setActiveKey('tool:map');
  publishMapBus({ kind: 'flyTo', lng: rc.gpsLon as number, lat: rc.gpsLat as number, zoom: 12 });
}

/** True iff a resolved contact carries a usable WGS84 fix (mirrors hasValidFix
 *  but for the merged shape). */
function rcHasFix(rc: ResolvedContact): boolean {
  return (
    typeof rc.gpsLat === 'number' &&
    typeof rc.gpsLon === 'number' &&
    (rc.gpsLat !== 0 || rc.gpsLon !== 0) &&
    rc.gpsLat >= -90 &&
    rc.gpsLat <= 90 &&
    rc.gpsLon >= -180 &&
    rc.gpsLon <= 180
  );
}

export function ContactDetail({ publicKeyHex, client, showPath = true }: Props) {
  void client; // used in Tasks 4/5
  const discovered = useStore((s) => s.discovered);
  const contacts = useStore((s) => s.contacts);
  const identity = useStore((s) => s.deviceIdentity);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);

  if (!publicKeyHex) return <Placeholder label="no contact focused" />;
  const rc = resolveContact(publicKeyHex, discovered, contacts);
  if (!rc) return <Placeholder label="unknown contact" />;

  const shortKey = `${rc.publicKeyHex.slice(0, 6)}…${rc.publicKeyHex.slice(-4)}`;
  const hasFix = rcHasFix(rc);
  const selfHasFix =
    typeof identity.lat === 'number' &&
    typeof identity.lon === 'number' &&
    (identity.lat !== 0 || identity.lon !== 0);
  const distance =
    hasFix && selfHasFix
      ? distanceKm(
          identity.lat as number,
          identity.lon as number,
          rc.gpsLat as number,
          rc.gpsLon as number,
        )
      : null;

  return (
    <div className="space-y-3 text-cs-text-muted">
      <div className="flex items-start gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-cs-border bg-cs-bg-3">
          <TypeGlyph kind={rc.kind} className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`truncate text-sm font-semibold text-cs-text ${rc.blocked ? 'line-through opacity-60' : ''}`}
            >
              {rc.name || '(unnamed)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              copyToClipboard(rc.publicKeyHex, () => notify.success('Public key copied'))
            }
            title={`${rc.publicKeyHex} — click to copy`}
            className="font-mono text-[10px] text-cs-text-dim hover:text-cs-text-muted"
          >
            {shortKey}
          </button>
        </div>
        <StatusPill c={{ blocked: rc.blocked, onRadio: rc.onRadio } as never} />
      </div>

      {/* action row — Task 4 */}

      <div className="space-y-1.5">
        <KeyValueRow
          label="Public key"
          mono
          title={rc.publicKeyHex}
          value={
            <button
              type="button"
              onClick={() =>
                copyToClipboard(rc.publicKeyHex, () => notify.success('Public key copied'))
              }
              className="truncate font-mono hover:text-cs-text"
            >
              {shortKey}
            </button>
          }
        />
        <KeyValueRow label="Type" value={KIND_LABEL[rc.kind]} />
        {hasFix && (
          <KeyValueRow
            label="Position"
            mono
            value={
              <button
                type="button"
                onClick={() => flyToContact(rc)}
                title="View on map"
                className="hover:text-cs-text"
              >
                {(rc.gpsLat as number).toFixed(5)}, {(rc.gpsLon as number).toFixed(5)}
              </button>
            }
          />
        )}
        {distance != null && (
          <KeyValueRow label="Distance away" value={fmtDistance(distance)} mono />
        )}
        <KeyValueRow
          label="Last advert"
          value={rc.lastAdvertMs == null ? '—' : fmtRelative(rc.lastAdvertMs)}
          title={rc.lastAdvertMs == null ? undefined : fmtDateTime(rc.lastAdvertMs, timeFormat)}
        />
        <KeyValueRow
          label="First heard"
          value={rc.firstHeardMs == null ? '—' : fmtRelative(rc.firstHeardMs)}
          title={rc.firstHeardMs == null ? undefined : fmtDateTime(rc.firstHeardMs, timeFormat)}
        />
        <KeyValueRow
          label="Hops away"
          value={rc.hops == null ? 'Flood' : `${rc.hops} hop${rc.hops === 1 ? '' : 's'}`}
          mono
        />
        {rc.outPathHashSize != null && (
          <KeyValueRow label="Path hash size" value={`${rc.outPathHashSize}-byte`} mono />
        )}
        {rc.rssi != null && <KeyValueRow label="RSSI" value={`${rc.rssi} dBm`} mono />}
      </div>

      {showPath && <div>{/* path subsection — Task 5 */}</div>}
    </div>
  );
}
