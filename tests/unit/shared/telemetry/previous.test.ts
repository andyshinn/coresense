import { describe, expect, it } from 'vitest';
import { MINUS } from '../../../../src/shared/telemetry/format';
import {
  buildCompareTable,
  COMPARE_MAX_COLUMNS,
  compareCsv,
  keyReadings,
  previousFor,
  previousForRequest,
  readingDelta,
  readingKey,
} from '../../../../src/shared/telemetry/previous';
import { PLAN_FIXTURE, readings, req, T1000E_REMOTE, T1000E_SELF } from './fixtures';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);

// Battery + BME280 on ch 2; `v` and `t` are the voltage and temperature hex.
const full = (v: string, t: string) => `01 74 ${v} 02 67 ${t} 02 68 75 02 73 27 96 02 79 00 A2`;
const guest = '01 74 01 A0 01 67 01 2C'; // battery + MCU temp only

describe('readingKey / keyReadings', () => {
  it('keys by (ch, typeId, occurrence)', () => {
    expect(readingKey(1, 103, 0)).toBe('1:103:0');
    expect(keyReadings(readings('02 67 00 F6 02 67 01 17')).map((k) => k.key)).toEqual(['2:103:0', '2:103:1']);
  });

  it('gives the ch 1 MCU temperature occurrence 0 whatever its payload position', () => {
    // Remote: MCU temp last; self read: MCU temp first. Either way it is 1:103:0.
    expect(keyReadings(readings(T1000E_REMOTE)).map((k) => k.key)).toEqual([
      '1:116:0',
      '1:136:0',
      '1:101:0',
      '1:103:1',
      '1:103:0',
    ]);
    expect(keyReadings(readings(T1000E_SELF), 'companion').map((k) => k.key)).toEqual([
      '1:116:0',
      '1:103:0',
      '1:136:0',
      '1:101:0',
      '1:103:1',
    ]);
  });

  it('keys a board without an MCU temperature in plain payload order (Wio-E5 BME280 on Self)', () => {
    const wio = readings('01 74 01 9A 01 67 00 DC 01 68 75 01 73 27 96');
    const keys = ['1:116:0', '1:103:0', '1:104:0', '1:115:0'];
    expect(keyReadings(wio).map((k) => k.key)).toEqual(keys);
    expect(keyReadings(wio, 'companion').map((k) => k.key)).toEqual(keys);
  });
});

describe('previousFor', () => {
  // Newest first, as the store returns them.
  const requests = [
    req('r6', T0 + 6 * H, `${full('01 A9', '00 F6')} 03 74 02 00 03 75 00 B6 03 80 00 01`), // ch 3 sensor is new
    req('r5', T0 + 5 * H, null, 'timeout'),
    req('r4', T0 + 4 * H, null, 'error'),
    req('r3', T0 + 3 * H, guest), // guest: no ch 2
    req('r2', T0 + 2 * H, full('01 A6', '01 17')), // 4.22 V, 27.9 °C
    req('r1', T0 + 1 * H, full('01 9B', '00 CC')),
  ];

  it('skips timeouts, errors and a guest reply lacking the reading', () => {
    const prev = previousFor(requests, T0 + 6 * H, '2:103:0');
    expect(prev).toMatchObject({ requestId: 'r2', requestedAt: T0 + 2 * H });
    expect(prev?.reading.value).toBe(27.9);
  });

  it('uses the guest reply when it does have the reading', () => {
    const prev = previousFor(requests, T0 + 6 * H, '1:116:0');
    expect(prev).toMatchObject({ requestId: 'r3' });
    expect(prev?.reading.value).toBe(4.16);
  });

  it('returns null for a newly added sensor', () => {
    expect(previousFor(requests, T0 + 6 * H, '3:116:0')).toBeNull();
  });

  it('returns null for the oldest request', () => {
    expect(previousFor(requests, T0 + 1 * H, '2:103:0')).toBeNull();
  });

  it('does not depend on list order', () => {
    const shuffled = [requests[4], requests[0], requests[5], requests[3], requests[1], requests[2]];
    expect(previousFor(shuffled, T0 + 6 * H, '2:103:0')?.requestId).toBe('r2');
  });

  it('matches duplicate ch 1 temperatures by occurrence', () => {
    const t1000 = [
      req('b', T0 + 2 * H, T1000E_REMOTE),
      req('a', T0 + H, T1000E_REMOTE.replace('01 67 00 DC', '01 67 00 C8').replace('01 67 01 36', '01 67 01 40')),
    ];
    expect(previousFor(t1000, T0 + 2 * H, '1:103:1')?.reading.value).toBe(20);
    expect(previousFor(t1000, T0 + 2 * H, '1:103:0')?.reading.value).toBe(32);
  });

  it('never pairs a guest reply MCU temp with a full reply sensor temp (T1000-E)', () => {
    const t1000 = [
      req('full', T0 + 2 * H, T1000E_REMOTE), // sensor 22.0 °C, MCU 31.0 °C
      req('guest', T0 + H, '01 74 01 8C 01 67 01 2C'), // battery + MCU 30.0 °C
      req('older', T0, T1000E_REMOTE.replace('01 67 00 DC', '01 67 00 C8')), // sensor 20.0 °C
    ];
    const prev = previousForRequest(t1000, t1000[0]);
    // Sensor temperature (index 3) skips the guest reply; MCU temp (index 4) uses it.
    expect(prev[3]).toMatchObject({ requestId: 'older', reading: { value: 20 } });
    expect(prev[4]).toMatchObject({ requestId: 'guest', reading: { value: 30 } });
  });

  it('uses each request source to find the MCU temperature', () => {
    const self = [req('b', T0 + H, T1000E_SELF), req('a', T0, T1000E_SELF.replace('01 67 01 36', '01 67 01 40'))].map(
      (r) => ({ ...r, source: 'companion' as const }),
    );
    expect(previousFor(self, T0 + H, '1:103:0')?.reading.value).toBe(32);
    expect(previousFor(self, T0 + H, '1:103:1')?.reading.value).toBe(22);
  });

  it('previousForRequest aligns with the request readings', () => {
    const prev = previousForRequest(requests, requests[0]);
    expect(prev).toHaveLength(8);
    expect(prev.map((p) => p?.requestId ?? null)).toEqual(['r3', 'r2', 'r2', 'r2', 'r2', null, null, null]);
  });
});

