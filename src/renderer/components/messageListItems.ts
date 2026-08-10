import type { Message } from '../../shared/types';
import { dayKey } from '../lib/time';

export type DateItem = { kind: 'date'; id: string; ts: number };
export type DividerItem = { kind: 'divider'; id: string };
export type MessageItem = { kind: 'msg'; m: Message };
export type Item = DateItem | DividerItem | MessageItem;

export const UNREAD_DIVIDER: DividerItem = { kind: 'divider', id: '__unread__' };

let dividerSeq = 0;

/**
 * A 'New' divider carrying an id nothing else will ever reuse.
 *
 * An item's id is its React key (see computeItemKey). Replanting the marker
 * with the constant id above makes React MOVE the existing DOM node rather than
 * mount a new one, so the list's ResizeObserver — which only fires when an
 * observed element's own size changes — never reports the divider again. That
 * matters because the library seeds an inserted index's height from the size
 * range it lands in, i.e. from the message that used to occupy that index: with
 * no measurement to correct it, a 26px marker goes on claiming a message's
 * worth of height, and since rows are absolutely positioned from the running
 * total, everything below the marker renders that much too low. That is the
 * empty gap under 'New'.
 *
 * Only the surgical delete+insert needs this. A wholesale rebuild is published
 * through data.replace, which re-measures every rendered row a frame later and
 * so heals a stale entry on its own — which is why buildItems can stay pure and
 * keep the constant id.
 */
export function freshUnreadDivider(): DividerItem {
  dividerSeq += 1;
  return { kind: 'divider', id: `__unread__#${dividerSeq}` };
}

function dateItem(ts: number): DateItem {
  return { kind: 'date', id: `date-${dayKey(ts)}`, ts };
}

// The read cursor should only advance for messages the user has actually seen —
// i.e. while the app window has focus. A message that arrives in the active
// conversation while the window is in the background must stay unread so its
// notification persists (otherwise the banner would flash and immediately clear
// when the auto-mark-read pushed uiState back to main). Given the currently
// rendered range, returns the max message ts to mark read, or null when nothing
// should advance (window unfocused, or no newer message on screen).
export function computeMarkReadTs(range: Item[], lastMarked: number, focused: boolean): number | null {
  if (!focused) return null;
  let maxTs = 0;
  for (const it of range) {
    if (it.kind === 'msg' && it.m.ts > maxTs) maxTs = it.m.ts;
  }
  return maxTs > lastMarked ? maxTs : null;
}

// Where the 'New' divider belongs in an ALREADY-MOUNTED list, given the read
// cursor as it stood when the app lost focus. -1 when nothing qualifies.
//
// buildItems can only place the divider during a wholesale rebuild, which
// happens on a conversation switch and nowhere else — so messages that arrived
// while the window was in the background never got a marker, even though they
// correctly stayed unread. This computes the offset for a surgical
// findAndDelete + insert instead, so the marker can appear without re-measuring
// the whole list under the user.
//
// The returned index is relative to the item array WITH any existing divider
// removed, because the caller deletes the old one in the same batch. A date
// separator immediately above the first unread message keeps its place: the
// index lands on the message, so the order stays date -> New -> message, the
// same as buildItems produces.
export function computeDividerInsertIdx(items: Item[], cutoff: number): number {
  if (!cutoff) return -1;
  let idx = 0;
  for (const it of items) {
    if (it.kind === 'divider') continue;
    if (it.kind === 'msg' && it.m.ts > cutoff && it.m.fromPublicKeyHex !== undefined) return idx;
    idx++;
  }
  return -1;
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
  let prevKey = 0;
  for (let i = 0; i < messages.length; i++) {
    const key = dayKey(messages[i].ts);
    if (i > 0 && key !== prevKey) {
      items.push(dateItem(messages[i].ts));
    }
    if (i === firstUnreadIdx) items.push(UNREAD_DIVIDER);
    items.push({ kind: 'msg', m: messages[i] });
    prevKey = key;
  }
  return items;
}

// Tail-append fast-path. Emits date separators within `newMsgs`, seeding the
// "previous day" from the last already-rendered message so the first appended
// message only gets a separator when it starts a new day. The unread divider is
// never produced here — it stays frozen at its original position above these.
export function buildAppended(newMsgs: Message[], prevLastMsg: Message): Item[] {
  const items: Item[] = [];
  let prevKey = dayKey(prevLastMsg.ts);
  for (const m of newMsgs) {
    const key = dayKey(m.ts);
    if (key !== prevKey) items.push(dateItem(m.ts));
    items.push({ kind: 'msg', m });
    prevKey = key;
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
  let prevKey = 0;
  for (let i = 0; i < olderMsgs.length; i++) {
    const key = dayKey(olderMsgs[i].ts);
    if (i > 0 && key !== prevKey) {
      items.push(dateItem(olderMsgs[i].ts));
    }
    items.push({ kind: 'msg', m: olderMsgs[i] });
    prevKey = key;
  }
  // prevKey now holds the last older message's day (when the batch is non-empty).
  if (olderMsgs.length > 0 && dayKey(existingHeadMsg.ts) !== prevKey) {
    items.push(dateItem(existingHeadMsg.ts));
  }
  return items;
}
