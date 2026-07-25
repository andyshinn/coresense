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
    // Days run 1-3 (not 0-3): day 0 would be today, whose afternoon/evening
    // hours land after `now` (pinned to noon) and get dropped by the <= now
    // band filter, silently undercounting this fixture.
    let n = 0;
    for (let day = 1; day <= 3; day++) {
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

  it('counts a message exactly on the 168h band boundary, and excludes one a millisecond older', () => {
    const now = noonOf(1_700_000_000_000);
    const bandSince = now - 168 * HOUR;
    // Seven comfortably inside, plus one exactly on the edge = the 8 samples the
    // sparsity guard needs. Moving that last one 1ms earlier must starve it.
    for (let i = 0; i < 7; i++) seed('ch:EdgeIn', now - (i + 1) * HOUR, 'name:a', `in${i}`);
    seed('ch:EdgeIn', bandSince, 'name:a', 'on-edge');
    expect(messagesStore.activityByKey('ch:EdgeIn', now).peakBand).not.toBe(null);

    for (let i = 0; i < 7; i++) seed('ch:EdgeOut', now - (i + 1) * HOUR, 'name:a', `in${i}`);
    seed('ch:EdgeOut', bandSince - 1, 'name:a', 'just-outside');
    expect(messagesStore.activityByKey('ch:EdgeOut', now).peakBand).toBe(null);
    expect(messagesStore.activityByKey('ch:EdgeOut', now).quietBand).toBe(null);
  });

  it('excludes messages timestamped after now from the band histogram', () => {
    const now = noonOf(1_700_000_000_000);
    // A clock-skewed node can report a message from the future. Eight of them
    // must not be enough to name a band.
    for (let i = 0; i < 8; i++) seed('ch:Future', now + (i + 1) * HOUR, 'name:a', `f${i}`);
    expect(messagesStore.activityByKey('ch:Future', now).peakBand).toBe(null);
  });

  it('breaks a peak tie toward the earlier start hour', () => {
    const now = noonOf(1_700_000_000_000);
    // Hours 3-5 and 15-17 carry identical weight; the earlier block must win.
    for (let day = 1; day <= 2; day++) {
      for (const hour of [3, 4, 5, 15, 16, 17]) {
        for (let k = 0; k < 3; k++) {
          const d = new Date(now);
          d.setDate(d.getDate() - day);
          d.setHours(hour, k * 10, 0, 0);
          seed('ch:Tie', d.getTime(), 'name:a', `t${day}-${hour}-${k}`);
        }
      }
    }
    expect(messagesStore.activityByKey('ch:Tie', now).peakBand).toEqual({ startHour: 3, endHour: 6 });
  });

  it('picks a peak band that wraps past midnight', () => {
    const now = noonOf(1_700_000_000_000);
    // Every hour of this fixture lives on a single calendar day strictly before
    // `now`'s day, so every hour 0-23 of it is unambiguously <= now and inside
    // the trailing 168h band window — no per-hour "which day does this land on
    // relative to `now`" bookkeeping needed, unlike seeding across today.
    const day = new Date(now);
    day.setDate(day.getDate() - 1);

    let n = 0;
    const seedHour = (hour: number, count: number) => {
      for (let k = 0; k < count; k++) {
        const d = new Date(day);
        d.setHours(hour, k * 10, 0, 0);
        seed('ch:Wrap', d.getTime(), 'name:a', `w${n++}`);
      }
    };

    // Peak run is 23:00-01:59 (hours 23, 0, 1) at 5 msgs/hour — the band the
    // circular search must find. Every other hour gets 1 msg/hour baseline so
    // neighboring bands (22-23-0 -> 11, 0-1-2 -> 11) are real competitors that
    // still lose, rather than the wrap winning only because its neighbors are
    // empty. Circular band sums (width 3): start=23 -> 5+5+5=15 (max, unique);
    // start=22 -> 1+5+5=11; start=0 -> 5+5+1=11; every other start -> 3.
    seedHour(23, 5);
    seedHour(0, 5);
    seedHour(1, 5);
    for (let hour = 2; hour <= 22; hour++) seedHour(hour, 1);

    const a = messagesStore.activityByKey('ch:Wrap', now);
    expect(a.peakBand).toEqual({ startHour: 23, endHour: 2 });
  });
});
