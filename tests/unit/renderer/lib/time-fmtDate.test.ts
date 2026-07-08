import { describe, expect, it } from 'vitest';
import { fmtDate } from '../../../../src/renderer/lib/time';

describe('fmtDate', () => {
  it('formats a timestamp as a medium calendar date including the year', () => {
    const out = fmtDate(1_700_000_000_000); // 2023
    expect(out).toContain('2023');
    expect(out.length).toBeGreaterThan(0);
  });
});
