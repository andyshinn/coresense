import { Copy, Megaphone, User } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Owner, TransportState } from '../../../shared/types';
import { CopyButton } from '../../components/CopyButton';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../components/ui/hover-card';
import { KeyValueGroup, KeyValueRow } from '../../components/ui/KeyValueRow';
import { SidebarMenu, SidebarMenuItem } from '../../components/ui/sidebar';
import { type ApiClient, api } from '../../lib/api';
import { formatVoltage, lipoPercent } from '../../lib/battery';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { fmtBandwidth, fmtFreq, fmtGpsInterval, fmtStorageKb } from './ownerFormat';

const TRANSPORT_LABEL: Record<TransportState, string> = {
  idle: 'Not connected',
  scanning: 'Scanning',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Error',
};

const TRANSPORT_DOT: Record<TransportState, string> = {
  idle: 'bg-cs-text-dim',
  scanning: 'bg-cs-warn animate-pulse',
  connecting: 'bg-cs-accent animate-pulse',
  connected: 'bg-cs-online',
  error: 'bg-cs-danger',
};

/** Header identity card — radio name, public-key prefix, battery, and a flood-advert action. */
export function OwnerCard({ owner, client }: { owner: Owner | null; client: ApiClient | null }) {
  const deviceInfo = useStore((s) => s.deviceInfo);
  const transport = useStore((s) => s.transportState);
  const pathHashMode = useStore((s) => s.radioSettings.pathHashMode);
  const connected = transport === 'connected';
  const [advertising, setAdvertising] = useState(false);

  const onFloodAdvert = useCallback(async () => {
    if (!client) return;
    setAdvertising(true);
    try {
      await api.sendAdvert(client, true);
      notify.success('Flood advert sent');
    } catch (err) {
      notify.error(`Flood advert failed: ${(err as Error).message}`, err);
    } finally {
      setAdvertising(false);
    }
  }, [client]);

  const battMv = deviceInfo.batteryMv;
  const battPct = lipoPercent(battMv);
  const battText =
    battMv > 0 ? `${formatVoltage(battMv)}${battPct !== null ? ` · ${battPct}%` : ''}` : '—';

  return (
    <SidebarMenu>
      <SidebarMenuItem className="p-1 group-data-[collapsible=icon]:p-0">
        <HoverCard openDelay={200} closeDelay={120}>
          <div className="flex flex-col gap-2">
            {/* Hovering this top row reveals the full radio details. */}
            <HoverCardTrigger asChild>
              <div className="flex items-center gap-2">
                <div className="relative flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-cs-accent-soft/40 text-cs-accent">
                  <User className="size-4" />
                  <span
                    role="img"
                    aria-label={TRANSPORT_LABEL[transport]}
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-cs-bg-2',
                      TRANSPORT_DOT[transport],
                    )}
                  />
                </div>
                <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                  <span
                    data-testid="owner-name"
                    className="truncate text-sm font-medium text-cs-text"
                  >
                    {owner?.name ?? 'No identity'}
                  </span>
                  {owner ? (
                    <div className="flex w-fit items-center gap-1.5">
                      <CopyButton
                        value={owner.publicKeyHex}
                        title="Copy full public key"
                        className="flex items-center gap-1 rounded font-mono text-[10px] tracking-wide text-cs-text-dim hover:text-cs-text"
                      >
                        <span className="truncate">{owner.publicKeyHex.slice(0, 6)}</span>
                        <Copy aria-hidden="true" className="size-2.5 shrink-0" />
                      </CopyButton>
                      <span
                        title={`Path hash size: ${pathHashMode} byte${pathHashMode > 1 ? 's' : ''} per hop`}
                        className="rounded-sm bg-cs-bg-3 px-1 font-mono text-[9px] uppercase tracking-wide text-cs-text-dim"
                      >
                        {pathHashMode}b
                      </span>
                    </div>
                  ) : (
                    <span className="truncate font-mono text-[10px] tracking-wide text-cs-text-dim">
                      configure to send adverts
                    </span>
                  )}
                </div>
              </div>
            </HoverCardTrigger>

            {/* Detail block — hidden when the sidebar is icon-collapsed */}
            <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
              {/* Battery — grays out and prompts to connect when offline */}
              <div className={cn('transition-opacity', !connected && 'opacity-50')}>
                {connected ? (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-cs-text-dim">Battery</span>
                    <span className="font-mono tabular-nums text-cs-text-muted">{battText}</span>
                  </div>
                ) : (
                  <div className="text-[10px] text-cs-text-dim">Connect to show battery</div>
                )}
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-cs-bg-3">
                  <div
                    className="h-full bg-cs-accent transition-[width] duration-300"
                    style={{ width: `${connected ? (battPct ?? 0) : 0}%` }}
                  />
                </div>
              </div>

              {/* Flood advert */}
              <button
                type="button"
                onClick={onFloodAdvert}
                disabled={!connected || !client || advertising}
                title={connected ? 'Broadcast a flood advert' : 'Connect a radio to advertise'}
                className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-3 text-xs text-cs-text-muted transition-colors hover:bg-cs-bg-2 hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-cs-bg-3 disabled:hover:text-cs-text-muted"
              >
                <Megaphone aria-hidden="true" className="size-3.5" />
                {advertising ? 'Advertising…' : 'Flood advert'}
              </button>
            </div>
          </div>
          <HoverCardContent align="start" side="right" sideOffset={8} className="w-64 p-3">
            <RadioDetailsContent owner={owner} />
          </HoverCardContent>
        </HoverCard>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Full radio picture surfaced from already-synced store state for the OwnerCard hover popover. */
