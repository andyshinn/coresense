import type { LucideIcon } from 'lucide-react';
import { Braces, Cog, FileText, Inbox, Map as MapIcon, Radio, ScrollText, Search, Users } from 'lucide-react';
import type { ToolKey } from '../../shared/keys';

export { TOOL_KEYS, type ToolKey } from '../../shared/keys';

export interface ToolDef {
  label: string;
  /** Compact label for the left nav, when it differs from `label`. */
  navLabel?: string;
  hint: string;
  icon: LucideIcon;
}

/**
 * Labels, hints and icons the command palette and the left nav both derive
 * from. Routing (MainPane, settings/routing.ts) still matches on the keys.
 */
export const TOOL_DEFS: Record<ToolKey, ToolDef> = {
  'tool:settings:app': { label: 'App Settings', navLabel: 'Settings', hint: 'Theme, notifications, proxy', icon: Cog },
  'tool:settings:radio': { label: 'Radio Settings', hint: 'Frequency, SF, TX power', icon: Radio },
  'tool:settings:identity': { label: 'Identity', hint: 'Owner name + public key', icon: Users },
  'tool:search': { label: 'Search Messages', navLabel: 'Search', hint: 'Full-text across channels + DMs', icon: Search },
  'tool:unreads': { label: 'Unreads', hint: 'All missed activity in one place', icon: Inbox },
  'tool:packetlog': { label: 'Packet Log', hint: 'Live RX/TX', icon: ScrollText },
  'tool:logs': { label: 'Logs', hint: 'View application logs', icon: FileText },
  'tool:map': { label: 'Map', hint: 'Contact locations', icon: MapIcon },
  'tool:contacts': { label: 'Contact Management', hint: 'Add / edit contacts', icon: Users },
  'tool:macros': { label: 'Macros', hint: 'Reusable message templates', icon: Braces },
  'tool:node': { label: 'My node', hint: 'Your radio: connection, telemetry, stats, position', icon: Radio },
};