describe('readingDelta', () => {
  const one = (hex: string) => readings(hex)[0];

  it('signs and units the change', () => {
    expect(readingDelta(one('01 74 01 A9'), one('01 74 01 A6'))).toEqual({
      direction: 'up',
      magnitude: '0.03',
      text: '+0.03 V',
    });
    expect(readingDelta(one('02 67 00 F6'), one('02 67 01 17'))).toEqual({
      direction: 'down',
      magnitude: '3.3',
      text: `${MINUS}3.3 °C`,
    });
    expect(readingDelta(one('02 68 75'), one('02 68 62')).text).toBe('+9.5%');
    expect(readingDelta(one('03 75 00 B6'), one('03 75 00 AA')).text).toBe('+12 mA');
  });

  it('shows a current change in the unit of the current value, like its tile', () => {
    // 1.250 A (tile "1.250 A") from 0.950 A: a 0.3 A change, not "300" next to an amps value.
    expect(readingDelta(one('04 75 04 E2'), one('04 75 03 B6')).text).toBe('+0.300 A');
    // 0.950 A (tile "950 mA") from 1.250 A.
    expect(readingDelta(one('04 75 03 B6'), one('04 75 04 E2'))).toEqual({
      direction: 'down',
      magnitude: '300',
      text: `${MINUS}300 mA`,
    });
  });

  it('takes the described unit where describe overrides the registry', () => {
    const gas = (hex: string) => one(`02 64 ${hex}`);
    expect(readingDelta(gas('00 00 BC 53'), gas('00 00 BB E2'), 'Ω').text).toBe('+113 Ω');
    // RAK12035 dry calibration rides in a power field; its W is suppressed.
    expect(readingDelta(one('03 80 00 64'), one('03 80 00 60'), '').text).toBe('+4');
  });

  it('reports equal values as unchanged', () => {
    expect(readingDelta(one('02 67 00 F6'), one('02 67 00 F6'))).toEqual({
      direction: 'same',
      magnitude: '',
      text: 'unchanged',
    });
  });

  it('reports GPS movement as a distance', () => {
    const a = one('01 88 04 9C 22 F1 15 2A 00 41 C8');
    expect(readingDelta(a, a).direction).toBe('same');
    const moved = one('01 88 04 9C 23 F1 15 2A 00 41 C8'); // lat +0.0001° ≈ 11 m
    expect(readingDelta(moved, a)).toEqual({ direction: 'moved', magnitude: '11', text: 'moved 11 m' });
  });
});

