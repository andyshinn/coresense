import { describe, expect, it } from 'vitest';
import { fmtAgoShort } from '../../../../src/renderer/lib/time';

const NOW = 1_700_000_000_000;

describe('fmtAgoShort', () => {
  it('reports sub-minute ages as "just now"', () => {
    expect(fmtAgoShort(NOW, NOW)).toBe('just now');
    expect(fmtAgoShort(NOW - 59_000, NOW)).toBe('just now');
  });

  it('reports minutes, hours and days compactly', () => {
    expect(fmtAgoShort(NOW - 60_000, NOW)).toBe('1m ago');
    expect(fmtAgoShort(NOW - 59 * 60_000, NOW)).toBe('59m ago');
    expect(fmtAgoShort(NOW - 60 * 60_000, NOW)).toBe('1h ago');
    expect(fmtAgoShort(NOW - 23 * 3_600_000, NOW)).toBe('23h ago');
    expect(fmtAgoShort(NOW - 24 * 3_600_000, NOW)).toBe('1d ago');
    expect(fmtAgoShort(NOW - 400 * 3_600_000, NOW)).toBe('16d ago');
  });

  it('clamps future timestamps to "just now" rather than emitting a negative age', () => {
    expect(fmtAgoShort(NOW + 60_000, NOW)).toBe('just now');
  });
});
