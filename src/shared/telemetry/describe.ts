// Reading semantics: labels, icons, units, secondary lines and per-channel
// group names. Pure and shared, so the tab, rail, compare table and CSV all
// say the same thing.
//
// The LPP payload carries no sensor names, so a group's sensor is only ever
// inferred from the set of readings on its channel, and the caption says so
// ("field set matches BME280"), never states it. The field sets follow what
// MeshCore's EnvironmentSensorManager actually emits (one channel per sensor,
// ch 2 up, in its table order):
//   AHT10/20, SHTC3, SHT4x   temp + humidity
//   BME680                   temp, humidity, barometer, altitude, generic (gas Ω)
//   BME680 + BSEC            the above with generic = IAQ, + analog in (IAQ accuracy 0–3)
//   BME280                   temp, humidity, barometer, altitude
//   BMP280, BMP085           temp, barometer, altitude
//   LPS22HB                  temp, barometer
//   INA219/226/260           voltage, current, power
//   INA3221                  voltage, current, power on EACH enabled input, one
//                            channel per input (up to 3 consecutive channels)
//   MLX90614                 two channels, one temp each (object, then ambient)
//   VL53L0X                  distance (0 = out of range)
//   RAK12035                 temp + percentage (moisture); with calibration a
//                            second channel of frequency (capacitance), temp
//                            (wet value) and power (dry value) — misused types,
//                            so their units are suppressed
// Ch 1 is always "Self": battery voltage, the MCU temperature on boards that
// have one, GPS, and on some variants (T1000-E, Wio-E5, MeshTracker) sensors.

import { lipoPercent } from '../battery';
import { fmtFahrenheit, fmtFeet, formatNumber, hPaToInHg, mToFt, mToIn, withUnit } from './format';
import { isGpsValue, LPP_TYPES, type Reading } from './lpp';
import type { TelemetrySource } from './types';

export const SELF_CHANNEL = 1;

/** What a reading is, beyond its type: the UI draws battery and GPS tiles differently. */
export type ReadingKind = 'battery' | 'mcuTemp' | 'gps' | 'reading';

export interface DescribedReading {
  reading: Reading;
  kind: ReadingKind;
  label: string;
  /** lucide-react icon export name. */
  icon: string;
  /** Registry short type name for meta lines ("voltage · 116"). */
  typeName: string;
  /** Formatted value without unit: "4.25", "−20.0", "30.2114, −97.7622", "out of range". */
  value: string;
  /** Display unit, '' when none or suppressed. May differ from the registry's base unit ("mA"). */
  unit: string;
  /** Unit of the raw `reading.value` (registry unit); '' where the type is misused (RAK12035 calibration). */
  baseUnit: string;
  /** value + unit joined by the design rules: "4.25 V", "58.5%", "out of range". */
  text: string;
  /** Imperial or derived secondary line ("76.3 °F", "dew point 15.9 °C"); null when none. */
  secondary: string | null;
  /** Estimated LiPo charge for a battery reading inside 3.0–4.4 V; null otherwise. */
  batteryPercent: number | null;
}

export interface ChannelInfo {
  ch: number;
  /** "Self", "Environment", "Power" or "Sensors". */
  name: string;
  /** The matched sensor(s), e.g. "BME280"; null when nothing matches (and always on ch 1). */
  match: string | null;
  /** "field set matches BME280"; on ch 1 the content ("battery · MCU temp · position"); '' otherwise. */
  caption: string;
}

export interface ChannelGroup extends ChannelInfo {
  readings: DescribedReading[];
}

type MatchKind =
  | 'aht'
  | 'bme680'
  | 'bsec'
  | 'bme280'
  | 'bmp280'
  | 'lps22hb'
  | 'ina'
  | 'vl53l0x'
  | 'rak12035'
  | 'rakCal'
  | 'mlxObject'
  | 'mlxAmbient';

interface MatchRow {
  set: number[];
  kind: MatchKind;
  match: string;
  name: string;
}

const INA_MATCH = 'INA219 / INA226 / INA260 / INA3221';

