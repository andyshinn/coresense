import { describe, expect, it } from 'vitest';
import { snrBand, snrColor } from '../../../../../src/renderer/components/path/SignalBars';

describe('snrBand', () => {
  it('classifies strong/mid/weak by threshold', () => {
    expect(snrBand(5)).toBe('strong');
    expect(snrBand(4.9)).toBe('mid');
    expect(snrBand(0)).toBe('mid');
    expect(snrBand(-0.1)).toBe('weak');
  });
});

describe('snrColor', () => {
  it('maps each band to its fixed hex token', () => {
    expect(snrColor(12)).toBe('#84cc16'); // --cs-online
    expect(snrColor(2.5)).toBe('#f59e0b'); // --cs-warn
    expect(snrColor(-3)).toBe('#dc2626'); // --cs-danger
    // threshold boundaries — pin the delegation to snrBand
    expect(snrColor(5)).toBe('#84cc16');
    expect(snrColor(0)).toBe('#f59e0b');
  });
});
