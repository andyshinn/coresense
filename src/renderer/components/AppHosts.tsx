import { lazy } from 'react';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { PathLearnedDialog } from './path/PathLearnedDialog';
import { StatusBar } from './StatusBar';

// Lazy: PacketLog pulls in react-virtual + the protocol decoder; we only need
// it when the user opens the packet log panel.
const PacketLog = lazy(() => import('./PacketLog').then((m) => ({ default: m.PacketLog })));

/** Subscribes to packets and renders the (lazy) PacketLog. */
export function PacketLogHost() {
  const packets = useStore((s) => s.packets);
  return <PacketLog packets={packets} />;
}

/** Wires store slices into the bottom StatusBar. */
export function StatusBarHost({ port }: { port: number | null }) {
  const transportState = useStore((s) => s.transportState);
  const bridge = useStore((s) => s.bridge);
  const wsClients = useStore((s) => s.wsClients);
  return (
    <StatusBar port={port} wsClients={wsClients} transportState={transportState} bridge={bridge} />
  );
}

/** Shows the path-learned confirmation dialog when one is pending. */
export function PathLearnedDialogHost({ client }: { client: ApiClient | null }) {
  const event = useStore((s) => s.pendingPathLearn);
  const contact = useStore((s) =>
    event ? (s.contacts.find((c) => c.key === event.contactKey) ?? null) : null,
  );
  const dismiss = useStore((s) => s.dismissPathLearned);
  return <PathLearnedDialog event={event} contact={contact} client={client} onClose={dismiss} />;
}
