import { describe, expect, it } from 'vitest';
import {
  batteryEstimate,
  describeChannels,
  describeReading,
  dewPoint,
  powerEstimate,
} from '../../../../src/shared/telemetry/describe';
import { GROUP_SEP } from '../../../../src/shared/telemetry/format';
import { INA3221_FIXTURE, PLAN_FIXTURE, readings, T1000E_REMOTE, T1000E_SELF } from './fixtures';

const pick = (rs: ReturnType<typeof describeChannels>) =>
  rs.map((g) => ({ ch: g.ch, name: g.name, match: g.match, caption: g.caption }));

describe('describeChannels on the PLAN fixture', () => {
  const groups = describeChannels(readings(PLAN_FIXTURE), 'repeater');

  it('groups by channel with names and match captions', () => {
    expect(pick(groups)).toEqual([
      { ch: 1, name: 'Self', match: null, caption: 'battery · position' },
      { ch: 2, name: 'Environment', match: 'BME280', caption: 'field set matches BME280' },
      {
        ch: 3,
        name: 'Power',
        match: 'INA219 / INA226 / INA260 / INA3221',
        caption: 'field set matches INA219 / INA226 / INA260 / INA3221',
      },
    ]);
  });

  it('describes every reading with exact display values', () => {
    const rows = groups.flatMap((g) => g.readings.map((d) => [d.label, d.icon, d.typeName, d.text, d.secondary] as const));
    expect(rows).toEqual([
      ['Battery', 'Battery', 'voltage', '4.25 V', '≈ 100% est.'],
      ['GPS', 'MapPin', 'gps', '30.2114, −97.7622', 'altitude 168.40 m · 552 ft'],
      ['Temperature', 'Thermometer', 'temp', '24.6 °C', '76.3 °F'],
      ['Humidity', 'Droplet', 'humidity', '58.5%', 'dew point 15.9 °C'],
      ['Pressure', 'Gauge', 'barometer', '1013.4 hPa', '29.93 inHg'],
      ['Altitude', 'Mountain', 'altitude', '162 m', 'barometric · 531 ft'],
      ['Bus voltage', 'Zap', 'voltage', '5.12 V', null],
      ['Current', 'Plug', 'current', '182 mA', '0.182 A'],
      ['Power', 'Power', 'power', '1 W', '≈ 0.93 W est. from V × I'],
    ]);
  });

  it('flags the battery and GPS readings for their special tiles', () => {
    const [battery, gps] = groups[0].readings;
    expect(battery.kind).toBe('battery');
    expect(battery.batteryPercent).toBe(100);
    expect(gps.kind).toBe('gps');
  });
});

describe('describeReading', () => {
  it('labels ch 1 voltage Battery and ch 2+ voltage Bus voltage', () => {
    const rs = readings('01 74 01 A9 02 74 02 00');
    expect(describeReading(rs[0], rs).label).toBe('Battery');
    expect(describeReading(rs[1], rs).label).toBe('Bus voltage');
  });

  it('formats negative values with the Unicode minus', () => {
    const rs = readings('02 67 FF 38 02 74 FF FF');
    expect(describeReading(rs[0], rs).text).toBe('−20.0 °C');
    expect(describeReading(rs[0], rs).secondary).toBe('−4.0 °F');
    expect(describeReading(rs[1], rs).text).toBe('−0.01 V');
  });

  it('shows a negative current in mA', () => {
    const rs = readings('03 74 01 F4 03 75 FF 4A 03 80 00 00');
    const current = describeReading(rs[1], rs);
    expect(current.text).toBe('−182 mA');
    expect(current.secondary).toBe('−0.182 A');
    // Firmware stores |V × I| (LPP power is unsigned), so the estimate is a magnitude too.
    expect(describeReading(rs[2], rs)).toMatchObject({ text: '0 W', secondary: '≈ 0.91 W est. from V × I' });
  });

  it('keeps amps at 1 A and above', () => {
    const rs = readings('04 75 04 E2');
    expect(describeReading(rs[0], rs)).toMatchObject({ text: '1.250 A', secondary: null });
  });

  it('formats distance 0 as out of range, otherwise metres with an imperial line', () => {
    const zero = readings('02 82 00 00 00 00');
    expect(describeReading(zero[0], zero)).toMatchObject({ text: 'out of range', unit: '', secondary: null });
    const near = readings('02 82 00 00 03 4A');
    expect(describeReading(near[0], near)).toMatchObject({ text: '0.842 m', secondary: '33.1 in' });
    const far = readings('02 82 00 00 0B B8');
    expect(describeReading(far[0], far)).toMatchObject({ text: '3.000 m', secondary: '9.8 ft' });
  });

  it('works with a reading that went through JSON', () => {
    const rs = readings(PLAN_FIXTURE);
    const copy = JSON.parse(JSON.stringify(rs));
    expect(describeReading(copy[0], copy).label).toBe('Battery');
    expect(describeReading(copy[6], copy).label).toBe('Bus voltage');
  });

  it('describes a reading passed without its siblings', () => {
    const [r] = readings('02 67 00 F6');
    expect(describeReading(r, []).text).toBe('24.6 °C');
  });
});

