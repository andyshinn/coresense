import { describe, expect, it } from 'vitest';
import {
  buildItems,
  computeDividerInsertIdx,
  computeMarkReadTs,
  freshUnreadDivider,
  type Item,
  UNREAD_DIVIDER,
} from '../../../../src/renderer/components/messageListItems';
import { shouldShowUnread } from '../../../../src/renderer/hooks/useUnreads';
import type { Message } from '../../../../src/shared/types';

const T0 = new Date('2026-07-25T12:00:00').getTime();
const DAY = 86_400_000;

const from = (id: string, ts: number): Message => ({
  id,
  key: 'ch:x',
  body: id,
  ts,
  state: 'received',
  fromPublicKeyHex: 'alicepk',
});

const mine = (id: string, ts: number): Message => ({ id, key: 'ch:x', body: id, ts, state: 'sent' });

describe('computeDividerInsertIdx', () => {
  it('returns -1 when there is no cursor to compare against', () => {
    expect(computeDividerInsertIdx(buildItems([from('a', T0)], -1), 0)).toBe(-1);
  });

  it('returns -1 when nothing arrived after the cursor', () => {
    const items = buildItems([from('a', T0), from('b', T0 + 1000)], -1);
    expect(computeDividerInsertIdx(items, T0 + 5000)).toBe(-1);
  });

  it('points at the first message newer than the cursor', () => {
    const items = buildItems([from('a', T0), from('b', T0 + 1000), from('c', T0 + 2000)], -1);
    expect(computeDividerInsertIdx(items, T0 + 500)).toBe(1);
  });

  // Our own sends are never "unread", so a burst that is only our own echoes
  // must not plant a marker.
  it('skips our own sends when locating the boundary', () => {
    const items = buildItems([from('a', T0), mine('b', T0 + 1000), from('c', T0 + 2000)], -1);
    expect(computeDividerInsertIdx(items, T0 + 500)).toBe(2);
  });

  it('returns -1 when everything after the cursor is our own', () => {
    const items = buildItems([from('a', T0), mine('b', T0 + 1000)], -1);
    expect(computeDividerInsertIdx(items, T0 + 500)).toBe(-1);
  });

  // The caller deletes the existing divider in the same batch, so the index has
  // to be relative to the array WITHOUT it — otherwise a second focus cycle
  // plants the new marker one row too low.
  it('ignores a divider already in the list', () => {
    const msgs = [from('a', T0), from('b', T0 + 1000), from('c', T0 + 2000)];
    const withDivider = buildItems(msgs, 1);
    expect(withDivider.filter((i) => i.kind === 'divider')).toHaveLength(1);
    expect(computeDividerInsertIdx(withDivider, T0 + 1500)).toBe(2);
  });

  // buildItems emits date -> New -> message. A surgical insert has to land in
  // the same place, i.e. below the date separator, not above it.
  it('lands below a date separator, matching a full rebuild', () => {
    const msgs = [from('a', T0), from('b', T0 + DAY)];
    const items = buildItems(msgs, -1);
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'msg']);
    const idx = computeDividerInsertIdx(items, T0 + 500);
    expect(idx).toBe(2);

    const spliced = [...items];
    spliced.splice(idx, 0, { kind: 'divider', id: '__unread__' });
    expect(spliced.map((i) => i.kind)).toEqual(buildItems(msgs, 1).map((i: Item) => i.kind));
  });
});

// The id is the row's React key. A replant that hands back the key the list is
// already rendering makes React move that DOM node rather than mount a new one,
// so the list never re-measures it and the marker keeps the height of the
// message that used to occupy the index — the gap under 'New'.
describe('freshUnreadDivider', () => {
  it('never repeats an id', () => {
    const ids = [freshUnreadDivider().id, freshUnreadDivider().id, freshUnreadDivider().id];
    expect(new Set(ids).size).toBe(3);
  });

  it('never collides with the id a rebuild uses', () => {
    expect(freshUnreadDivider().id).not.toBe(UNREAD_DIVIDER.id);
  });

  it('is still a divider item', () => {
    expect(freshUnreadDivider().kind).toBe('divider');
  });
});

describe('mark-read is gated on window focus', () => {
  const range: Item[] = [{ kind: 'msg', m: from('a', T0) }];

  it('does not advance the cursor while the window is unfocused', () => {
    expect(computeMarkReadTs(range, 0, false)).toBeNull();
  });

  it('advances once focus returns', () => {
    expect(computeMarkReadTs(range, 0, true)).toBe(T0);
  });
});

describe('shouldShowUnread', () => {
  it('shows the count on a conversation you are not looking at', () => {
    expect(shouldShowUnread(3, false, true)).toBe(true);
  });

  it('hides it on the conversation you are actively reading', () => {
    expect(shouldShowUnread(3, true, true)).toBe(false);
  });

  // The reported gap: sit on a channel, switch away from the app, come back to
  // a row that shows nothing despite messages having arrived.
  it('shows it on the active conversation while the app is in the background', () => {
    expect(shouldShowUnread(3, true, false)).toBe(true);
  });

  it('shows nothing when there is nothing unread, focused or not', () => {
    expect(shouldShowUnread(0, true, false)).toBe(false);
    expect(shouldShowUnread(0, false, false)).toBe(false);
  });
});
