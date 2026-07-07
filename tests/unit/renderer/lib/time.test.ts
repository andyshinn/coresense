import { describe, expect, it } from 'vitest';
import { dayKey, fmtDate, fmtRelative } from '../../../../src/renderer/lib/time';

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

describe('fmtDate', () => {
  it('formats a timestamp as a non-empty date string containing the year', () => {
    const out = fmtDate(new Date(2026, 6, 2, 12, 0, 0).getTime());
    expect(typeof out).toBe('string');
    expect(out).toContain('2026');
  });
});
