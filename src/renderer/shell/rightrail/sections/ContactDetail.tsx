import { ChatBubbleIcon, MinusIcon, PlusIcon, Share2Icon, StarFilledIcon, StarIcon } from '@radix-ui/react-icons';
import { AlertDialog, Box, Button, DataList, Flex, Text } from '@radix-ui/themes';
import { Ban, MapPin, Radio, ShieldCheck, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import { BlockSenderDialog } from '../../../components/BlockSenderDialog';
import { copyToClipboard } from '../../../components/ContextMenu';
import { SetPathEditor } from '../../../components/path/SetPathEditor';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { type ApiClient, api } from '../../../lib/api';
import { distanceKm, fmtDistance, type ResolvedContact, resolveContact } from '../../../lib/contactDetail';
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

/** Compact icon+label action button for the contact action row. */
function ActionButton({
  icon,
  label,
  onClick,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: React.ComponentProps<typeof Button>['color'];
}) {
  return (
    <Button size="1" variant="surface" color={color} onClick={onClick}>
      {icon}
      {label}
    </Button>
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
    typeof identity.lat === 'number' && typeof identity.lon === 'number' && (identity.lat !== 0 || identity.lon !== 0);
  const distance =
    hasFix && selfHasFix
      ? distanceKm(identity.lat as number, identity.lon as number, rc.gpsLat as number, rc.gpsLon as number)
      : null;

  return (
    <Flex direction="column" gap="3">
      {/* Header: avatar, name, public key, status pill */}
      <Flex align="start" gap="2">
        <Box
          flexShrink="0"
          style={{
            width: 36,
            height: 36,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 'var(--radius-3)',
            border: '1px solid var(--cs-border)',
            background: 'var(--cs-bg-3)',
          }}
        >
          <TypeGlyph kind={rc.kind} className="size-4.5" />
        </Box>
        <Box flexGrow="1" minWidth="0">
          <Text
            as="div"
            size="2"
            weight="bold"
            truncate
            style={{
              color: 'var(--cs-text)',
              textDecoration: rc.blocked ? 'line-through' : undefined,
              opacity: rc.blocked ? 0.6 : undefined,
            }}
          >
            {rc.name || '(unnamed)'}
          </Text>
          <button
            type="button"
            onClick={() => copyToClipboard(rc.publicKeyHex, () => notify.success('Public key copied'))}
            title={`${rc.publicKeyHex} — click to copy`}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--cs-text-dim)',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            {shortKey}
          </button>
        </Box>
        <StatusPill c={{ blocked: rc.blocked, onRadio: rc.onRadio } as never} />
      </Flex>

      {/* Action buttons */}
      <Flex wrap="wrap" gap="1">
        {!rc.onRadio && !rc.blocked && (
          <ActionButton
            icon={<PlusIcon />}
            label="Add to radio"
            onClick={() => act((c) => api.addToRadio(c, rc.publicKeyHex), `Added ${rc.name} to radio`)}
          />
        )}
        {canMessage && <ActionButton icon={<ChatBubbleIcon />} label="Message" onClick={() => setActiveKey(rc.key)} />}
        <ActionButton
          icon={rc.favourite ? <StarFilledIcon /> : <StarIcon />}
          label={rc.favourite ? 'Unfavourite' : 'Favourite'}
          onClick={() =>
            act(
              (c) => api.setFavourite(c, rc.publicKeyHex, !rc.favourite),
              rc.favourite ? 'Removed favourite' : 'Favourited',
            )
          }
        />
        {hasFix && (
          <ActionButton icon={<MapPin size={12} aria-hidden />} label="View on map" onClick={() => flyToContact(rc)} />
        )}
        {canAdminister && (
          <>
            <ActionButton
              icon={<Radio size={12} aria-hidden />}
              label="Telemetry"
              onClick={() => openRepeaterTab('status')}
            />
            {rc.kind === 'repeater' && (
              <ActionButton
                icon={<ShieldCheck size={12} aria-hidden />}
                label="Permissions"
                onClick={() => openRepeaterTab('acl')}
              />
            )}
            <ActionButton
              icon={<TerminalSquare size={12} aria-hidden />}
              label="Remote mgmt"
              onClick={() => openRepeaterTab('cli')}
            />
          </>
        )}
        {!rc.blocked && (
          <ActionButton icon={<Ban size={12} aria-hidden />} label="Block" color="red" onClick={() => setBlockOpen(true)} />
        )}
        {rc.onRadio && <ActionButton icon={<MinusIcon />} label="Remove" color="red" onClick={() => setRemoveOpen(true)} />}
        <ActionButton icon={<Share2Icon />} label="Share" onClick={() => notify.info('Share — coming soon')} />
      </Flex>

      {/* Block dialog — keep BlockSenderDialog (complex async, stays as-is) */}
      {blockOpen && (
        <BlockSenderDialog
          client={client}
          open
          prefill={{ pubkey: rc.publicKeyHex, name: rc.name }}
          onClose={() => setBlockOpen(false)}
        />
      )}

      {/* Remove dialog — AlertDialog.Action is safe: dialog closes sync before async op */}
      <AlertDialog.Root open={removeOpen} onOpenChange={(o) => !o && setRemoveOpen(false)}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Remove from radio</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Remove {rc.name} from the radio's contact store? It stays in your discovered list and can be re-added later.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={() => {
                  void act((c) => api.removeFromRadio(c, rc.publicKeyHex), `Removed ${rc.name} from radio`);
                }}
              >
                Remove
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      {/* Metadata rows */}
      <DataList.Root orientation="horizontal" size="1">
        <KeyValueRow
          label="Public key"
          mono
          title={rc.publicKeyHex}
          value={
            <button
              type="button"
              onClick={() => copyToClipboard(rc.publicKeyHex, () => notify.success('Public key copied'))}
              style={{
                fontFamily: 'var(--font-mono)',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'inherit',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
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
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {(rc.gpsLat as number).toFixed(5)}, {(rc.gpsLon as number).toFixed(5)}
              </button>
            }
          />
        )}
        {distance != null && <KeyValueRow label="Distance away" value={fmtDistance(distance)} mono />}
        <KeyValueRow
          label="Last heard"
          value={rc.lastHeardMs == null ? 'not heard yet' : fmtRelative(rc.lastHeardMs)}
          title={rc.lastHeardMs == null ? undefined : fmtDateTime(rc.lastHeardMs, timeFormat)}
        />
        <KeyValueRow
          label="Advertised"
          value={rc.lastAdvertMs == null ? '—' : fmtRelative(rc.lastAdvertMs)}
          title={rc.lastAdvertMs == null ? undefined : `Node's own clock — ${fmtDateTime(rc.lastAdvertMs, timeFormat)}`}
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
        {rc.outPathHashSize != null && <KeyValueRow label="Path hash size" value={`${rc.outPathHashSize}-byte`} mono />}
        {rc.rssi != null && <KeyValueRow label="RSSI" value={`${rc.rssi} dBm`} mono />}
      </DataList.Root>

      {/* Path subsection */}
      {showPath && (
        <Box style={{ borderTop: '1px solid var(--cs-border)', paddingTop: 'var(--space-2)' }}>
          <Text
            as="div"
            size="1"
            mb="1"
            style={{
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--cs-text-dim)',
            }}
          >
            Path
          </Text>
          {rc.contact && rc.publicKeyHex.length >= 64 ? (
            <SetPathEditor contact={rc.contact} client={client} />
          ) : (
            <Box px="1" pb="1">
              <Text as="div" size="2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--cs-text)' }}>
                {rc.outPathHex ? `${rc.outPathHex.length / 2} byte path` : 'Flood'}
              </Text>
              <Text as="p" size="1" style={{ color: 'var(--cs-text-dim)' }}>
                {rc.onRadio
                  ? 'Waiting on a full advert before the path can be edited.'
                  : 'Add this contact to the radio to set a fixed path.'}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Flex>
  );
}