function RadioDetailsContent({ owner }: { owner: Owner | null }) {
  const deviceInfo = useStore((s) => s.deviceInfo);
  const radio = useStore((s) => s.radioSettings);
  const identity = useStore((s) => s.deviceIdentity);
  const gps = useStore((s) => s.gpsConfig);
  const contactCount = useStore((s) => s.contacts.length);
  const channelCount = useStore((s) => s.channels.length);

  const hasLocation = identity.lat !== null && identity.lon !== null;

  return (
    <div className="flex flex-col gap-3">
      {owner && (
        <KeyValueGroup title="Public key">
          <CopyButton
            value={owner.publicKeyHex}
            title="Copy public key"
            className="group flex items-start gap-1.5 rounded text-left"
          >
            <span className="break-all font-mono text-[10px] leading-relaxed text-cs-text-muted group-hover:text-cs-text">
              {owner.publicKeyHex}
            </span>
            <Copy
              aria-hidden="true"
              className="mt-px size-3 shrink-0 text-cs-text-dim group-hover:text-cs-text"
            />
          </CopyButton>
        </KeyValueGroup>
      )}

      <KeyValueGroup title="Radio">
        <KeyValueRow label="Frequency" value={fmtFreq(radio.frequencyHz)} mono />
        <KeyValueRow label="Bandwidth" value={fmtBandwidth(radio.bandwidthHz)} mono />
        <KeyValueRow label="Spreading" value={`SF${radio.spreadingFactor}`} mono />
        <KeyValueRow label="Coding rate" value={`4/${radio.codingRate}`} mono />
        <KeyValueRow label="TX power" value={`${radio.txPowerDbm} dBm`} mono />
        <KeyValueRow label="Path hash" value={`${radio.pathHashMode}-byte`} mono />
      </KeyValueGroup>

      <KeyValueGroup title="Device">
        <KeyValueRow label="Model" value={deviceInfo.deviceModel || '—'} mono />
        <KeyValueRow
          label="Firmware"
          value={deviceInfo.firmwareVerCode > 0 ? `v${deviceInfo.firmwareVerCode}` : '—'}
          mono
        />
        <KeyValueRow label="Repeat mode" value={radio.repeatMode ? 'On' : 'Off'} mono />
      </KeyValueGroup>

      <KeyValueGroup title="Capacity">
        <KeyValueRow
          label="Contacts"
          value={`${contactCount} / ${deviceInfo.maxContacts || '—'}`}
          mono
        />
        <KeyValueRow
          label="Channels"
          value={`${channelCount} / ${deviceInfo.maxChannels || '—'}`}
          mono
        />
        <KeyValueRow
          label="Storage"
          value={
            deviceInfo.storageTotalKb > 0
              ? `${fmtStorageKb(deviceInfo.storageUsedKb)} / ${fmtStorageKb(deviceInfo.storageTotalKb)}`
              : '—'
          }
          mono
        />
      </KeyValueGroup>

      <KeyValueGroup title="Position">
        <KeyValueRow
          label="Location"
          value={
            hasLocation ? `${identity.lat?.toFixed(5)}, ${identity.lon?.toFixed(5)}` : 'Not set'
          }
          mono
        />
        <KeyValueRow
          label="Share in advert"
          value={identity.sharePositionInAdvert ? 'Yes' : 'No'}
          mono
        />
        <KeyValueRow
          label="GPS"
          value={gps.enabled ? `On · ${fmtGpsInterval(gps.intervalSec)}` : 'Off'}
          mono
        />
      </KeyValueGroup>
    </div>
  );
}
