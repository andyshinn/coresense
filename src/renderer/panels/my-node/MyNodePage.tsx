import { useRememberLastDevice } from '../../features/connection/ConnectionParts';
import { useCurrentNode } from '../../features/my-node/currentNode';
import { useNodePoll } from '../../features/my-node/useNodePoll';
import { useApiClient } from '../../lib/apiClientContext';
import { loadLastDevice } from '../../lib/lastDevice';
import { useStore } from '../../lib/store';
import { AdvertCard } from './cards/AdvertCard';
import { DeviceCard } from './cards/DeviceCard';
import { IdentityCard } from './cards/IdentityCard';
import { LocationCard } from './cards/LocationCard';
import { RadioCard } from './cards/RadioCard';
import { RadioConnectionCard } from './cards/RadioConnectionCard';
import { RadioStatsCard } from './cards/RadioStatsCard';
import { TelemetryCard } from './cards/TelemetryCard';
import { NodeHeader } from './NodeHeader';

// Column spans per main-pane width (container queries on the scroll area, not
// the viewport: the left nav and right rail decide the pane's width).
//   < 640 px      one column
//   640–1099 px   two columns
//   ≥ 1100 px     twelve: Telemetry 5 · Device 4 · Radio 3 / Location 7 ·
//                 Stats 5 / Identity 6 · Advert 6
const SPAN = {
  telemetry: '@min-[640px]:col-span-2 @min-[1100px]:col-span-5',
  device: '@min-[1100px]:col-span-4',
  radio: '@min-[1100px]:col-span-3',
  location: '@min-[640px]:col-span-2 @min-[1100px]:col-span-7',
  locationAlone: '@min-[640px]:col-span-2 @min-[1100px]:col-span-12',
  stats: '@min-[640px]:col-span-2 @min-[1100px]:col-span-5',
  half: '@min-[1100px]:col-span-6',
  connection: '@min-[640px]:col-span-2 @min-[1100px]:col-span-5',
  identityOffline: '@min-[640px]:col-span-2 @min-[1100px]:col-span-4',
} as const;

interface Props {
  onScan: () => void;
  onConnect: (deviceId: string) => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
}

/** My Node (`tool:node`): a dashboard about the user's own radio. Replaces
 *  the Radio Connection panel; disconnected, the connection controls are its
 *  first card. */
export function MyNodePage({ onScan, onConnect, onDisconnect }: Props) {
  const client = useApiClient();
  const transportState = useStore((s) => s.transportState);
  const connected = transportState === 'connected';
  const ownerKey = useStore((s) => s.owner?.publicKeyHex ?? null);
  const devices = useStore((s) => s.devices);
  const connectedDeviceId = useStore((s) => s.connectedDeviceId);
  const busy = useStore((s) => s.busy);
  const entry = useCurrentNode();
  const poll = useNodePoll(client, connected);
  useRememberLastDevice(transportState, connectedDeviceId, devices, loadLastDevice()?.name ?? null);

  const linkName =
    devices.find((d) => d.id === connectedDeviceId)?.name ?? loadLastDevice()?.name ?? connectedDeviceId ?? null;
  const showStats = connected && poll.stats.supported;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NodeHeader
        connected={connected}
        linkName={linkName}
        entry={entry}
        busy={busy}
        onDisconnect={() => void onDisconnect()}
      />
      <div className="@container min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2 @min-[1100px]:grid-cols-12">
          {connected && ownerKey ? (
            <>
              <TelemetryCard className={SPAN.telemetry} stream={poll.telemetry} connected={connected} ownerKey={ownerKey} />
              <DeviceCard className={SPAN.device} />
              <RadioCard className={SPAN.radio} />
              <LocationCard className={showStats ? SPAN.location : SPAN.locationAlone} />
              {showStats && <RadioStatsCard className={SPAN.stats} stream={poll.stats} />}
              <IdentityCard className={SPAN.half} />
              <AdvertCard className={SPAN.half} />
            </>
          ) : (
            <>
              <RadioConnectionCard
                className={SPAN.connection}
                state={transportState}
                devices={devices}
                busy={busy}
                onScan={onScan}
                onConnect={(id) => void onConnect(id)}
              />
              <IdentityCard className={SPAN.identityOffline} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
