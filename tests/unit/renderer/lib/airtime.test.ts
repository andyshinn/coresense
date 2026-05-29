import { describe, expect, it } from 'vitest';
import { loraAirtimeMs } from '../../../../src/renderer/lib/airtime';
import type { RadioSettings } from '../../../../src/shared/types';

const settings = (over: Partial<RadioSettings> = {}): RadioSettings => ({
  frequencyHz: 915_000_000,
  bandwidthHz: 250_000,
  spreadingFactor: 11,
  codingRate: 5,
  txPowerDbm: 20,
  repeatMode: false,
  pathHashMode: 1,
  ...over,
});

describe('loraAirtimeMs', () => {
  it('matches the AN1200.13 formula for a known config', () => {
    // SF11, BW250k, CR4/5, 16B payload → ~288.77 ms (hand-derived from the formula).
    expect(loraAirtimeMs(16, settings())).toBeCloseTo(288.77, 1);
  });

  it('increases monotonically with payload size', () => {
    const s = settings();
    expect(loraAirtimeMs(32, s)).toBeGreaterThan(loraAirtimeMs(16, s));
  });

  it('returns 0 for out-of-range spreading factors', () => {
    expect(loraAirtimeMs(16, settings({ spreadingFactor: 5 }))).toBe(0);
    expect(loraAirtimeMs(16, settings({ spreadingFactor: 13 }))).toBe(0);
  });

  it('returns 0 for a negative payload', () => {
    expect(loraAirtimeMs(-1, settings())).toBe(0);
  });
});