describe('battery estimate', () => {
  it('shows ≈ N% est. only inside 3.0–4.4 V', () => {
    expect(batteryEstimate(4.25)).toBe(100);
    expect(batteryEstimate(4.04)).toBe(91);
    expect(batteryEstimate(3.0)).toBe(0);
    expect(batteryEstimate(4.4)).toBe(100);
    expect(batteryEstimate(2.99)).toBeNull();
    expect(batteryEstimate(4.41)).toBeNull();
    expect(batteryEstimate(12.6)).toBeNull();
  });

  it('hides the percentage for a 12 V repeater battery', () => {
    const rs = readings('01 74 04 EC');
    expect(describeReading(rs[0], rs)).toMatchObject({
      label: 'Battery',
      text: '12.60 V',
      secondary: null,
      batteryPercent: null,
    });
  });
});

describe('ch 1 MCU temperature', () => {
  it('is the last ch 1 temperature on a remote reply (guest: battery + MCU temp)', () => {
    const rs = readings('01 74 01 9A 01 67 01 2C');
    const [ch1] = describeChannels(rs, 'repeater');
    expect(ch1.caption).toBe('battery · MCU temp');
    expect(ch1.readings[1]).toMatchObject({ kind: 'mcuTemp', label: 'MCU temp', icon: 'Cpu', text: '30.0 °C' });
  });

  it('T1000-E remote: GPS, luminosity, sensor temp, MCU temp last', () => {
    const [ch1] = describeChannels(readings(T1000E_REMOTE), 'repeater');
    expect(ch1.caption).toBe('battery · position · luminosity · temperature · MCU temp');
    expect(ch1.readings.map((d) => [d.label, d.text])).toEqual([
      ['Battery', '3.96 V'],
      ['GPS', '30.2114, −97.7622'],
      ['Luminosity', '50 lux'],
      ['Temperature', '22.0 °C'],
      ['MCU temp', '31.0 °C'],
    ]);
  });

  it('T1000-E self read: the first ch 1 temperature is the MCU', () => {
    const [ch1] = describeChannels(readings(T1000E_SELF), 'companion');
    expect(ch1.caption).toBe('battery · MCU temp · position · luminosity · temperature');
    expect(ch1.readings.map((d) => [d.label, d.text])).toEqual([
      ['Battery', '3.96 V'],
      ['MCU temp', '31.0 °C'],
      ['GPS', '30.2114, −97.7622'],
      ['Luminosity', '50 lux'],
      ['Temperature', '22.0 °C'],
    ]);
  });

  it('a lone ch 1 temperature on a self read is still the MCU', () => {
    const rs = readings('01 74 01 9A 01 67 01 2C');
    expect(describeReading(rs[1], rs, 'companion').label).toBe('MCU temp');
  });

  // Wio-E5 (STM32: getMCUTemperature() is NaN, so firmware adds none): its
  // BME280 reports on Self — battery, temperature, humidity, pressure.
  const WIO_E5 = '01 74 01 9A 01 67 00 DC 01 68 75 01 73 27 96';

  it('Wio-E5 remote reply: no MCU temp — the payload ends in pressure, so the BME280 temperature stays a temperature', () => {
    const [ch1] = describeChannels(readings(WIO_E5), 'repeater');
    expect(ch1.caption).toBe('battery · temperature · humidity · pressure');
    expect(ch1.readings.map((d) => d.kind)).not.toContain('mcuTemp');
    expect(ch1.readings[1]).toMatchObject({ label: 'Temperature', icon: 'Thermometer' });
    // The humidity tile keeps its dew point (it skips only the MCU's temperature).
    expect(ch1.readings[2].secondary).toMatch(/^dew point/);
  });

  it('Wio-E5 self read: record 1 is the BME280, not an MCU temp', () => {
    const rs = readings(WIO_E5);
    const [ch1] = describeChannels(rs, 'companion');
    expect(ch1.caption).toBe('battery · temperature · humidity · pressure');
    expect(describeReading(rs[1], rs, 'companion').label).toBe('Temperature');
  });

  it('a remote reply has an MCU temp only as its final record', () => {
    // RP2040-style repeater: a ch 1 temperature mid-payload, sensors after it.
    const rs = readings('01 74 01 9A 01 67 00 DC 02 67 00 F6 02 68 75');
    const [ch1] = describeChannels(rs, 'repeater');
    expect(ch1.caption).toBe('battery · temperature');
    expect(describeReading(rs[1], rs, 'repeater').kind).toBe('reading');
  });
});

