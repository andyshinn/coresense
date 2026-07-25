import { lazy, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { logError, PanelErrorFallback } from '../components/errors/ErrorFallback';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
// Placeholder is small and used as a fallback — keep eager.
import { PlaceholderPanel } from '../panels/PlaceholderPanel';
import { tabFromActiveKey } from '../panels/settings/routing';

// Each panel is loaded on demand; only one is visible at a time, so eagerly
// importing them all (~1.5k LOC of forms + tables) just bloats first paint.
const SettingsPanel = lazy(() => import('../panels/settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })));
const BleConnect = lazy(() => import('../panels/BleConnect').then((m) => ({ default: m.BleConnect })));
const ChannelView = lazy(() => import('../panels/ChannelView').then((m) => ({ default: m.ChannelView })));
const DMView = lazy(() => import('../panels/DMView').then((m) => ({ default: m.DMView })));
const MapView = lazy(() => import('../panels/MapView').then((m) => ({ default: m.MapView })));
const RepeaterAdmin = lazy(() => import('../panels/repeater-admin').then((m) => ({ default: m.RepeaterAdmin })));
const SearchResults = lazy(() => import('../panels/search').then((m) => ({ default: m.SearchResults })));
const Unreads = lazy(() => import('../panels/Unreads').then((m) => ({ default: m.Unreads })));
const LogsPanel = lazy(() => import('../panels/logs').then((m) => ({ default: m.LogsPanel })));
const ContactManager = lazy(() => import('../panels/contacts/ContactManager').then((m) => ({ default: m.ContactManager })));
const MacrosPanel = lazy(() => import('../panels/macros/MacrosPanel').then((m) => ({ default: m.MacrosPanel })));

interface MainPaneProps {
  client: ApiClient | null;
  onScan: () => void;
  onConnect: (deviceId: string) => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
  renderPacketLog: () => React.ReactNode;
}

export function MainPane(props: MainPaneProps) {
  // Keyed on the active panel so a crashed panel auto-clears the moment the
  // user navigates elsewhere — no stale fallback lingering on the next view.
  const activeKey = useStore((s) => s.ui.activeKey);
  return (
    <ErrorBoundary FallbackComponent={PanelErrorFallback} resetKeys={[activeKey]} onError={logError}>
      <Suspense fallback={null}>
        <MainPaneInner {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

function MainPaneInner({ client, onScan, onConnect, onDisconnect, renderPacketLog }: MainPaneProps) {
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
    return <div className="flex h-full w-full flex-col overflow-hidden p-4">{renderPacketLog()}</div>;
  }

  if (activeKey === 'tool:settings' || activeKey.startsWith('tool:settings:')) {
    // Decode the legacy "tool:settings:<id>" deep links so older menu items
    // still land on the right tab inside the new SettingsPanel.
    return <SettingsPanel client={client} initialTab={tabFromActiveKey(activeKey)} />;
  }
  if (activeKey === 'tool:map') {
    return <MapView client={client} />;
  }
  if (activeKey === 'tool:logs') {
    return <LogsPanel />;
  }
  if (activeKey === 'tool:search') {
    return <SearchResults client={client} />;
  }
  if (activeKey === 'tool:unreads') {
    return <Unreads client={client} />;
  }
  if (activeKey === 'tool:contacts') {
    return <ContactManager client={client} />;
  }
  if (activeKey === 'tool:macros') {
    return <MacrosPanel client={client} />;
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

  return <PlaceholderPanel title="CoreSense" description="Pick a channel, contact, or tool from the left to begin." />;
}
