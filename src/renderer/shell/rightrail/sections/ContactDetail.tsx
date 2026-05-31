import {
  Ban,
  MapPin,
  MessageSquare,
  Minus,
  Plus,
  Radio,
  Share2,
  ShieldCheck,
  Star,
  TerminalSquare,
} from 'lucide-react';
import { useState } from 'react';
import { BlockSenderDialog } from '../../../components/BlockSenderDialog';
import { copyToClipboard } from '../../../components/ContextMenu';
import { SetPathEditor } from '../../../components/path/SetPathEditor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { type ApiClient, api } from '../../../lib/api';
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
import { CardActionButton } from './ContactCard';

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
  const discovered = useStore((s) => s.discovered);
  const contacts = useStore((s) => s.contacts);
  const identity = useStore((s) => s.deviceIdentity);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  const [blockOpen, setBlockOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  if (!publicKeyHex) return <Placeholder label="no contact focused" />;
  const rc = resolveContact(publicKeyHex, discovered, contacts);
  if (!rc) return <Placeholder label="unknown contact" />;

  const canMessage = rc.onRadio && (rc.kind === 'chat' || rc.kind === 'room');
  const canAdminister = rc.onRadio && (rc.kind === 'repeater' || rc.kind === 'sensor');

  // Run an API mutation that needs a live client; no-op when disconnected.
  async function act(fn: (c: ApiClient) => Promise<unknown>, ok: string) {
    if (!client) return;
    try {
      await fn(client);
      notify.success(ok);
    } catch (err) {
      notify.error(`Action failed: ${(err as Error).message}`, err);
    }
  }

  const rcKey = rc.key;
  function openRepeaterTab(tab: 'status' | 'acl' | 'cli') {
    setRepeaterAdminTab(tab);
    setActiveKey(rcKey);
  }

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

      <div className="flex flex-wrap gap-1.5">
        {!rc.onRadio && !rc.blocked && (
          <CardActionButton
            icon={Plus}
            label="Add to radio"
            onClick={() =>
              act((c) => api.addToRadio(c, rc.publicKeyHex), `Added ${rc.name} to radio`)
            }
          />
        )}
        {canMessage && (
          <CardActionButton
            icon={MessageSquare}
            label="Message"
            onClick={() => setActiveKey(rc.key)}
          />
        )}
        <CardActionButton
          icon={Star}
          label={rc.favourite ? 'Unfavourite' : 'Favourite'}
          onClick={() =>
            act(
              (c) => api.setFavourite(c, rc.publicKeyHex, !rc.favourite),
              rc.favourite ? 'Removed favourite' : 'Favourited',
            )
          }
        />
        {hasFix && (
          <CardActionButton icon={MapPin} label="View on map" onClick={() => flyToContact(rc)} />
        )}
        {canAdminister && (
          <>
            <CardActionButton
              icon={Radio}
              label="Telemetry"
              onClick={() => openRepeaterTab('status')}
            />
            {rc.kind === 'repeater' && (
              <CardActionButton
                icon={ShieldCheck}
                label="Permissions"
                onClick={() => openRepeaterTab('acl')}
              />
            )}
            <CardActionButton
              icon={TerminalSquare}
              label="Remote mgmt"
              onClick={() => openRepeaterTab('cli')}
            />
          </>
        )}
        {!rc.blocked && (
          <CardActionButton icon={Ban} label="Block" onClick={() => setBlockOpen(true)} />
        )}
        {rc.onRadio && (
          <CardActionButton icon={Minus} label="Remove" onClick={() => setRemoveOpen(true)} />
        )}
        <CardActionButton
          icon={Share2}
          label="Share"
          onClick={() => notify.info('Share — coming soon')}
        />
      </div>

      {blockOpen && (
        <BlockSenderDialog
          client={client}
          open
          prefill={{ pubkey: rc.publicKeyHex, name: rc.name }}
          onClose={() => setBlockOpen(false)}
        />
      )}

      <Dialog open={removeOpen} onOpenChange={(o) => !o && setRemoveOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from radio</DialogTitle>
            <DialogDescription>
              Remove {rc.name} from the radio's contact store? It stays in your discovered list and
              can be re-added later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRemoveOpen(false)}
              className="rounded-md border border-cs-border bg-cs-bg-2 px-3 py-1.5 text-xs hover:bg-cs-bg-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setRemoveOpen(false);
                void act(
                  (c) => api.removeFromRadio(c, rc.publicKeyHex),
                  `Removed ${rc.name} from radio`,
                );
              }}
              className="rounded-md border border-cs-danger bg-cs-danger/10 px-3 py-1.5 text-xs text-cs-danger hover:bg-cs-danger/20"
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          label="Last heard"
          value={rc.lastHeardMs == null ? 'not heard yet' : fmtRelative(rc.lastHeardMs)}
          title={rc.lastHeardMs == null ? undefined : fmtDateTime(rc.lastHeardMs, timeFormat)}
        />
        <KeyValueRow
          label="Advertised"
          value={rc.lastAdvertMs == null ? '—' : fmtRelative(rc.lastAdvertMs)}
          title={
            rc.lastAdvertMs == null
              ? undefined
              : `Node's own clock — ${fmtDateTime(rc.lastAdvertMs, timeFormat)}`
          }
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

      {showPath && (
        <div className="border-t border-cs-border pt-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
            Path
          </div>
          {rc.contact && rc.publicKeyHex.length >= 64 ? (
            <SetPathEditor contact={rc.contact} client={client} />
          ) : (
            <div className="space-y-1 px-1 pb-1">
              <div className="font-mono text-[12px] text-cs-text">
                {rc.outPathHex ? `${rc.outPathHex.length / 2} byte path` : 'Flood'}
              </div>
              <p className="text-[11px] text-cs-text-dim">
                {rc.onRadio
                  ? 'Waiting on a full advert before the path can be edited.'
                  : 'Add this contact to the radio to set a fixed path.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
