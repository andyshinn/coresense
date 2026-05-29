import { describe, expect, it } from 'vitest';
import { fmtRelative } from '../../../../src/renderer/lib/time';

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
