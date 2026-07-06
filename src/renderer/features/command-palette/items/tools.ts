import { Braces, Cog, FileText, Hash, Inbox, MapIcon, MessageCircle, Radio, ScrollText, Search, Users } from 'lucide-react';
import type { PaletteItem, ToolItem } from '../types';

export const TOOL_ITEMS: ToolItem[] = [
  {
    key: 'tool:settings:app',
    label: 'App Settings',
    hint: 'Theme, notifications, proxy',
    icon: Cog,
  },
  {
    key: 'tool:settings:radio',
    label: 'Radio Settings',
    hint: 'Frequency, SF, TX power',
    icon: Radio,
  },
  {
    key: 'tool:settings:identity',
    label: 'Identity',
    hint: 'Owner name + public key',
    icon: Users,
  },
  {
    key: 'tool:search',
    label: 'Search Messages',
    hint: 'Full-text across channels + DMs',
    icon: Search,
  },
  {
    key: 'tool:unreads',
    label: 'Unreads',
    hint: 'All missed activity in one place',
    icon: Inbox,
  },
  { key: 'tool:packetlog', label: 'Packet Log', hint: 'Live RX/TX', icon: ScrollText },
  { key: 'tool:logs', label: 'Logs', hint: 'View application logs', icon: FileText },
  { key: 'tool:map', label: 'Map', hint: 'Contact locations', icon: MapIcon },
  { key: 'tool:contacts', label: 'Contact Management', hint: 'Add / edit contacts', icon: Users },
  { key: 'tool:macros', label: 'Macros', hint: 'Reusable message templates', icon: Braces },
  {
    key: 'tool:bleconnect',
    label: 'BLE Connect',
    hint: 'Scan + connect a radio',
    icon: Radio,
  },
];

export function resolveKeyItem(
  key: string,
  channels: Array<{ key: string; name: string }>,
  contacts: Array<{ key: string; name: string; kind: string }>,
): Pick<PaletteItem, 'id' | 'label' | 'hint' | 'icon' | 'keywords'> | null {
  if (key.startsWith('ch:')) {
    const ch = channels.find((c) => c.key === key);
    if (!ch) return null;
    return { id: `recent:${key}`, label: ch.name, hint: 'channel', icon: Hash, keywords: key };
  }
  if (key.startsWith('c:')) {
    const c = contacts.find((x) => x.key === key);
    if (!c) return null;
    return {
      id: `recent:${key}`,
      label: c.name,
      hint: c.kind,
      icon: c.kind === 'repeater' ? Radio : MessageCircle,
      keywords: key,
    };
  }
  const tool = TOOL_ITEMS.find((t) => t.key === key);
  if (tool) {
    return { id: `recent:${key}`, label: tool.label, hint: tool.hint, icon: tool.icon };
  }
  return null;
}