// Exact field sets (sorted type ids). A lone temperature is MLX90614 only
// when paired with a neighbouring lone temperature, handled separately.
const MATCH_ROWS: MatchRow[] = [
  { set: [103, 104], kind: 'aht', match: 'AHT / SHTC3 / SHT4x', name: 'Environment' },
  { set: [100, 103, 104, 115, 121], kind: 'bme680', match: 'BME680', name: 'Environment' },
  { set: [2, 100, 103, 104, 115, 121], kind: 'bsec', match: 'BME680 + BSEC', name: 'Environment' },
  { set: [103, 104, 115, 121], kind: 'bme280', match: 'BME280', name: 'Environment' },
  { set: [103, 115, 121], kind: 'bmp280', match: 'BMP280 / BMP085', name: 'Environment' },
  { set: [103, 115], kind: 'lps22hb', match: 'LPS22HB', name: 'Environment' },
  { set: [116, 117, 128], kind: 'ina', match: INA_MATCH, name: 'Power' },
  // Every INA query in current firmware adds power too; a bare V + I set is
  // still unmistakably a power monitor.
  { set: [116, 117], kind: 'ina', match: INA_MATCH, name: 'Power' },
  { set: [130], kind: 'vl53l0x', match: 'VL53L0X', name: 'Environment' },
  { set: [103, 120], kind: 'rak12035', match: 'RAK12035', name: 'Environment' },
  { set: [103, 118, 128], kind: 'rakCal', match: 'RAK12035 calibration', name: 'Environment' },
];

/** Sorted type ids of the readings, comma-joined, duplicates kept: the channel's field set. */
export function fieldSet(readings: readonly Reading[]): string {
  return readings
    .map((r) => r.typeId)
    .sort((a, b) => a - b)
    .join(',');
}

interface ChannelAnalysis extends ChannelInfo {
  kind: MatchKind | null;
}

interface Analysis {
  channels: Map<number, ChannelAnalysis>;
  byChannel: Map<number, Reading[]>;
  batteryOffset: number | null;
  mcuOffset: number | null;
}

function groupByChannel(readings: readonly Reading[]): Map<number, Reading[]> {
  const out = new Map<number, Reading[]>();
  for (const r of readings) {
    const list = out.get(r.ch);
    if (list) list.push(r);
    else out.set(r.ch, [r]);
  }
  return out;
}

const SELF_PARTS: Record<number, string> = { 116: 'battery', 136: 'position' };

/**
 * The ch 1 MCU temperature of a payload, if any (the returned object is one
 * of `readings`). Its position differs by path: a remote reply appends it
 * after the sensors (simple_repeater/companion MyMesh.cpp), so it is the last
 * ch 1 temperature; a companion self read adds it straight after the battery
 * (companion MyMesh.cpp self branch), so it is the first.
 */
export function mcuTemperature(readings: readonly Reading[], source: TelemetrySource = 'repeater'): Reading | undefined {
  const temps = readings.filter((r) => r.ch === SELF_CHANNEL && r.typeId === 103);
  return source === 'companion' ? temps[0] : temps[temps.length - 1];
}

function analyze(readings: readonly Reading[], source: TelemetrySource): Analysis {
  const byChannel = groupByChannel(readings);
  const self = byChannel.get(SELF_CHANNEL) ?? [];
  const battery = self.find((r) => r.typeId === 116);
  const mcu = mcuTemperature(self, source);

  const channels = new Map<number, ChannelAnalysis>();
  const ordered = [...byChannel.keys()].sort((a, b) => a - b);
  for (const ch of ordered) {
    const list = byChannel.get(ch) ?? [];
    if (ch === SELF_CHANNEL) {
      const parts: string[] = [];
      for (const r of list) {
        const part =
          r === mcu ? 'MCU temp' : (SELF_PARTS[r.typeId] ?? (LPP_TYPES[r.typeId]?.name ?? 'reading').toLowerCase());
        if (!parts.includes(part)) parts.push(part);
      }
      channels.set(ch, { ch, name: 'Self', match: null, caption: parts.join(' · '), kind: null });
      continue;
    }
    const set = fieldSet(list);
    const row = MATCH_ROWS.find((m) => m.set.join(',') === set);
    channels.set(
      ch,
      row
        ? { ch, name: row.name, match: row.match, caption: `field set matches ${row.match}`, kind: row.kind }
        : { ch, name: 'Sensors', match: null, caption: '', kind: null },
    );
  }

  // MLX90614: two adjacent lone-temperature channels, object then ambient.
  for (const ch of ordered) {
    // Sensors start at ch 2; never pair across (or into) the Self channel.
    if (ch <= SELF_CHANNEL) continue;
    const a = channels.get(ch);
    const b = channels.get(ch + 1);
    if (!a || !b || a.kind || b.kind) continue;
    if (fieldSet(byChannel.get(ch) ?? []) !== '103' || fieldSet(byChannel.get(ch + 1) ?? []) !== '103') continue;
    const match = 'MLX90614 (object/ambient)';
    const caption = `field set matches ${match}`;
    channels.set(ch, { ch, name: 'Environment', match, caption, kind: 'mlxObject' });
    channels.set(ch + 1, { ch: ch + 1, name: 'Environment', match, caption, kind: 'mlxAmbient' });
  }

  // INA3221: one channel per enabled input, so 2–3 consecutive power
  // channels most likely belong to one chip. Say which input this is.
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2 && run.length <= 3) {
      run.forEach((ch, i) => {
        const info = channels.get(ch);
        if (!info) return;
        info.match = 'INA3221';
        info.caption = `field set matches INA3221 · input ${i + 1} of ${run.length}`;
      });
    }
    run = [];
  };
  for (const ch of ordered) {
    if (channels.get(ch)?.kind !== 'ina') {
      flush();
      continue;
    }
    if (run.length > 0 && run[run.length - 1] !== ch - 1) flush();
    run.push(ch);
  }
  flush();

  return {
    channels,
    byChannel,
    batteryOffset: battery ? battery.offset : null,
    mcuOffset: mcu ? mcu.offset : null,
  };
}

