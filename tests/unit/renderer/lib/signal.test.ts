import { describe, expect, it } from 'vitest';
import { bleRssiBars, loraRssiClass, snrBand, snrColor } from '../../../../src/renderer/lib/signal';

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

// The two RSSI scales stay separate on purpose: they grade the same dBm reading
// differently (BLE proximity vs over-the-air). -100 dBm is 0 bars, an unusable
// BLE link, but still a graded (warn) LoRa reception.
describe('bleRssiBars', () => {
  it('grades BLE proximity RSSI into 0-4 bars', () => {
    expect(bleRssiBars(-55)).toBe(4);
    expect(bleRssiBars(-70)).toBe(3);
    expect(bleRssiBars(-80)).toBe(2);
    expect(bleRssiBars(-95)).toBe(1);
    expect(bleRssiBars(-96)).toBe(0);
  });
});

describe('loraRssiClass', () => {
  it('grades LoRa reception RSSI on its own thresholds', () => {
    expect(loraRssiClass(undefined)).toBe('text-cs-text-dim');
    expect(loraRssiClass(-79)).toBe('text-cs-online');
    expect(loraRssiClass(-80)).toBe('text-cs-text-muted');
    expect(loraRssiClass(-96)).toBe('text-cs-warn');
  });
});
