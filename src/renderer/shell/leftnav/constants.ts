import type { LucideIcon } from 'lucide-react';
import { Activity, DoorOpen, Radio, Users } from 'lucide-react';
import type { ContactKind } from '../../../shared/types';
import { TOOL_DEFS, type ToolKey } from '../../lib/tools';

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

/** Static tools rendered below the conversations section, in nav order. */
const NAV_TOOL_KEYS: ToolKey[] = [
  'tool:search',
  'tool:packetlog',
  'tool:contacts',
  'tool:map',
  'tool:macros',
  'tool:settings:app',
];

export const TOOLS = NAV_TOOL_KEYS.map((key) => {
  const { label, navLabel, icon } = TOOL_DEFS[key];
  return { key, label: navLabel ?? label, icon };
});
