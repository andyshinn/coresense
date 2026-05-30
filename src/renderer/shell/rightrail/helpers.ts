/** View "kind" derived from activeKey. Each kind has its own rail section set. */
export type ViewKind = 'channel' | 'dm' | 'repeater' | 'packetlog' | 'tool' | 'none';

/** Classify the active route key into a rail view kind. */
export function viewKindFor(activeKey: string): ViewKind {
  if (activeKey.startsWith('ch:')) return 'channel';
  if (activeKey.startsWith('c:')) return 'dm'; // Repeater contacts route to 'repeater' once the protocol layer differentiates.
  if (activeKey === 'tool:packetlog') return 'packetlog';
  if (activeKey === 'tool:bleconnect') return 'none';
  if (activeKey.startsWith('tool:')) return 'tool';
  return 'none';
}

/** Header title shown at the top of the rail. */
export function railTitle(activeKey: string): string {
  if (activeKey.startsWith('tool:settings')) return 'Settings';
  if (activeKey === 'tool:contacts') return 'Contacts';
  if (activeKey === 'tool:map') return 'Map';
  const kind = viewKindFor(activeKey);
  switch (kind) {
    case 'channel':
      return 'Channel';
    case 'dm':
      return 'Contact';
    case 'repeater':
      return 'Repeater';
    case 'packetlog':
      return 'Packet';
    case 'tool':
      return 'Details';
    default:
      return 'Details';
  }
}
