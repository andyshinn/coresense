import { Hash, Inbox, MessageCircle, Radio } from 'lucide-react';
import type { ActiveKey } from '../../../../shared/keys';
import type { Channel, Contact, Message } from '../../../../shared/types';
import { computeUnreadConversations } from '../../../lib/unreads';
import type { PaletteItem } from '../types';
import { TOOL_ITEMS } from './tools';

export interface BuildGotoArgs {
  channels: Channel[];
  contacts: Contact[];
  activeKey: string;
  messagesByKey: Record<string, Message[]>;
  lastReadByKey: Record<string, number>;
  setActiveKey: (key: ActiveKey) => void;
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

  // Same unread rules and newest-first order as the LeftNav badges, the
  // Unreads panel and keyboard next-unread.
  const unread = computeUnreadConversations(messagesByKey, lastReadByKey, channels, contacts);
  const target = unread.find((u) => u.key !== activeKey)?.key;
  if (target) {
    const total = unread.reduce((n, u) => n + u.count, 0);
    list.push({
      id: 'goto:unread',
      label: `Jump to unread (${total})`,
      hint: target,
      group: 'goto',
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
      icon: tool.icon,
      run: () => {
        setActiveKey(tool.key);
        close();
      },
    });
  }

  return list;
}
