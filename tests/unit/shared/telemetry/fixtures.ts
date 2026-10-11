import { decodeLpp, hexToBytes, type Reading } from '../../../../src/shared/telemetry/lpp';
import type { DecodedRequest } from '../../../../src/shared/telemetry/previous';

export function bytes(hex: string): Uint8Array {
  const out = hexToBytes(hex);
  if (!out) throw new Error(`bad hex: ${hex}`);
  return out;
}

export function readings(hex: string): Reading[] {
  return decodeLpp(bytes(hex)).readings;
}

/** The PLAN 1.1 / mockup payload: 42 bytes, 9 readings. */
export const PLAN_FIXTURE = [
  '01 74 01 A9', // ch1 voltage   4.25 V (battery)
  '01 88 04 9C 22 F1 15 2A 00 41 C8', // ch1 gps 30.2114, -97.7622, 168.40 m
  '02 67 00 F6', // ch2 temp      24.6 °C
  '02 68 75', // ch2 humidity  58.5 %
  '02 73 27 96', // ch2 barometer 1013.4 hPa
  '02 79 00 A2', // ch2 altitude  162 m
  '03 74 02 00', // ch3 voltage   5.12 V
  '03 75 00 B6', // ch3 current   0.182 A
  '03 80 00 01', // ch3 power     1 W
].join(' ');

/** INA3221 with all three inputs: V + I + P on ch 2, 3, 4 (ch 3 discharging). */
export const INA3221_FIXTURE = [
  '01 74 01 9A', // battery 4.10 V
  '02 74 05 14', // 13.00 V
  '02 75 00 FA', // 0.250 A
  '02 80 00 03', // 3 W
  '03 74 01 F4', // 5.00 V
  '03 75 FF 4A', // −0.182 A
  '03 80 00 00', // 0 W
  '04 74 04 B0', // 12.00 V
  '04 75 04 E2', // 1.250 A
  '04 80 00 0F', // 15 W
  '01 67 01 36', // MCU temp 31.0 °C (remote: last)
].join(' ');

/** T1000-E remote reply: ch 1 battery, GPS, luminosity, sensor temp, then MCU temp last. */
export const T1000E_REMOTE = [
  '01 74 01 8C', // 3.96 V
  '01 88 04 9C 22 F1 15 2A 00 41 C8', // GPS
  '01 65 00 32', // luminosity 50
  '01 67 00 DC', // sensor temp 22.0 °C
  '01 67 01 36', // MCU temp 31.0 °C
].join(' ');

/** The same board read over BLE (companion self read): MCU temp straight after the battery. */
export const T1000E_SELF = [
  '01 74 01 8C',
  '01 67 01 36', // MCU temp 31.0 °C (self: first)
  '01 88 04 9C 22 F1 15 2A 00 41 C8',
  '01 65 00 32',
  '01 67 00 DC', // sensor temp 22.0 °C
].join(' ');

export function req(
  id: string,
  requestedAt: number,
  hex: string | null,
  outcome: DecodedRequest['outcome'] = 'ok',
): DecodedRequest {
  return { id, requestedAt, outcome, readings: hex ? readings(hex) : [] };
}
