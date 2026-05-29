import { describe, expect, it } from 'vitest';
import { formatVoltage, lipoPercent } from '../../../../src/renderer/lib/battery';

describe('lipoPercent', () => {
  it('returns null for a missing/zero reading', () => {
    expect(lipoPercent(0)).toBeNull();
    expect(lipoPercent(-5)).toBeNull();
  });

  it('clamps to the curve endpoints', () => {
    expect(lipoPercent(3000)).toBe(0); // ≤ 3.2 V
    expect(lipoPercent(4300)).toBe(100); // ≥ 4.2 V
  });

  it('interpolates between anchor points', () => {
    // 3.6 V sits halfway between (3.5,10) and (3.7,30) → ~20%.
    expect(lipoPercent(3600)).toBe(20);
  });
});

describe('formatVoltage', () => {
  it('formats millivolts as 2-decimal volts', () => {
    expect(formatVoltage(4020)).toBe('4.02 V');
  });
});
