import { useMemo } from 'react';
import type { Channel, ChannelKind, Contact, ContactKind, Message } from '../../shared/types';
import { useStore } from '../lib/store';

// One conversation (channel / DM / room) that has unread messages, with the
// unread messages themselves attached so the Unreads panel can render previews
// without re-scanning the store.
export interface UnreadConversation {
  key: string; // 'ch:*' | 'c:*'
  name: string;
  kind: 'channel' | 'contact';
  channelKind?: ChannelKind;
  contactKind?: ContactKind;
  count: number;
  /** Unread messages only, ascending by timestamp. */
  messages: Message[];
  /** Timestamp of the newest unread message — drives the "last X ago" label. */
  lastTs: number;
}

// A message is unread when it was received (so our own sends never count), its
// timestamp is past the per-conversation last-read marker, and main hasn't
// annotated it as blocked. Blocked messages must not surface in the LeftNav
// badges or the Unreads panel — counts and preview rows both fall to whatever
// remains.
function isUnread(m: Message, lastRead: number): boolean {
  return m.state === 'received' && m.ts > lastRead && m.meta?.blocked !== true;
}

// Pure per-conversation unread count. Shared by the LeftNav badges and the
// Unreads panel so both agree on what "unread" means. Muted conversations are
// suppressed entirely — they never contribute an unread badge or count.
export function computeUnreadByKey(
  messagesByKey: Record<string, Message[]>,
  lastReadByKey: Record<string, number>,
  mutedKeys: Set<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, list] of Object.entries(messagesByKey)) {
    if (mutedKeys.has(key)) continue;
    const lastRead = lastReadByKey[key] ?? 0;
    let count = 0;
    for (const m of list) {
      if (isUnread(m, lastRead)) count += 1;
    }
    if (count > 0) out[key] = count;
  }
  return out;
}

// Set of conversation keys the user has muted — channels and contacts alike.
function collectMutedKeys(channels: Channel[], contacts: Contact[]): Set<string> {
  const muted = new Set<string>();
  for (const ch of channels) if (ch.muted) muted.add(ch.key);
  for (const c of contacts) if (c.muted) muted.add(c.key);
  return muted;
}

// Counts-only hook — what the LeftNav needs for its unread badges.
export function useUnreadByKey(): Record<string, number> {
  const messagesByKey = useStore((s) => s.messagesByKey);
  const lastReadByKey = useStore((s) => s.ui.lastReadByKey);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  return useMemo(
    () => computeUnreadByKey(messagesByKey, lastReadByKey, collectMutedKeys(channels, contacts)),
    [messagesByKey, lastReadByKey, channels, contacts],
  );
}

// Pure core of useUnreadConversations — shared with non-React callers (e.g. the
// keyboard unread-nav selector). Joins unread keys against the channel/contact
// lists; keys with no matching conversation are dropped. Sorted newest-first.
export function computeUnreadConversations(
  messagesByKey: Record<string, Message[]>,
  lastReadByKey: Record<string, number>,
  channels: Channel[],
  contacts: Contact[],
): UnreadConversation[] {
  const channelByKey = new Map<string, Channel>();
  for (const ch of channels) channelByKey.set(ch.key, ch);
  const contactByKey = new Map<string, Contact>();
  for (const c of contacts) contactByKey.set(c.key, c);

  const out: UnreadConversation[] = [];
  for (const [key, list] of Object.entries(messagesByKey)) {
    const lastRead = lastReadByKey[key] ?? 0;
    const unread = list.filter((m) => isUnread(m, lastRead)).sort((a, b) => a.ts - b.ts);
    if (unread.length === 0) continue;
    const lastTs = unread[unread.length - 1].ts;

    const channel = channelByKey.get(key);
    if (channel) {
      if (channel.muted) continue;
      out.push({
        key,
        name: channel.name,
        kind: 'channel',
        channelKind: channel.kind,
        count: unread.length,
        messages: unread,
        lastTs,
      });
      continue;
    }
    const contact = contactByKey.get(key);
    if (contact) {
      if (contact.muted) continue;
      out.push({
        key,
        name: contact.name,
        kind: 'contact',
        contactKind: contact.kind,
        count: unread.length,
        messages: unread,
        lastTs,
      });
    }
  }
  out.sort((a, b) => b.lastTs - a.lastTs);
  return out;
}

// Rich aggregate hook — what the Unreads panel needs.
export function useUnreadConversations(): UnreadConversation[] {
  const messagesByKey = useStore((s) => s.messagesByKey);
  const lastReadByKey = useStore((s) => s.ui.lastReadByKey);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);

  return useMemo(
    () => computeUnreadConversations(messagesByKey, lastReadByKey, channels, contacts),
    [messagesByKey, lastReadByKey, channels, contacts],
  );
}
