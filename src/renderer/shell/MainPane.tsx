import { Users } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
// Placeholder is small and used as a fallback — keep eager.
import { PlaceholderPanel } from '../panels/PlaceholderPanel';

// Each panel is loaded on demand; only one is visible at a time, so eagerly
// importing them all (~1.5k LOC of forms + tables) just bloats first paint.
const AppSettings = lazy(() =>
  import('../panels/AppSettings').then((m) => ({ default: m.AppSettings })),
);
const BleConnect = lazy(() =>
  import('../panels/BleConnect').then((m) => ({ default: m.BleConnect })),
);
const ChannelView = lazy(() =>
  import('../panels/ChannelView').then((m) => ({ default: m.ChannelView })),
);
const DMView = lazy(() => import('../panels/DMView').then((m) => ({ default: m.DMView })));
const Identity = lazy(() => import('../panels/Identity').then((m) => ({ default: m.Identity })));
const MapView = lazy(() => import('../panels/MapView').then((m) => ({ default: m.MapView })));
const RadioSettings = lazy(() =>
  import('../panels/RadioSettings').then((m) => ({ default: m.RadioSettings })),
);
const RepeaterAdmin = lazy(() =>
  import('../panels/repeater-admin').then((m) => ({ default: m.RepeaterAdmin })),
);
const SearchResults = lazy(() =>
  import('../panels/SearchResults').then((m) => ({ default: m.SearchResults })),
);

interface MainPaneProps {
  client: ApiClient | null;
  onScan: () => void;
  onConnect: (deviceId: string) => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
  renderPacketLog: () => React.ReactNode;
}

export function MainPane(props: MainPaneProps) {
  return (
    <Suspense fallback={null}>
      <MainPaneInner {...props} />
    </Suspense>
  );
}

function MainPaneInner({
  client,
  onScan,
  onConnect,
  onDisconnect,
  renderPacketLog,
}: MainPaneProps) {
  const activeKey = useStore((s) => s.ui.activeKey);
  const transportState = useStore((s) => s.transportState);
  const connectedDeviceId = useStore((s) => s.connectedDeviceId);
  const devices = useStore((s) => s.devices);
  const busy = useStore((s) => s.busy);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);

  if (activeKey === 'tool:bleconnect') {
    return (
      <div className="h-full w-full">
        <BleConnect
          state={transportState}
          devices={devices}
          connectedDeviceId={connectedDeviceId}
          onScan={onScan}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          busy={busy}
        />
      </div>
    );
  }

  if (activeKey === 'tool:packetlog') {
    return <div className="h-full w-full overflow-hidden p-4">{renderPacketLog()}</div>;
  }

  if (activeKey === 'tool:settings:app') {
    return <AppSettings client={client} />;
  }
  if (activeKey === 'tool:settings:radio') {
    return <RadioSettings client={client} />;
  }
  if (activeKey === 'tool:settings:identity') {
    return <Identity />;
  }
  if (activeKey === 'tool:map') {
    return <MapView client={client} />;
  }
  if (activeKey === 'tool:search') {
    return <SearchResults client={client} />;
  }
  if (activeKey === 'tool:contacts') {
    return (
      <PlaceholderPanel
        title="Contact Management"
        description="Dedicated contact list editor. Coming with the channels/contacts editor in Phase 8."
        icon={Users}
      />
    );
  }

  if (activeKey.startsWith('ch:')) {
    const ch = channels.find((c) => c.key === activeKey);
    if (!ch) {
      return (
        <PlaceholderPanel
          title="Unknown channel"
          description="This channel isn't in your local list. Add it from Channels."
        />
      );
    }
    return <ChannelView channel={ch} client={client} />;
  }
  if (activeKey.startsWith('c:')) {
    const contact = contacts.find((c) => c.key === activeKey);
    if (!contact) {
      return (
        <PlaceholderPanel
          title="Unknown contact"
          description="This contact isn't in your local list. Heard one over the radio? Add it from Contacts."
        />
      );
    }
    if (contact.kind === 'repeater' || contact.kind === 'sensor') {
      return <RepeaterAdmin contact={contact} client={client} />;
    }
    return <DMView contact={contact} client={client} />;
  }

  return (
    <PlaceholderPanel
      title="CoreSense"
      description="Pick a channel, contact, or tool from the left to begin."
    />
  );
}