describe('buildCompareTable', () => {
  const r4 = req('r4', T0 + 30 * H, PLAN_FIXTURE); // 4.25 V, 24.6 °C, ch 3 power monitor appears
  const r3 = req('r3', T0 + 28 * H, full('01 A6', '01 17')); // 4.22 V, 27.9 °C
  const r2 = req('r2', T0 + 4 * H, guest); // battery 4.16 V + MCU temp
  const r1 = req('r1', T0, full('01 A6', '01 17')); // identical to r3

  it('orders columns newest-left whatever the input order, with gaps to the left neighbour', () => {
    const t = buildCompareTable([r1, r4, r2, r3]);
    expect(t.columns).toEqual([
      { id: 'r4', requestedAt: T0 + 30 * H, gapMs: null },
      { id: 'r3', requestedAt: T0 + 28 * H, gapMs: 2 * H },
      { id: 'r2', requestedAt: T0 + 4 * H, gapMs: 24 * H },
      { id: 'r1', requestedAt: T0, gapMs: 4 * H },
    ]);
    expect(t.spanMs).toBe(30 * H);
  });

  it('groups rows by channel and marks deltas against the column to the right', () => {
    const t = buildCompareTable([r4, r3, r2, r1]);
    expect(t.groups.map((g) => [g.ch, g.name, g.rows.map((r) => r.label)])).toEqual([
      [1, 'Self', ['Battery', 'GPS', 'MCU temp']],
      [2, 'Environment', ['Temperature', 'Humidity', 'Pressure', 'Altitude']],
      [3, 'Power', ['Bus voltage', 'Current', 'Power']],
    ]);
    const cells = (ch: number, i: number) =>
      t.groups.find((g) => g.ch === ch)?.rows[i].cells.map((c) => [c.text, c.mark, c.magnitude]);

    expect(cells(1, 0)).toEqual([
      ['4.25 V', 'up', '0.03'],
      ['4.22 V', 'up', '0.06'],
      ['4.16 V', 'down', '0.06'],
      ['4.22 V', 'none', ''],
    ]);
    // Temperature: missing in the guest column; r3 vs r2 has no right-hand
    // value but an older column has it, so no mark.
    expect(cells(2, 0)).toEqual([
      ['24.6 °C', 'down', '3.3'],
      ['27.9 °C', 'none', ''],
      ['—', 'none', ''],
      ['27.9 °C', 'none', ''],
    ]);
    // GPS and the power monitor appear first in the newest column.
    expect(cells(1, 1)?.map((c) => c[1])).toEqual(['new', 'none', 'none', 'none']);
    expect(cells(3, 1)).toEqual([
      ['182 mA', 'new', ''],
      ['—', 'none', ''],
      ['—', 'none', ''],
      ['—', 'none', ''],
    ]);
  });

  it('show changes only hides rows whose values are all equal', () => {
    const t = buildCompareTable([r3, r1], { changesOnly: true });
    expect(t.groups).toEqual([]);
    const all = buildCompareTable([r3, r1]);
    expect(all.groups.flatMap((g) => g.rows.map((r) => r.changed))).toEqual([false, false, false, false, false]);
    const mixed = buildCompareTable([r4, r3], { changesOnly: true });
    expect(mixed.groups.map((g) => [g.ch, g.rows.map((r) => r.label)])).toEqual([
      [1, ['Battery', 'GPS']],
      [2, ['Temperature']],
      [3, ['Bus voltage', 'Current', 'Power']],
    ]);
  });

  it('flags drift when a channel field set changes, but not for ch 1 or absent channels', () => {
    const aht = req('aht', T0 + 40 * H, '01 74 01 A9 02 67 00 F6 02 68 75');
    const t = buildCompareTable([aht, r4, r3, r2]);
    expect(t.driftChannels).toEqual([2]);
    expect(t.groups.find((g) => g.ch === 2)?.drift).toBe(true);
    expect(t.groups.find((g) => g.ch === 1)?.drift).toBe(false);
    expect(buildCompareTable([r4, r3, r2]).driftChannels).toEqual([]);
  });

  it('keeps at most six columns, the newest', () => {
    const many = Array.from({ length: 8 }, (_, i) => req(`r${i}`, T0 + i * H, full('01 A9', '00 F6')));
    const t = buildCompareTable(many);
    expect(t.columns).toHaveLength(COMPARE_MAX_COLUMNS);
    expect(t.columns.map((c) => c.id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3', 'r2']);
  });
});

describe('compareCsv', () => {
  it('writes reading,ch,type,<ISO per column> with raw base-unit values', () => {
    const a = req('a', Date.UTC(2026, 9, 9, 21, 29, 48), '01 74 01 A9 01 88 04 9C 22 F1 15 2A 00 41 C8 02 67 FF 38');
    const b = req('b', Date.UTC(2026, 9, 9, 19, 15, 2), '01 74 01 A6 03 75 00 B6');
    const csv = compareCsv(buildCompareTable([b, a]));
    expect(csv).toBe(
      [
        'reading,ch,type,2026-10-09T21:29:48.000Z,2026-10-09T19:15:02.000Z',
        'Battery (V),1,116,4.25,4.22',
        'GPS (lat lon alt),1,136,30.2114 -97.7622 168.4,',
        'Temperature (°C),2,103,-20,',
        'Current (A),3,117,,0.182',
        '',
      ].join('\n'),
    );
  });

  it('quotes fields that need it', () => {
    const table = buildCompareTable([req('a', T0, '02 67 00 F6')]);
    table.groups[0].rows[0].label = 'Temp, "probe"';
    expect(compareCsv(table).split('\n')[1]).toBe('"Temp, ""probe"" (°C)",2,103,24.6');
  });
});
