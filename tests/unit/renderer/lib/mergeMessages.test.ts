import { describe, expect, it } from 'vitest';
import { mergeMessages } from '../../../../src/renderer/lib/mergeMessages';
import type { Message } from '../../../../src/shared/types';

const m = (id: string, ts: number, over: Partial<Message> = {}): Message => ({
  id,
  key: 'ch:x',
  body: id,
  ts,
  state: 'received',
  ...over,
});

const ids = (list: Message[]) => list.map((x) => x.id);

describe('mergeMessages', () => {
  it('returns the incoming window when nothing is held yet', () => {
    const incoming = [m('a', 1), m('b', 2)];
    expect(mergeMessages([], incoming)).toBe(incoming);
  });

  it('returns what is held when the window is empty', () => {
    const prev = [m('a', 1)];
    expect(mergeMessages(prev, [])).toBe(prev);
  });

  // The regression this exists for: once a conversation passes the server's
  // 200-row window, every broadcast slides it by one. Before merging, that
  // produced a same-length array with every index shifted, which forced the
  // message list into a wholesale replace and dropped the bottom pin.
  it('keeps rolled-off history instead of sliding the window', () => {
    const prev = [m('m1', 1), m('m2', 2), m('m3', 3)];
    const incoming = [m('m2', 2), m('m3', 3), m('m4', 4)];
    expect(ids(mergeMessages(prev, incoming))).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('turns a slid window into pure tail growth', () => {
    const prev = [m('m1', 1), m('m2', 2)];
    const merged = mergeMessages(prev, [m('m2', 2), m('m3', 3)]);
    // Same prefix length, one new item at the end — exactly what the list's
    // append fast-path looks for.
    expect(merged.length).toBe(prev.length + 1);
    expect(merged[prev.length - 1].id).toBe(prev[prev.length - 1].id);
  });

  it('lets the incoming copy win so state changes are not dropped', () => {
    const prev = [m('a', 1, { state: 'sending' }), m('b', 2)];
    const merged = mergeMessages(prev, [m('a', 1, { state: 'ack' }), m('b', 2)]);
    expect(merged[0].state).toBe('ack');
    expect(ids(merged)).toEqual(['a', 'b']);
  });

  it('never duplicates an id', () => {
    const prev = [m('a', 5), m('b', 5), m('c', 9)];
    const merged = mergeMessages(prev, [m('b', 5), m('c', 9), m('d', 10)]);
    expect(ids(merged)).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(ids(merged)).size).toBe(merged.length);
  });

  // A backfill window (older rows fetched on demand) has to land in front of
  // what is already held, not be appended after it.
  it('splices an older backfill window in front', () => {
    const prev = [m('m8', 8), m('m9', 9)];
    const merged = mergeMessages(prev, [m('m5', 5), m('m6', 6), m('m7', 7)]);
    expect(ids(merged)).toEqual(['m5', 'm6', 'm7', 'm8', 'm9']);
  });

  it('interleaves a window that straddles what is held', () => {
    const prev = [m('m1', 1), m('m5', 5)];
    expect(ids(mergeMessages(prev, [m('m3', 3), m('m7', 7)]))).toEqual(['m1', 'm3', 'm5', 'm7']);
  });

  it('keeps the result sorted by timestamp', () => {
    const merged = mergeMessages([m('a', 10), m('b', 30)], [m('c', 20), m('d', 40)]);
    expect(merged.map((x) => x.ts)).toEqual([10, 20, 30, 40]);
  });

  // Every real caller supplies ascending input, but a malformed window must
  // cost time rather than corrupt the order the list renders in.
  it('still sorts correctly when a window arrives out of order', () => {
    const merged = mergeMessages([m('a', 10), m('b', 30)], [m('c', 20), m('d', 40), m('e', 5)]);
    expect(merged.map((x) => x.ts)).toEqual([5, 10, 20, 30, 40]);
    expect(ids(merged)).toEqual(['e', 'a', 'c', 'b', 'd']);
  });

  it('still de-duplicates when a window arrives out of order', () => {
    const merged = mergeMessages([m('a', 10, { state: 'sending' })], [m('b', 20), m('a', 10, { state: 'ack' })]);
    expect(ids(merged)).toEqual(['a', 'b']);
    expect(merged[0].state).toBe('ack');
  });

  it('does not reorder equal timestamps already held', () => {
    const prev = [m('a', 5), m('b', 5)];
    expect(ids(mergeMessages(prev, [m('c', 5)]))).toEqual(['a', 'b', 'c']);
  });

  it('is idempotent when the same window arrives twice', () => {
    const prev = [m('a', 1), m('b', 2)];
    const window = [m('a', 1), m('b', 2)];
    expect(ids(mergeMessages(mergeMessages(prev, window), window))).toEqual(['a', 'b']);
  });

  // Every broadcast arrives as fresh objects off the wire. Handing those back
  // for rows that did not change reads downstream as "the whole window changed"
  // — the list re-maps and re-renders all 200 mounted rows on every arrival.
  describe('reference identity', () => {
    it('keeps the held object when the window says nothing new', () => {
      const prev = [m('a', 1), m('b', 2)];
      const merged = mergeMessages(prev, [m('a', 1), m('b', 2), m('c', 3)]);
      expect(merged[0]).toBe(prev[0]);
      expect(merged[1]).toBe(prev[1]);
      expect(merged[2].id).toBe('c');
    });

    it('takes the incoming object when the state changed', () => {
      const prev = [m('a', 1, { state: 'sending' })];
      const incoming = [m('a', 1, { state: 'ack' })];
      expect(mergeMessages(prev, incoming)[0]).toBe(incoming[0]);
    });

    it('takes the incoming object when a path was merged in', () => {
      const prev = [m('a', 1, { meta: { timesHeard: 1 } })];
      const incoming = [m('a', 1, { meta: { timesHeard: 2 } })];
      expect(mergeMessages(prev, incoming)[0]).toBe(incoming[0]);
    });

    it('takes the incoming object when it became blocked', () => {
      const prev = [m('a', 1)];
      const incoming = [m('a', 1, { meta: { blocked: true } })];
      expect(mergeMessages(prev, incoming)[0]).toBe(incoming[0]);
    });

    // Lets the store skip the state update entirely on a duplicate broadcast.
    it('returns the very same array when nothing changed at all', () => {
      const prev = [m('a', 1), m('b', 2)];
      expect(mergeMessages(prev, [m('a', 1), m('b', 2)])).toBe(prev);
    });
  });
});
