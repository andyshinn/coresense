import { MapIcon, Users } from 'lucide-react';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { AppSettings } from '../panels/AppSettings';
import { BleConnect } from '../panels/BleConnect';
import { ChannelView } from '../panels/ChannelView';
import { DMView } from '../panels/DMView';
import { Identity } from '../panels/Identity';
import { PlaceholderPanel } from '../panels/PlaceholderPanel';
import { RadioSettings } from '../panels/RadioSettings';
import { RepeaterAdmin } from '../panels/repeater-admin';

interface MainPaneProps {
  client: ApiClient | null;
  onScan: () => void;
  onConnect: (deviceId: string) => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
  renderPacketLog: () => React.ReactNode;
}

export function MainPane({
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
    return (
      <PlaceholderPanel
        title="Map"
        description="Plot contacts with known positions. Deferred to post-v1."
        icon={MapIcon}
      />
    );
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
