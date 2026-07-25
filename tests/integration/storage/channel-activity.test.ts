import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const seed = (key: string, ts: number, from: string | undefined, body: string) =>
  messagesStore.insert({ id: `${key}-${ts}-${body}`, key, ts, body, state: 'received', fromPublicKeyHex: from } as Message);

/** Local noon on the day containing `ms`. Pinning to noon keeps day-bucketing
 *  stable regardless of the runner's timezone or a DST transition. */
const noonOf = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
};

describe('messagesStore.activityByKey', () => {
  it('returns a zero-shaped struct for a channel with no messages', () => {
    const a = messagesStore.activityByKey('ch:Nothing', noonOf(1_700_000_000_000));
    expect(a.lastTs).toBe(null);
    expect(a.windows['24h'].buckets).toHaveLength(24);
    expect(a.windows['7d'].buckets).toHaveLength(7);
    expect(a.windows['30d'].buckets).toHaveLength(30);
    expect(a.windows['24h'].total).toBe(0);
    expect(a.windows['30d'].prevTotal).toBe(0);
  });

  it('buckets the trailing 24h hourly, with the current hour last', () => {
    const now = noonOf(1_700_000_000_000);
    seed('ch:Hourly', now - 30 * 60_000, 'name:a', 'this-hour');
    seed('ch:Hourly', now - 1 * HOUR, 'name:a', 'prev-hour-1');
    seed('ch:Hourly', now - 1 * HOUR - 60_000, 'name:a', 'prev-hour-2');

    const w = messagesStore.activityByKey('ch:Hourly', now).windows['24h'];
    expect(w.buckets).toHaveLength(24);
    expect(w.buckets[23]).toBe(1); // current partial hour
    expect(w.buckets[22]).toBe(2); // the hour before it
    expect(w.total).toBe(3);
    expect(w.total).toBe(w.buckets.reduce((x, y) => x + y, 0));
  });

  it('counts prevTotal from the immediately preceding equal period', () => {
    const now = noonOf(1_700_000_000_000);
    seed('ch:Prev', now - 2 * HOUR, 'name:a', 'in-window');
    seed('ch:Prev', now - 30 * HOUR, 'name:a', 'in-prev');
    seed('ch:Prev', now - 40 * HOUR, 'name:a', 'in-prev-2');

    const w = messagesStore.activityByKey('ch:Prev', now).windows['24h'];
    expect(w.total).toBe(1);
    expect(w.prevTotal).toBe(2);
  });

  it('buckets 7d and 30d by local calendar day with today last', () => {
    const now = noonOf(1_700_000_000_000);
    seed('ch:Daily', now, 'name:a', 'today');
    seed('ch:Daily', now - 1 * DAY, 'name:a', 'yesterday-1');
    seed('ch:Daily', now - 1 * DAY, 'name:a', 'yesterday-2');
    seed('ch:Daily', now - 6 * DAY, 'name:a', 'six-days');
    seed('ch:Daily', now - 20 * DAY, 'name:a', 'twenty-days');

    const a = messagesStore.activityByKey('ch:Daily', now);
    expect(a.windows['7d'].buckets[6]).toBe(1); // today
    expect(a.windows['7d'].buckets[5]).toBe(2); // yesterday
    expect(a.windows['7d'].buckets[0]).toBe(1); // six days back
    expect(a.windows['7d'].total).toBe(4);
    expect(a.windows['30d'].buckets[29]).toBe(1); // today
    expect(a.windows['30d'].buckets[9]).toBe(1); // twenty days back
    expect(a.windows['30d'].total).toBe(5);
    expect(a.lastTs).toBe(now);
  });

  it('excludes other channels', () => {
    const now = noonOf(1_700_000_000_000);
    seed('ch:Mine', now - 1 * HOUR, 'name:a', 'mine');
    seed('ch:Yours', now - 1 * HOUR, 'name:b', 'yours');
    expect(messagesStore.activityByKey('ch:Mine', now).windows['24h'].total).toBe(1);
  });
});
