import { describe, expect, it } from 'vitest';
import { loraAirtimeMs } from '@/lib/airtime';
import { cliRoundTrip } from '@/panels/repeater-admin/cli/lib/airtime';
import type { RadioSettings } from '../../../../../../src/shared/types';

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

describe('cliRoundTrip', () => {
  it('renders — and ms 0 when radioSettings is absent', () => {
    expect(cliRoundTrip('ver', null, 1, false)).toEqual({ ms: 0, label: '—' });
    expect(cliRoundTrip('ver', undefined, 1, false)).toEqual({ ms: 0, label: '—' });
  });

  it('adds the +32 wrapper overhead to each leg', () => {
    const s = settings();
    // Empty command, one hop, no reply → outbound leg only = loraAirtimeMs(0+32).
    expect(cliRoundTrip('', s, 1, true).ms).toBeCloseTo(loraAirtimeMs(32, s), 6);
    // With a reply → + loraAirtimeMs(160+32).
    expect(cliRoundTrip('', s, 1, false).ms).toBeCloseTo(loraAirtimeMs(32, s) + loraAirtimeMs(192, s), 6);
  });

  it('counts only the outbound leg when noReply is true', () => {
    const s = settings();
    expect(cliRoundTrip('reboot', s, 2, true).ms).toBeLessThan(cliRoundTrip('reboot', s, 2, false).ms);
  });

  it('multiplies every leg by hop count', () => {
    const s = settings();
    expect(cliRoundTrip('ver', s, 2, false).ms).toBeCloseTo(cliRoundTrip('ver', s, 1, false).ms * 2, 6);
  });

  it('floors hops at 1 so an unfloored 0 is not ~0.0 s', () => {
    const s = settings();
    expect(cliRoundTrip('ver', s, 0, false).ms).toBe(cliRoundTrip('ver', s, 1, false).ms);
  });

  it('labels with one decimal below 10 s and rounds at or above 10 s', () => {
    const small = cliRoundTrip('ver', settings({ spreadingFactor: 7, bandwidthHz: 250_000 }), 1, true);
    expect(small.label).toMatch(/^~\d+\.\d s$/);
    const big = cliRoundTrip('neighbors', settings({ spreadingFactor: 12, bandwidthHz: 7_800 }), 6, false);
    expect(big.label).toMatch(/^~\d+ s$/); // no decimal
  });
});
