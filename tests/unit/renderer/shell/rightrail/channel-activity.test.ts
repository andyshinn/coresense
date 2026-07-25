import { describe, expect, it } from 'vitest';
import {
  axisTicks,
  bucketLabel,
  chartAriaLabel,
  fmtBand,
  trendPct,
} from '../../../../../src/renderer/shell/rightrail/sections/channel-activity/activity';

/** 2023-11-14 00:00 local. Fixed local midnight keeps hour/day labels stable. */
const midnight = (() => {
  const d = new Date(1_700_000_000_000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

describe('trendPct', () => {
  it('rounds the percentage change against the previous period', () => {
    expect(trendPct(123, 104)).toBe(18);
    expect(trendPct(412, 498)).toBe(-17);
  });

  it('returns null when there is no previous period to compare against', () => {
    expect(trendPct(50, 0)).toBe(null);
  });

  it('reports a total collapse as -100 rather than dividing by zero', () => {
    expect(trendPct(0, 40)).toBe(-100);
  });
});

describe('axisTicks', () => {
  it('labels 24h at the quarter hours and always ends with "now"', () => {
    const ticks = axisTicks('24h', midnight, 24);
    expect(ticks).toHaveLength(24);
    expect(ticks[0]).toBe('12a');
    expect(ticks[6]).toBe('6a');
    expect(ticks[12]).toBe('12p');
    expect(ticks[18]).toBe('6p');
    expect(ticks[23]).toBe('now');
    expect(ticks[1]).toBe('');
  });

  it('derives 7d weekday initials from the real dates, not a fixed M-T-W string', () => {
    const ticks = axisTicks('7d', midnight, 7);
    expect(ticks).toHaveLength(7);
    const expected = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(midnight);
      d.setDate(d.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: 'short' }).charAt(0);
    });
    expect(ticks).toEqual(expected);
  });

  it('labels 30d at four sparse positions', () => {
    const ticks = axisTicks('30d', midnight, 30);
    expect(ticks).toHaveLength(30);
    expect(ticks[0]).toBe('30d');
    expect(ticks[10]).toBe('20d');
    expect(ticks[20]).toBe('10d');
    expect(ticks[29]).toBe('now');
    expect(ticks[5]).toBe('');
  });
});

describe('bucketLabel', () => {
  it('names hours, weekdays and day offsets', () => {
    expect(bucketLabel('24h', midnight, 18, 24)).toBe('6 PM');
    expect(bucketLabel('24h', midnight, 0, 24)).toBe('12 AM');
    expect(bucketLabel('30d', midnight, 29, 30)).toBe('today');
    expect(bucketLabel('30d', midnight, 21, 30)).toBe('8d ago');
    const d = new Date(midnight);
    expect(bucketLabel('7d', midnight, 0, 7)).toBe(d.toLocaleDateString(undefined, { weekday: 'short' }));
  });
});

describe('fmtBand', () => {
  it('shares the meridiem when both ends agree', () => {
    expect(fmtBand({ startHour: 19, endHour: 22 })).toBe('7–10 PM');
    expect(fmtBand({ startHour: 2, endHour: 6 })).toBe('2–6 AM');
  });

  it('spells out both when the band crosses noon or midnight', () => {
    expect(fmtBand({ startHour: 23, endHour: 2 })).toBe('11 PM–2 AM');
    expect(fmtBand({ startHour: 10, endHour: 13 })).toBe('10 AM–1 PM');
  });
});

describe('chartAriaLabel', () => {
  it('summarises the window for screen readers', () => {
    const buckets = new Array(24).fill(0);
    buckets[18] = 14;
    const label = chartAriaLabel('24h', { buckets, total: 14, prevTotal: 0, startMs: midnight });
    expect(label).toContain('last 24 hours');
    expect(label).toContain('14 messages');
    expect(label).toContain('6 PM');
  });

  it('says so when the window is empty', () => {
    const buckets = new Array(7).fill(0);
    const label = chartAriaLabel('7d', { buckets, total: 0, prevTotal: 0, startMs: midnight });
    expect(label).toContain('No messages');
  });
});
