import type { Contact, Message, MessageHop, MessagePath } from '../../../../shared/types';
import { PathViewer } from '../../../components/path/PathViewer';
import { Placeholder } from '../atoms';

/** Path timeline showing how a message reached the local radio. */
export function HeardViaSection({ message, repeaters }: { message: Message; repeaters: Contact[] }) {
  const paths = message.meta?.paths ?? [];
  const fallbackHops = message.meta?.hops;

  // Fallback for messages without correlated mesh observations (e.g. ones that
  // came in before the bridge connected): synthesize a single path of N
  // unnamed hops from the hop count alone so the user still sees a timeline.
  const effectivePaths: MessagePath[] =
    paths.length > 0
      ? paths
      : fallbackHops != null && fallbackHops > 0
        ? [synthesizeUnnamedPath(message, fallbackHops)]
        : [];

  if (effectivePaths.length === 0) return <Placeholder label="no path data" />;

  return <PathViewer paths={effectivePaths} timesHeard={message.meta?.timesHeard ?? 1} knownRepeaters={repeaters} />;
}

/** Build a placeholder path from a bare hop count when no observations exist. */
function synthesizeUnnamedPath(message: Message, hopCount: number): MessagePath {
  const hops: MessageHop[] = [];
  const senderName = message.fromPublicKeyHex?.startsWith('name:') ? message.fromPublicKeyHex.slice(5) : null;
  hops.push({
    kind: 'origin',
    shortId: senderName ? senderName.slice(0, 2).toLowerCase() : '??',
    name: senderName ?? null,
    pk: null,
    unnamed: senderName == null,
  });
  for (let i = 0; i < hopCount; i++) {
    hops.push({ kind: 'hop', shortId: '??', name: null, pk: null, unnamed: true });
  }
  hops.push({ kind: 'sink', shortId: 'me', name: 'My radio', pk: null });
  return {
    id: `synth-${message.id}`,
    hops,
    hashMode: 1,
    finalSnr: message.meta?.snr ?? 0,
  };
}