describe('field-set matches', () => {
  const caption = (hex: string) => describeChannels(readings(hex)).map((g) => [g.ch, g.name, g.caption]);

  it('INA3221 with three inputs: V + I + P per channel on consecutive channels', () => {
    const groups = describeChannels(readings(INA3221_FIXTURE), 'repeater');
    expect(pick(groups)).toEqual([
      { ch: 1, name: 'Self', match: null, caption: 'battery · MCU temp' },
      { ch: 2, name: 'Power', match: 'INA3221', caption: 'field set matches INA3221 · input 1 of 3' },
      { ch: 3, name: 'Power', match: 'INA3221', caption: 'field set matches INA3221 · input 2 of 3' },
      { ch: 4, name: 'Power', match: 'INA3221', caption: 'field set matches INA3221 · input 3 of 3' },
    ]);
    expect(groups.slice(1).map((g) => g.readings.map((d) => d.text))).toEqual([
      ['13.00 V', '250 mA', '3 W'],
      ['5.00 V', '−182 mA', '0 W'],
      ['12.00 V', '1.250 A', '15 W'],
    ]);
    expect(groups[1].readings.map((d) => d.label)).toEqual(['Bus voltage', 'Current', 'Power']);
    expect(groups[3].readings[2].secondary).toBe('≈ 15.00 W est. from V × I');
  });

  it('a lone INA keeps the family caption', () => {
    expect(caption('02 74 02 00 02 75 00 B6 02 80 00 01')).toEqual([
      [2, 'Power', 'field set matches INA219 / INA226 / INA260 / INA3221'],
    ]);
  });

  it('MLX90614: two adjacent lone-temperature channels, object then ambient', () => {
    const groups = describeChannels(readings('01 74 01 9A 03 67 01 3F 04 67 00 D7'));
    expect(pick(groups).slice(1)).toEqual([
      {
        ch: 3,
        name: 'Environment',
        match: 'MLX90614 (object/ambient)',
        caption: 'field set matches MLX90614 (object/ambient)',
      },
      {
        ch: 4,
        name: 'Environment',
        match: 'MLX90614 (object/ambient)',
        caption: 'field set matches MLX90614 (object/ambient)',
      },
    ]);
    expect(groups[1].readings[0]).toMatchObject({ label: 'Object temp', icon: 'Target', text: '31.9 °C' });
    expect(groups[2].readings[0]).toMatchObject({ label: 'Ambient temp', icon: 'Thermometer', text: '21.5 °C' });
  });

  it('never pairs a lone temperature with the Self channel', () => {
    // ch 0 is never used by MeshCore, but must not turn ch 1 into "Environment".
    expect(caption('00 67 01 3F 01 67 00 D7')).toEqual([
      [0, 'Sensors', ''],
      [1, 'Self', 'MCU temp'],
    ]);
  });

  it('two temperatures on one channel are not an MLX90614', () => {
    expect(caption('02 67 01 3F 02 67 00 D7')).toEqual([[2, 'Sensors', '']]);
  });

  it('a lone temperature with no neighbour falls back to Sensors', () => {
    expect(caption('02 67 01 3F 04 67 00 D7')).toEqual([
      [2, 'Sensors', ''],
      [4, 'Sensors', ''],
    ]);
  });

  it('the environment sensors', () => {
    expect(caption('02 67 00 F6 02 68 75')).toEqual([[2, 'Environment', 'field set matches AHT / SHTC3 / SHT4x']]);
    expect(caption('02 67 00 F6 02 73 27 96 02 79 00 A2')).toEqual([
      [2, 'Environment', 'field set matches BMP280 / BMP085'],
    ]);
    expect(caption('02 67 00 F6 02 73 27 96')).toEqual([[2, 'Environment', 'field set matches LPS22HB']]);
    expect(caption('02 82 00 00 03 4A')).toEqual([[2, 'Environment', 'field set matches VL53L0X']]);
  });

  it('BME680: generic is gas resistance in Ω', () => {
    const rs = readings('02 67 00 F6 02 68 75 02 73 27 96 02 79 00 A2 02 64 00 00 BC 53');
    const [g] = describeChannels(rs);
    expect(g.caption).toBe('field set matches BME680');
    expect(g.readings[4]).toMatchObject({ label: 'Gas resistance', text: `48${GROUP_SEP}211 Ω` });
  });

  it('BME680 + BSEC: generic is IAQ, analog input is the IAQ accuracy', () => {
    const rs = readings('02 67 00 F6 02 68 75 02 73 27 96 02 79 00 A2 02 64 00 00 00 32 02 02 01 2C');
    const [g] = describeChannels(rs);
    expect(g.caption).toBe('field set matches BME680 + BSEC');
    expect(g.readings[4]).toMatchObject({ label: 'IAQ', text: '50' });
    expect(g.readings[5]).toMatchObject({ label: 'IAQ accuracy', text: '3', secondary: 'accuracy 0–3' });
  });

  it('a generic sensor without a match stays generic', () => {
    const [r] = readings('02 64 00 00 00 32');
    expect(describeReading(r, [r])).toMatchObject({ label: 'Generic sensor', text: '50' });
  });

  it('RAK12035: soil moisture, and a calibration channel with its misused units suppressed', () => {
    const rs = readings('02 67 00 C8 02 78 25 03 76 00 00 04 DB 03 67 01 F4 03 80 00 64');
    const groups = describeChannels(rs);
    expect(pick(groups)).toEqual([
      { ch: 2, name: 'Environment', match: 'RAK12035', caption: 'field set matches RAK12035' },
      { ch: 3, name: 'Environment', match: 'RAK12035 calibration', caption: 'field set matches RAK12035 calibration' },
    ]);
    expect(groups[0].readings[1]).toMatchObject({ label: 'Soil moisture', text: '37%' });
    expect(groups[1].readings.map((d) => [d.label, d.text, d.unit, d.baseUnit])).toEqual([
      ['Capacitance', `1${GROUP_SEP}243`, '', ''],
      ['Wet calibration', '50.0', '', ''],
      ['Dry calibration', '100', '', ''],
    ]);
  });
});

describe('derived values', () => {
  it('dew point (Magnus) from temperature and humidity', () => {
    expect(dewPoint(24.6, 58.5)).toBeCloseTo(15.92, 2);
    expect(dewPoint(20, 0)).toBeNull();
  });

  it('humidity without a temperature on its channel has no dew point', () => {
    const rs = readings('02 68 75 03 67 00 F6');
    expect(describeReading(rs[0], rs).secondary).toBeNull();
  });

  it('power estimate ≈ V × I from the same channel', () => {
    expect(powerEstimate(readings('03 74 02 00 03 75 00 B6'))).toBeCloseTo(0.93184, 5);
    expect(powerEstimate(readings('03 74 02 00'))).toBeNull();
  });

  it('altitude without a barometer is not called barometric', () => {
    const rs = readings('02 79 00 A2');
    expect(describeReading(rs[0], rs).secondary).toBe('531 ft');
  });
});
