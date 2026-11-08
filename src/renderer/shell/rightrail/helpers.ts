import { isChannelKey, isContactKey } from '../../../shared/conversationKey';
import { NODE_TELEMETRY_KEY } from '../../../shared/keys';

/** View "kind" derived from activeKey. Each kind has its own rail section set. */
export type ViewKind = 'channel' | 'dm' | 'packetlog' | 'tool' | 'none';

/** Classify the active route key into a rail view kind. */
export function viewKindFor(activeKey: string): ViewKind {
  if (isChannelKey(activeKey)) return 'channel';
  if (isContactKey(activeKey)) return 'dm';
  if (activeKey === 'tool:packetlog') return 'packetlog';
  // My Node is a full-width dashboard; its telemetry sub-view has a rail.
  if (activeKey === 'tool:node') return 'none';
  if (activeKey.startsWith('tool:')) return 'tool';
  return 'none';
}

/** Header title shown at the top of the rail. */
export function railTitle(activeKey: string): string {
  if (activeKey.startsWith('tool:settings')) return 'Settings';
  if (activeKey === 'tool:contacts') return 'Contacts';
  if (activeKey === 'tool:map') return 'Map';
  if (activeKey === 'tool:macros') return 'Reference';
  if (activeKey === NODE_TELEMETRY_KEY) return 'Telemetry sharing';
  const kind = viewKindFor(activeKey);
  switch (kind) {
    case 'channel':
      return 'Channel';
    case 'dm':
      return 'Contact';
    case 'packetlog':
      return 'Packet';
    default:
      return 'Details';
  }
}
