import { Hash, Inbox, MessageCircle, Radio } from 'lucide-react';
import type { Channel, Contact, Message } from '../../../../shared/types';
import type { PaletteItem } from '../types';
import { TOOL_ITEMS } from './tools';

export interface BuildGotoArgs {
  channels: Channel[];
  contacts: Contact[];
  activeKey: string;
  messagesByKey: Record<string, Message[]>;
  lastReadByKey: Record<string, number>;
  setActiveKey: (key: string) => void;
  close: () => void;
}

export function buildGotoItems({
  channels,
  contacts,
  activeKey,
  messagesByKey,
  lastReadByKey,
  setActiveKey,
  close,
}: BuildGotoArgs): PaletteItem[] {
  const list: PaletteItem[] = [];

  let unreadKey: string | null = null;
  let unreadCount = 0;
  // Muted conversations are excluded from the unread tally so this matches
  // the LeftNav badge and the Unreads panel.
  const allConvs = [...channels, ...contacts];
  for (const conv of allConvs) {
    if (conv.muted) continue;
    const key = conv.key;
    const msgs = messagesByKey[key];
    if (!msgs || msgs.length === 0) continue;
    const lastRead = lastReadByKey[key] ?? 0;
    const unread = msgs.filter((m) => m.ts > lastRead).length;
    if (unread > 0) {
      unreadCount += unread;
      if (!unreadKey && key !== activeKey) unreadKey = key;
    }
  }
  if (unreadKey && unreadCount > 0) {
    const target = unreadKey;
    list.push({
      id: 'goto:unread',
      label: `Jump to unread (${unreadCount})`,
      hint: target,
      group: 'goto',
      groupLabel: 'Go to',
      icon: Inbox,
      keywords: 'unread jump inbox',
      run: () => {
        setActiveKey(target);
        close();
      },
    });
  }

  for (const ch of channels) {
    if (ch.key === activeKey) continue;
    list.push({
      id: `goto:${ch.key}`,
      label: ch.name,
      hint: ch.key,
      group: 'goto',
      groupLabel: 'Go to',
      icon: Hash,
      keywords: ch.key,
      run: () => {
        setActiveKey(ch.key);
        close();
      },
    });
  }
  for (const c of contacts) {
    if (c.key === activeKey) continue;
    list.push({
      id: `goto:${c.key}`,
      label: c.name,
      hint:
        c.kind === 'repeater' ? 'Repeater' : c.kind === 'room' ? 'Room' : c.kind === 'sensor' ? 'Sensor' : 'Direct message',
      group: 'goto',
      groupLabel: 'Go to',
      icon: c.kind === 'repeater' ? Radio : MessageCircle,
      keywords: c.publicKeyHex,
      run: () => {
        setActiveKey(c.key);
        close();
      },
    });
  }
  for (const tool of TOOL_ITEMS) {
    if (tool.key === activeKey) continue;
    list.push({
      id: `goto:${tool.key}`,
      label: tool.label,
      hint: tool.hint,
      group: 'goto',
      groupLabel: 'Go to',
      icon: tool.icon,
      run: () => {
        setActiveKey(tool.key);
        close();
      },
    });
  }

  return list;
}
