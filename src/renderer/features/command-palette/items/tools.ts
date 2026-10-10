import { Hash, MessageCircle, Radio } from 'lucide-react';
import { TOOL_DEFS, TOOL_KEYS } from '../../../lib/tools';
import type { PaletteItem } from '../types';

export const TOOL_ITEMS = TOOL_KEYS.map((key) => ({ key, ...TOOL_DEFS[key] }));

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
