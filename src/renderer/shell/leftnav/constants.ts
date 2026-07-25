import type { LucideIcon } from 'lucide-react';
import { Activity, Braces, Cog, DoorOpen, Map as MapIcon, Radio, ScrollText, Search, Users } from 'lucide-react';
import type { ContactKind } from '../../../shared/types';

/** Icon used for each contact-kind group header in the nav tree. */
export const CONTACT_GROUP_ICON: Record<ContactKind, LucideIcon> = {
  chat: Users,
  repeater: Radio,
  room: DoorOpen,
  sensor: Activity,
};

/** Plural label used for each contact-kind group header in the nav tree. */
export const CONTACT_GROUP_LABEL: Record<ContactKind, string> = {
  chat: 'Users',
  repeater: 'Repeaters',
  room: 'Room Servers',
  sensor: 'Sensors',
};

/** Render order for the four contact-kind groups. */
export const CONTACT_GROUP_ORDER: ContactKind[] = ['chat', 'repeater', 'room', 'sensor'];

/** Single entry in the static tools section of the left nav. */
export interface ToolEntry {
  key: string;
  label: string;
  icon: LucideIcon;
}

/** Static tools rendered below the conversations section. */
export const TOOLS: ToolEntry[] = [
  { key: 'tool:search', label: 'Search', icon: Search },
  { key: 'tool:packetlog', label: 'Packet Log', icon: ScrollText },
  { key: 'tool:contacts', label: 'Contact Management', icon: Users },
  { key: 'tool:map', label: 'Map', icon: MapIcon },
  { key: 'tool:macros', label: 'Macros', icon: Braces },
  { key: 'tool:settings:app', label: 'Settings', icon: Cog },
];
