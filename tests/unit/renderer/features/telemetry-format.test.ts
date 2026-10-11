import { describe, expect, it } from 'vitest';
import {
  ageOld,
  channelPermission,
  compareDetail,
  dayLabel,
  fmtClock,
  previousByOffset,
  previousText,
  type RequestSummary,
  requestChip,
  requestDetail,
  requestMetaLine,
  routeLabel,
} from '../../../../src/renderer/features/telemetry/format';
import { describeChannels } from '../../../../src/shared/telemetry/describe';
import { GROUP_SEP } from '../../../../src/shared/telemetry/format';
import { PLAN_FIXTURE, readings, T1000E_REMOTE } from '../../shared/telemetry/fixtures';

const NOW = new Date(2026, 9, 9, 21, 30, 0).getTime();

function summary(over: Partial<RequestSummary> = {}): RequestSummary {
  return {
    id: 'r',
    requestedAt: NOW - 12_000,
    outcome: 'ok',
    roundTripMs: 1800,
    hops: 0,
    route: 'direct',
    aclRole: 'admin',
    readings: readings(PLAN_FIXTURE),
    rawHex: '00'.repeat(42),
    ...over,
  };
}

describe('telemetry list format', () => {
  it('buckets days as Today / Yesterday / short date (year only when it differs)', () => {
    expect(dayLabel(NOW - 60_000, NOW)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 8, 23, 59).getTime(), NOW)).toBe('Yesterday');
    const oct5 = new Date(2026, 9, 5, 12).getTime();
    expect(dayLabel(oct5, NOW)).toBe(new Date(oct5).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    expect(dayLabel(new Date(2025, 11, 31, 12).getTime(), NOW)).toMatch(/2025/);
  });

  it('formats clock times with seconds and the 24h preference', () => {
    expect(fmtClock(new Date(2026, 9, 9, 21, 29, 48).getTime(), '24h')).toBe('21:29:48');
  });

  it('chips: neutral reading count, warn for a guest, bad for a failure', () => {
    expect(requestChip(summary())).toEqual({ tone: 'off', text: '9 readings' });
    expect(requestChip(summary({ aclRole: 'guest', readings: readings('01 74 01 A9') }))).toEqual({
      tone: 'warn',
      text: '1 reading',
    });
    expect(requestChip(summary({ outcome: 'timeout' }))).toEqual({ tone: 'bad', text: 'timeout' });
  });

  it('detail lines: round trip · route · role, or reason · route', () => {
    expect(requestDetail(summary())).toBe('1.8 s · 0 hops · admin');
    expect(requestDetail(summary({ aclRole: 'readOnly', hops: 2 }))).toBe('1.8 s · 2 hops · read-only');
    expect(requestDetail(summary({ aclRole: null, route: 'local', hops: null, roundTripMs: 160 }))).toBe(
      '0.2 s · local read',
    );
    expect(requestDetail(summary({ outcome: 'timeout', roundTripMs: 15_000, route: 'flood', hops: null }))).toBe(
      'no reply in 15 s · flood',
    );
    // A timeout saved before main recorded the wait.
    expect(requestDetail(summary({ outcome: 'timeout', roundTripMs: null, route: 'flood', hops: null }))).toBe(
      'no reply · flood',
    );
    expect(requestDetail(summary({ outcome: 'error', error: 'disconnected', roundTripMs: null }))).toBe(
      'disconnected · 0 hops',
    );
    expect(compareDetail(summary(), NOW)).toBe('12 s ago · admin');
    expect(routeLabel({ route: null, hops: null })).toBeNull();
  });

  it('header meta: age · round trip · route · bytes · readings', () => {
    expect(requestMetaLine(summary(), NOW)).toBe('12 s ago · 1.8 s round trip · 0 hops · 42 bytes · 9 readings');
    expect(requestMetaLine(summary({ outcome: 'timeout', route: 'flood', hops: null }), NOW)).toBe('12 s ago · flood');
  });

  it('ages the older-request chip', () => {
    expect(ageOld(NOW - 3 * 3_600_000, NOW)).toBe('3 h old');
  });

  it('labels channel permissions', () => {
    const [self, env] = describeChannels(readings(PLAN_FIXTURE));
    expect(channelPermission(self)).toBe('Base · Location');
    expect(channelPermission(env)).toBe('Environment');
    expect(channelPermission(describeChannels(readings('01 74 01 A9'))[0])).toBe('Base');
    // MCU temperature is Base too.
    expect(channelPermission(describeChannels(readings('01 74 01 A9 01 67 01 36'))[0])).toBe('Base');
    // A T1000-E's ch 1 also carries luminosity and its sensor temperature.
    expect(channelPermission(describeChannels(readings(T1000E_REMOTE))[0])).toBe('Base · Location · Environment');
  });

  it('formats a previous value in the current tile’s unit (BME680 gas resistance in Ω)', () => {
    const bme680 = '02 67 00 F6 02 68 75 02 73 27 96 02 79 00 A2 02 64 00 00 BC 53';
    const gas = describeChannels(readings(bme680))[0].readings.find((d) => d.reading.typeId === 100);
    if (!gas) throw new Error('fixture');
    expect(gas.unit).toBe('Ω');
    const [older] = readings('02 64 00 00 BA 00');
    expect(previousText(gas, older)).toBe(`47${GROUP_SEP}616 Ω`);
  });

  it('indexes previous lookups by reading offset', () => {
    const rs = readings('01 74 01 A9 02 67 00 F6');
    const p = { reading: rs[0], requestedAt: 1, requestId: 'x' };
    const map = previousByOffset(rs, [p, null]);
    expect(map.get(0)).toBe(p);
    expect(map.has(4)).toBe(false);
  });
});