/** Battery % estimate from volts, only for a plausible single-cell LiPo (3.0–4.4 V). */
export function batteryEstimate(volts: number): number | null {
  if (!Number.isFinite(volts) || volts < 3.0 || volts > 4.4) return null;
  return lipoPercent(Math.round(volts * 1000));
}

/** Dew point (°C) from temperature and relative humidity, Magnus formula. Null for RH ≤ 0. */
export function dewPoint(tempC: number, rh: number): number | null {
  if (!(rh > 0) || !Number.isFinite(tempC)) return null;
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(Math.min(rh, 100) / 100) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

/**
 * ≈ |V × I| from the first voltage and current on a channel; power itself has
 * 1 W resolution. A magnitude, like the power reading it refines: the INA
 * power registers are unsigned, and INA3221's `addPower(v * c)` loses the sign
 * of a negative current (LPP 128 is unsigned). The current tile shows direction.
 */
export function powerEstimate(channelReadings: readonly Reading[]): number | null {
  const v = channelReadings.find((r) => r.typeId === 116)?.value;
  const i = channelReadings.find((r) => r.typeId === 117)?.value;
  return typeof v === 'number' && typeof i === 'number' ? Math.abs(v * i) : null;
}

function num(r: Reading): number {
  return typeof r.value === 'number' ? r.value : Number.NaN;
}

function describeWith(reading: Reading, a: Analysis): DescribedReading {
  const type = LPP_TYPES[reading.typeId];
  const channel = a.channels.get(reading.ch);
  const kind = channel?.kind ?? null;
  const siblings = a.byChannel.get(reading.ch) ?? [];
  const decimals = type?.decimals ?? 0;
  const v = num(reading);

  const out: DescribedReading = {
    reading,
    kind: 'reading',
    label: type?.name ?? `Type ${reading.typeId}`,
    icon: type?.icon ?? 'CircleHelp',
    typeName: type?.short ?? String(reading.typeId),
    value: formatNumber(v, decimals),
    unit: type?.unit ?? '',
    baseUnit: type?.unit ?? '',
    text: '',
    secondary: null,
    batteryPercent: null,
  };

  switch (reading.typeId) {
    case 116:
      if (reading.ch === SELF_CHANNEL && reading.offset === a.batteryOffset) {
        out.kind = 'battery';
        out.label = 'Battery';
        out.icon = 'Battery';
        out.batteryPercent = batteryEstimate(v);
        if (out.batteryPercent !== null) out.secondary = `≈ ${out.batteryPercent}% est.`;
      } else if (reading.ch > SELF_CHANNEL) {
        out.label = 'Bus voltage';
      }
      break;
    case 117:
      if (Math.abs(v) < 1) {
        out.value = formatNumber(v * 1000, 0);
        out.unit = 'mA';
        out.secondary = withUnit(formatNumber(v, 3), 'A');
      }
      break;
    case 128:
      if (kind === 'rakCal') {
        out.label = 'Dry calibration';
        out.unit = '';
        out.baseUnit = '';
        out.secondary = 'calibration value';
      } else {
        const est = powerEstimate(siblings);
        if (est !== null) out.secondary = `≈ ${withUnit(formatNumber(est, 2), 'W')} est. from V × I`;
      }
      break;
    case 103:
      if (reading.ch === SELF_CHANNEL && reading.offset === a.mcuOffset) {
        out.kind = 'mcuTemp';
        out.label = 'MCU temp';
        out.icon = 'Cpu';
      } else if (kind === 'mlxObject') {
        out.label = 'Object temp';
        out.icon = 'Target';
      } else if (kind === 'mlxAmbient') {
        out.label = 'Ambient temp';
      }
      if (kind === 'rakCal') {
        out.label = 'Wet calibration';
        out.unit = '';
        out.baseUnit = '';
        out.secondary = 'calibration value';
      } else {
        out.secondary = fmtFahrenheit(v);
      }
      break;
    case 104: {
      // Dew point from a temperature on the same channel (never the MCU's).
      const t = siblings.find((r) => r.typeId === 103 && !(r.ch === SELF_CHANNEL && r.offset === a.mcuOffset));
      const dp = t ? dewPoint(num(t), v) : null;
      if (dp !== null) out.secondary = `dew point ${withUnit(formatNumber(dp, 1), '°C')}`;
      break;
    }
    case 115:
      out.secondary = withUnit(formatNumber(hPaToInHg(v), 2), 'inHg');
      break;
    case 121:
      out.value = formatNumber(v, 0, { group: true });
      out.secondary = siblings.some((r) => r.typeId === 115) ? `barometric · ${fmtFeet(v)}` : fmtFeet(v);
      break;
    case 130:
      if (v === 0) {
        // VL53L0X writes 0 when RangeStatus == 4 (out of range).
        out.value = 'out of range';
        out.unit = '';
      } else {
        out.secondary =
          mToFt(v) >= 3 ? withUnit(formatNumber(mToFt(v), 1), 'ft') : withUnit(formatNumber(mToIn(v), 1), 'in');
      }
      break;
    case 136:
      if (isGpsValue(reading.value)) {
        const { lat, lon, alt } = reading.value;
        out.kind = 'gps';
        out.value = `${formatNumber(lat, 4)}, ${formatNumber(lon, 4)}`;
        out.unit = '';
        out.secondary = `altitude ${withUnit(formatNumber(alt, 2), 'm')} · ${fmtFeet(alt)}`;
      }
      break;
    case 100:
      out.value = formatNumber(v, 0, { group: true });
      if (kind === 'bme680') {
        out.label = 'Gas resistance';
        out.unit = 'Ω';
        out.baseUnit = 'Ω';
      } else if (kind === 'bsec') {
        out.label = 'IAQ';
        out.secondary = 'air quality index';
      }
      break;
    case 2:
      if (kind === 'bsec') {
        out.label = 'IAQ accuracy';
        out.value = formatNumber(v, 0);
        out.secondary = 'accuracy 0–3';
      }
      break;
    case 118:
      out.value = formatNumber(v, 0, { group: true });
      if (kind === 'rakCal') {
        out.label = 'Capacitance';
        out.unit = '';
        out.baseUnit = '';
        out.secondary = 'calibration value';
      }
      break;
    case 120:
      if (kind === 'rak12035') out.label = 'Soil moisture';
      break;
    case 101:
    case 125:
      out.value = formatNumber(v, 0, { group: true });
      break;
    case 142:
      out.value = v ? 'on' : 'off';
      break;
  }

  out.text = withUnit(out.value, out.unit);
  return out;
}

/**
 * Describe one reading. Pass the whole request's readings (at least the
 * reading's own channel; the MLX90614 pair also looks at the next channel).
 * `source` decides which ch 1 temperature is the MCU's: the last one for
 * remote replies, the first for companion self reads.
 */
export function describeReading(
  reading: Reading,
  readings: readonly Reading[],
  source: TelemetrySource = 'repeater',
): DescribedReading {
  // Match by position, not identity: readings may have been through JSON.
  const present = readings.some((r) => r.offset === reading.offset && r.ch === reading.ch && r.typeId === reading.typeId);
  const all = present ? readings : [...readings, reading];
  return describeWith(reading, analyze(all, source));
}

/** Group a request's readings by channel (ascending), each with its name, match caption and described readings. */
export function describeChannels(readings: readonly Reading[], source: TelemetrySource = 'repeater'): ChannelGroup[] {
  const a = analyze(readings, source);
  return [...a.channels.values()].map(({ kind: _kind, ...info }) => ({
    ...info,
    readings: (a.byChannel.get(info.ch) ?? []).map((r) => describeWith(r, a)),
  }));
}
