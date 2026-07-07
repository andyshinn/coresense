import type { Message } from '../../shared/types';
import { dayKey } from '../lib/time';

export type DateItem = { kind: 'date'; id: string; ts: number };
export type DividerItem = { kind: 'divider'; id: '__unread__' };
export type MessageItem = { kind: 'msg'; m: Message };
export type Item = DateItem | DividerItem | MessageItem;

const UNREAD_DIVIDER: DividerItem = { kind: 'divider', id: '__unread__' };

function dateItem(ts: number): DateItem {
  return { kind: 'date', id: `date-${dayKey(ts)}`, ts };
}

// Index of the first message newer than the unread cutoff that wasn't sent by
// the owner (self-sent messages never count as "unread"). -1 when none.
export function computeFirstUnreadIdx(messages: Message[], cutoff: number): number {
  if (!cutoff) return -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].ts > cutoff && messages[i].fromPublicKeyHex !== undefined) return i;
  }
  return -1;
}

// Full rebuild. Inserts a date separator before any message whose local
// calendar day differs from the previous message's (labeled with the newer
// day), and the unread divider before firstUnreadIdx. When both land at the
// same index the order is date -> unread -> message. No separator precedes the
// first message.
export function buildItems(messages: Message[], firstUnreadIdx: number): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i > 0 && dayKey(messages[i].ts) !== dayKey(messages[i - 1].ts)) {
      items.push(dateItem(messages[i].ts));
    }
    if (i === firstUnreadIdx) items.push(UNREAD_DIVIDER);
    items.push({ kind: 'msg', m: messages[i] });
  }
  return items;
}

// Tail-append fast-path. Emits date separators within `newMsgs`, seeding the
// "previous day" from the last already-rendered message so the first appended
// message only gets a separator when it starts a new day. The unread divider is
// never produced here — it stays frozen at its original position above these.
export function buildAppended(newMsgs: Message[], prevLastMsg: Message): Item[] {
  const items: Item[] = [];
  let prevTs = prevLastMsg.ts;
  for (const m of newMsgs) {
    if (dayKey(m.ts) !== dayKey(prevTs)) items.push(dateItem(m.ts));
    items.push({ kind: 'msg', m });
    prevTs = m.ts;
  }
  return items;
}

// Head-prepend (load-older) fast-path. Emits date separators at day
// transitions *within* `olderMsgs` (never above the batch's new topmost
// message), then a single boundary separator between the last older message and
// the existing head iff their days differ (labeled with the head's day). Keeps
// the invariant that the current topmost message never has a separator above
// it, so prepend never produces a duplicate.
export function buildPrepended(olderMsgs: Message[], existingHeadMsg: Message): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < olderMsgs.length; i++) {
    if (i > 0 && dayKey(olderMsgs[i].ts) !== dayKey(olderMsgs[i - 1].ts)) {
      items.push(dateItem(olderMsgs[i].ts));
    }
    items.push({ kind: 'msg', m: olderMsgs[i] });
  }
  const lastOlder = olderMsgs[olderMsgs.length - 1];
  if (lastOlder && dayKey(existingHeadMsg.ts) !== dayKey(lastOlder.ts)) {
    items.push(dateItem(existingHeadMsg.ts));
  }
  return items;
}
