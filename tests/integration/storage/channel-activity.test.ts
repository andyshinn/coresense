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

/** Local 12:30 on the day containing `ms`. Deliberately mid-hour: the 24h window
 *  ends with the current clock hour, so a `now` sitting exactly on an hour
 *  boundary would leave that bucket zero-width and impossible to assert on. */
const halfPastNoon = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(12, 30, 0, 0);
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

  it('buckets the trailing 24h on the clock-hour grid, current hour last', () => {
    const now = halfPastNoon(1_700_000_000_000);
    seed('ch:Hourly', now - 30 * 60_000, 'name:a', 'this-hour'); // 12:00
    seed('ch:Hourly', now - 1 * HOUR, 'name:a', 'prev-hour-1'); // 11:30
    seed('ch:Hourly', now - 1 * HOUR - 60_000, 'name:a', 'prev-hour-2'); // 11:29

    const w = messagesStore.activityByKey('ch:Hourly', now).windows['24h'];
    expect(w.buckets).toHaveLength(24);
    expect(w.buckets[23]).toBe(1); // 12:00-13:00, the current partial hour
    expect(w.buckets[22]).toBe(2); // 11:00-12:00
    expect(w.total).toBe(3);
    expect(w.total).toBe(w.buckets.reduce((x, y) => x + y, 0));
  });

  it('starts the 24h window on an exact clock hour so ticks can be labelled', () => {
    const now = halfPastNoon(1_700_000_000_000);
    const w = messagesStore.activityByKey('ch:GridAlign', now).windows['24h'];
    const start = new Date(w.startMs);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(w.startMs).toBe(new Date(now).setMinutes(0, 0, 0) - 23 * 3_600_000);
  });

  it('assigns a message exactly on the window start edge to bucket 0, not prevTotal', () => {
    const now = halfPastNoon(1_700_000_000_000);
    const { startMs } = messagesStore.activityByKey('ch:Edge', now).windows['24h'];
    seed('ch:Edge', startMs, 'name:a', 'on-edge');
    seed('ch:Edge', startMs - 1, 'name:a', 'one-ms-before');

    const w = messagesStore.activityByKey('ch:Edge', now).windows['24h'];
    expect(w.buckets[0]).toBe(1);
    expect(w.total).toBe(1);
    expect(w.prevTotal).toBe(1);
  });

  it('counts prevTotal from the immediately preceding equal period', () => {
    const now = halfPastNoon(1_700_000_000_000);
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

  it('nulls both bands when the trailing 168h is too sparse to name one', () => {
    const now = noonOf(1_700_000_000_000);
    for (let i = 0; i < 7; i++) seed('ch:Sparse', now - i * HOUR, 'name:a', `s${i}`);
    const a = messagesStore.activityByKey('ch:Sparse', now);
    expect(a.peakBand).toBe(null);
    expect(a.quietBand).toBe(null);
  });

  it('picks the busiest 3h peak band and calmest 4h quiet band', () => {
    const now = noonOf(1_700_000_000_000);
    // 20:00-22:59 gets 4 messages/hour on each of the last 3 days; the rest of
    // the clock gets a thin baseline so the total clears the sparsity guard.
    let n = 0;
    for (let day = 0; day < 3; day++) {
      for (const hour of [20, 21, 22]) {
        for (let k = 0; k < 4; k++) {
          const d = new Date(now);
          d.setDate(d.getDate() - day);
          d.setHours(hour, k * 10, 0, 0);
          seed('ch:Bands', d.getTime(), 'name:a', `peak${n++}`);
        }
      }
      for (const hour of [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 23]) {
        const d = new Date(now);
        d.setDate(d.getDate() - day);
        d.setHours(hour, 5, 0, 0);
        seed('ch:Bands', d.getTime(), 'name:a', `base${n++}`);
      }
    }

    const a = messagesStore.activityByKey('ch:Bands', now);
    expect(a.peakBand).toEqual({ startHour: 20, endHour: 23 });
    // Hours 0-8 are completely empty; the calmest 4h run starts at the
    // earliest such hour because ties break toward the earlier start.
    expect(a.quietBand).toEqual({ startHour: 0, endHour: 4 });
  });
});
