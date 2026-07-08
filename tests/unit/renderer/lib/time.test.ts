import { describe, expect, it } from 'vitest';
import { dayKey, fmtDate, fmtMessageTime, fmtRelative, fmtTime } from '../../../../src/renderer/lib/time';

// Only locale-independent branches are asserted here, so the test is stable
// regardless of the CI runner's locale/timezone.
describe('fmtRelative', () => {
  it('returns "just now" within the 45s window', () => {
    const now = 1_700_000_000_000;
    expect(fmtRelative(now, now)).toBe('just now');
    expect(fmtRelative(now - 30_000, now)).toBe('just now');
  });

  it('returns a non-empty relative string beyond the window', () => {
    const now = 1_700_000_000_000;
    const out = fmtRelative(now - 2 * 60_000, now); // 2 minutes ago
    expect(typeof out).toBe('string');
    expect(out).not.toBe('just now');
  });
});

// Dates are built with the local-time Date constructor and dayKey reads local
// components, so these assertions are stable regardless of the runner's TZ.
describe('dayKey', () => {
  it('is equal for two times on the same local day', () => {
    const morning = new Date(2026, 6, 2, 8, 0, 0).getTime();
    const evening = new Date(2026, 6, 2, 23, 59, 0).getTime();
    expect(dayKey(morning)).toBe(dayKey(evening));
  });

  it('differs across a local-day boundary', () => {
    const beforeMidnight = new Date(2026, 6, 2, 23, 59, 0).getTime();
    const afterMidnight = new Date(2026, 6, 3, 0, 1, 0).getTime();
    expect(dayKey(beforeMidnight)).not.toBe(dayKey(afterMidnight));
  });

  it('encodes the calendar date as YYYYMMDD', () => {
    expect(dayKey(new Date(2026, 6, 2, 12, 0, 0).getTime())).toBe(20260702);
  });
});

// dateStyle 'long' carries no time, so same-local-day timestamps format
// identically and different local days format differently — assertions that
// hold regardless of the runner's locale or calendar system (unlike a literal
// year check, which breaks under non-Gregorian calendars or non-Latin digits).
describe('fmtDate', () => {
  it('formats a timestamp as a non-empty string', () => {
    const out = fmtDate(new Date(2026, 6, 2, 12, 0, 0).getTime());
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('is identical for two times on the same local day', () => {
    const noon = fmtDate(new Date(2026, 6, 2, 12, 0, 0).getTime());
    const evening = fmtDate(new Date(2026, 6, 2, 23, 30, 0).getTime());
    expect(noon).toBe(evening);
  });

  it('differs for two different local days', () => {
    const jul2 = fmtDate(new Date(2026, 6, 2, 12, 0, 0).getTime());
    const jul4 = fmtDate(new Date(2026, 6, 4, 12, 0, 0).getTime());
    expect(jul2).not.toBe(jul4);
  });
});

// now = 2026-07-08 12:00 local. Inputs use the local-time Date constructor so
// the today/yesterday/older buckets are stable regardless of the runner's TZ.
describe('fmtMessageTime', () => {
  const now = new Date(2026, 6, 8, 12, 0, 0).getTime();

  it('shows time only for a message earlier today (equals fmtTime)', () => {
    const ts = new Date(2026, 6, 8, 9, 30, 0).getTime();
    expect(fmtMessageTime(ts, 'auto', now)).toBe(fmtTime(ts, 'auto'));
  });

  it('prefixes "Yesterday at " for a message from the previous day', () => {
    const ts = new Date(2026, 6, 7, 13, 15, 0).getTime();
    const out = fmtMessageTime(ts, 'auto', now);
    expect(out.startsWith('Yesterday at ')).toBe(true);
    expect(out.endsWith(fmtTime(ts, 'auto'))).toBe(true);
  });

  it('shows a short date + time for a message older than yesterday', () => {
    const ts = new Date(2026, 6, 2, 13, 15, 0).getTime();
    const out = fmtMessageTime(ts, 'auto', now);
    expect(out.startsWith('Yesterday')).toBe(false);
    expect(out.includes(fmtTime(ts, 'auto'))).toBe(true);
    expect(out).not.toBe(fmtTime(ts, 'auto')); // carries a date prefix
  });

  it('treats local midnight today as "today" and one ms earlier as "Yesterday"', () => {
    const midnight = new Date(2026, 6, 8, 0, 0, 0).getTime();
    expect(fmtMessageTime(midnight, 'auto', now)).toBe(fmtTime(midnight, 'auto'));
    expect(fmtMessageTime(midnight - 1, 'auto', now).startsWith('Yesterday at ')).toBe(true);
  });

  it('honors the 24-hour preference in each tier', () => {
    const today = new Date(2026, 6, 8, 13, 15, 0).getTime();
    const yesterday = new Date(2026, 6, 7, 13, 15, 0).getTime();
    const older = new Date(2026, 6, 2, 13, 15, 0).getTime();
    expect(fmtMessageTime(today, '24h', now)).toContain('13:15');
    expect(fmtMessageTime(yesterday, '24h', now)).toContain('13:15');
    expect(fmtMessageTime(older, '24h', now)).toContain('13:15');
  });

  it('resolves "Yesterday" across a month boundary', () => {
    const firstOfJuly = new Date(2026, 6, 1, 12, 0, 0).getTime();
    const lastOfJune = new Date(2026, 5, 30, 13, 15, 0).getTime();
    expect(fmtMessageTime(lastOfJune, 'auto', firstOfJuly).startsWith('Yesterday at ')).toBe(true);
  });

  it('shows a date (not bare time) for a future-dated message from clock skew', () => {
    // message.ts is the sending node's clock; a wrong RTC can report the future.
    // It must not masquerade as an unqualified "today" time.
    const tomorrow = new Date(2026, 6, 9, 15, 0, 0).getTime();
    const out = fmtMessageTime(tomorrow, 'auto', now);
    expect(out.startsWith('Yesterday')).toBe(false);
    expect(out.includes(fmtTime(tomorrow, 'auto'))).toBe(true);
    expect(out).not.toBe(fmtTime(tomorrow, 'auto')); // carries a date
  });
});
