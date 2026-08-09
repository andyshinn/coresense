import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

const T0 = 1_700_000_000_000;
const KEY = 'ch:Busy';

/** 500 messages, one per second — comfortably past the 200-row default window
 *  so the trailing-window behaviour is the thing under test, not an artefact. */
function seed(count = 500): void {
  for (let i = 0; i < count; i++) {
    messagesStore.insert({ id: `m${i}`, key: KEY, ts: T0 + i * 1000, body: `body ${i}`, state: 'received' } as Message);
  }
}

const ids = (rows: Message[]) => rows.map((r) => r.id);

describe('messagesStore.byKey({ around })', () => {
  it('returns the trailing window by default, which excludes old history', () => {
    seed();
    const rows = messagesStore.byKey(KEY);
    expect(rows).toHaveLength(200);
    expect(rows[0].id).toBe('m300');
    expect(rows.at(-1)?.id).toBe('m499');
    // The exact gap that made a search hit unreachable.
    expect(ids(rows)).not.toContain('m5');
  });

  it('centres the window on the requested message', () => {
    seed();
    const rows = messagesStore.byKey(KEY, { around: 'm250' });
    expect(ids(rows)).toContain('m250');
    expect(rows).toHaveLength(200);
    // Half each side, anchor included by the lower leg.
    expect(rows[0].id).toBe('m151');
    expect(rows.at(-1)?.id).toBe('m350');
  });

  it('reaches a message far older than the default window', () => {
    seed();
    const rows = messagesStore.byKey(KEY, { around: 'm5' });
    expect(ids(rows)).toContain('m5');
    expect(rows[0].id).toBe('m0');
  });

  it('stays ascending by timestamp', () => {
    seed();
    const ts = messagesStore.byKey(KEY, { around: 'm250' }).map((r) => r.ts);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('honours a smaller limit', () => {
    seed();
    const rows = messagesStore.byKey(KEY, { around: 'm250', limit: 10 });
    expect(rows).toHaveLength(10);
    expect(ids(rows)).toContain('m250');
  });

  it('clamps at the head when the anchor is the first message', () => {
    seed(20);
    const rows = messagesStore.byKey(KEY, { around: 'm0', limit: 10 });
    expect(rows[0].id).toBe('m0');
    expect(ids(rows)).toContain('m0');
  });

  it('clamps at the tail when the anchor is the last message', () => {
    seed(20);
    const rows = messagesStore.byKey(KEY, { around: 'm19', limit: 10 });
    expect(rows.at(-1)?.id).toBe('m19');
  });

  // A stale hit should still show the conversation rather than blanking it.
  it('falls back to the trailing window for an unknown id', () => {
    seed(20);
    expect(ids(messagesStore.byKey(KEY, { around: 'nope' }))).toEqual(ids(messagesStore.byKey(KEY)));
  });

  it('does not leak messages from another conversation', () => {
    seed(20);
    messagesStore.insert({ id: 'other', key: 'ch:Other', ts: T0 + 5000, body: 'x', state: 'received' } as Message);
    const rows = messagesStore.byKey(KEY, { around: 'm5' });
    expect(ids(rows)).not.toContain('other');
    expect(rows.every((r) => r.key === KEY)).toBe(true);
  });

  it('ignores an anchor that belongs to a different conversation', () => {
    seed(20);
    messagesStore.insert({ id: 'other', key: 'ch:Other', ts: T0 + 5000, body: 'x', state: 'received' } as Message);
    expect(ids(messagesStore.byKey(KEY, { around: 'other' }))).toEqual(ids(messagesStore.byKey(KEY)));
  });

  // A burst of messages sharing one timestamp used to be able to push the
  // anchor out of the lower leg while the strict `ts >` upper leg excluded it
  // too, returning a window without the row that was asked for.
  it('always includes the anchor when many messages share its timestamp', () => {
    for (let i = 0; i < 12; i++) {
      messagesStore.insert({ id: `t${i}`, key: KEY, ts: T0, body: `tie ${i}`, state: 'received' } as Message);
    }
    for (const id of ['t0', 't5', 't11']) {
      for (const limit of [2, 3, 4, 10]) {
        expect(ids(messagesStore.byKey(KEY, { around: id, limit })), `${id} @ limit ${limit}`).toContain(id);
      }
    }
  });

  // SQLite treats a negative LIMIT as unlimited, so ?limit=0 (or an empty or
  // negative one) would have dumped the whole conversation.
  it('falls back to the default window rather than returning everything for a bad limit', () => {
    seed(500);
    for (const limit of [0, -1, Number.NaN]) {
      expect(messagesStore.byKey(KEY, { around: 'm250', limit }).length, `limit ${limit}`).toBe(200);
      expect(messagesStore.byKey(KEY, { limit }).length, `limit ${limit}`).toBe(200);
    }
  });

  it('returns a single row for limit 1', () => {
    seed(20);
    const rows = messagesStore.byKey(KEY, { around: 'm5', limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('m5');
  });
});
