// My Node's "was 3.81 V at 09:12" line: previousFor over the companion's own
// saved snapshots. Self reads put the MCU temperature right after the
// battery (remote replies put it last), and sensors can be fitted or removed
// between snapshots.

import { describe, expect, it } from 'vitest';
import {
  type DecodedRequest,
  keyReadings,
  previousFor,
  previousForRequest,
} from '../../../../src/shared/telemetry/previous';
import { readings } from './fixtures';

const BATTERY = (centivolts: string) => `01 74 ${centivolts}`;
const MCU_TEMP = '01 67 01 36'; // 31.0 °C
const ENV_TEMP = (decidegrees: string) => `02 67 ${decidegrees}`;
const HUMIDITY = '02 68 75'; // 58.5 %

let seq = 0;
function snapshot(at: number, hex: string, outcome: DecodedRequest['outcome'] = 'ok'): DecodedRequest {
  seq += 1;
  return { id: `s${seq}`, requestedAt: at, outcome, readings: readings(hex), source: 'companion' };
}

/** A live read: not saved, so it is "now" against every saved snapshot. */
function live(at: number, hex: string): DecodedRequest {
  return { id: 'live', requestedAt: at, outcome: 'ok', readings: readings(hex), source: 'companion' };
}

function keyOf(req: DecodedRequest, ch: number, typeId: number, occurrence = 0): string {
  const found = keyReadings(req.readings, 'companion').find(
    (k) => k.reading.ch === ch && k.reading.typeId === typeId && k.occurrence === occurrence,
  );
  if (!found) throw new Error(`no ${ch}:${typeId}:${occurrence}`);
  return found.key;
}

describe('previousFor over companion snapshots', () => {
  it('pairs a live battery reading with the latest snapshot that has one', () => {
    const history = [
      snapshot(100, `${BATTERY('01 7D')} ${MCU_TEMP}`), // 3.81 V
      snapshot(200, `${BATTERY('01 9D')} ${MCU_TEMP}`), // 4.13 V
    ];
    const now = live(300, `${BATTERY('01 A0')} ${MCU_TEMP}`);

    const prev = previousFor(history, now.requestedAt, keyOf(now, 1, 116));

    expect(prev?.requestedAt).toBe(200);
    expect(prev?.reading.value).toBeCloseTo(4.13);
  });

  it('has no previous for a sensor that appeared since the last snapshot', () => {
    const history = [snapshot(100, `${BATTERY('01 9D')} ${MCU_TEMP}`)];
    const now = live(200, `${BATTERY('01 9D')} ${MCU_TEMP} ${ENV_TEMP('00 F1')} ${HUMIDITY}`);

    const prev = previousForRequest(history, now);

    expect(prev.map((p) => p?.requestedAt ?? null)).toEqual([100, 100, null, null]);
  });

  it('reaches past a snapshot taken while a sensor was unplugged', () => {
    const history = [
      snapshot(100, `${BATTERY('01 9D')} ${MCU_TEMP} ${ENV_TEMP('00 C8')}`), // 20.0 °C
      snapshot(200, `${BATTERY('01 9D')} ${MCU_TEMP}`), // sensor gone
    ];
    const now = live(300, `${BATTERY('01 9D')} ${MCU_TEMP} ${ENV_TEMP('00 F1')}`);

    const prev = previousFor(history, now.requestedAt, keyOf(now, 2, 103));

    expect(prev?.requestedAt).toBe(100);
    expect(prev?.reading.value).toBeCloseTo(20.0);
  });

  it('keeps the MCU temperature and a ch 1 sensor temperature apart (T1000-E self read)', () => {
    // Self order: battery, MCU temp, then sensors. The older snapshot has no
    // ch 1 sensor temperature yet.
    const history = [snapshot(100, `${BATTERY('01 8C')} 01 67 01 2C`)]; // MCU 30.0 °C
    const now = live(200, `${BATTERY('01 8C')} ${MCU_TEMP} 01 65 00 32 01 67 00 DC`); // MCU 31.0, lux, sensor 22.0

    const mcuKey = keyOf(now, 1, 103, 0);
    const sensorKey = keyOf(now, 1, 103, 1);

    expect(previousFor(history, now.requestedAt, mcuKey)?.reading.value).toBeCloseTo(30.0);
    expect(previousFor(history, now.requestedAt, sensorKey)).toBeNull();
  });

  it('ignores failed rows and anything at or after the live read', () => {
    const history = [
      snapshot(100, `${BATTERY('01 7D')} ${MCU_TEMP}`),
      snapshot(150, '', 'timeout'),
      snapshot(300, `${BATTERY('01 A0')} ${MCU_TEMP}`),
    ];
    const now = live(300, `${BATTERY('01 9D')} ${MCU_TEMP}`);

    expect(previousFor(history, now.requestedAt, keyOf(now, 1, 116))?.requestedAt).toBe(100);
  });

  it('has no previous when nothing has been saved', () => {
    const now = live(300, `${BATTERY('01 9D')} ${MCU_TEMP}`);
    expect(previousForRequest([], now)).toEqual([null, null]);
  });
});
