import { describe, expect, it } from 'vitest';
import { bytesToHex, decodeLpp, hexToBytes, LPP_TYPES, lppType } from '../../../../src/shared/telemetry/lpp';
import { bytes, PLAN_FIXTURE } from './fixtures';

describe('LPP_TYPES registry', () => {
  it('covers the 17 PLAN types with the CayenneLPP 1.6.1 sizes', () => {
    const sizes = Object.fromEntries(Object.values(LPP_TYPES).map((t) => [t.id, t.len]));
    expect(sizes).toEqual({
      0: 1,
      2: 2,
      100: 4,
      101: 2,
      103: 2,
      104: 1,
      115: 2,
      116: 2,
      117: 2,
      118: 4,
      120: 1,
      121: 2,
      125: 2,
      128: 2,
      130: 4,
      136: 9,
      142: 1,
    });
  });

  it('marks voltage and current signed (getTypeSigned), unlike the header comments', () => {
    expect(lppType(116)?.signed).toBe(true);
    expect(lppType(117)?.signed).toBe(true);
    const signed = Object.values(LPP_TYPES)
      .filter((t) => t.signed)
      .map((t) => t.id);
    expect(signed).toEqual([2, 103, 116, 117, 121, 136]);
  });

  it('derives display decimals from the step', () => {
    expect(lppType(104)).toMatchObject({ step: 0.5, decimals: 1 });
    expect(lppType(116)).toMatchObject({ step: 0.01, decimals: 2 });
    expect(lppType(117)).toMatchObject({ step: 0.001, decimals: 3 });
    expect(lppType(128)).toMatchObject({ step: 1, decimals: 0 });
  });

  it('returns undefined for an unknown id', () => {
    expect(lppType(250)).toBeUndefined();
  });
});

describe('decodeLpp', () => {
  it('decodes the PLAN fixture exactly (42 bytes, 9 readings)', () => {
    const raw = bytes(PLAN_FIXTURE);
    expect(raw.length).toBe(42);
    const { readings, rest } = decodeLpp(raw);
    expect(rest.length).toBe(0);
    expect(readings).toEqual([
      { ch: 1, typeId: 116, offset: 0, len: 4, value: 4.25 },
      { ch: 1, typeId: 136, offset: 4, len: 11, value: { lat: 30.2114, lon: -97.7622, alt: 168.4 } },
      { ch: 2, typeId: 103, offset: 15, len: 4, value: 24.6 },
      { ch: 2, typeId: 104, offset: 19, len: 3, value: 58.5 },
      { ch: 2, typeId: 115, offset: 22, len: 4, value: 1013.4 },
      { ch: 2, typeId: 121, offset: 26, len: 4, value: 162 },
      { ch: 3, typeId: 116, offset: 30, len: 4, value: 5.12 },
      { ch: 3, typeId: 117, offset: 34, len: 4, value: 0.182 },
      { ch: 3, typeId: 128, offset: 38, len: 4, value: 1 },
    ]);
  });

  it('treats the AES zero padding of a mesh reply as padding (fixture + 2 zero bytes)', () => {
    const { readings, rest } = decodeLpp(bytes(`${PLAN_FIXTURE} 00 00`));
    expect(readings).toHaveLength(9);
    expect(rest.length).toBe(0);
  });

  it('stops on up to 15 bytes of padding without inventing ch 0 digital inputs', () => {
    const { readings, rest } = decodeLpp(bytes(`01 74 01 A9 ${'00 '.repeat(15)}`));
    expect(readings).toHaveLength(1);
    expect(rest.length).toBe(0);
  });

  it('keeps a final value that legitimately ends in 00', () => {
    // altitude 0 m, then VL53L0X out of range (distance 0).
    const { readings, rest } = decodeLpp(bytes('02 79 00 00 03 82 00 00 00 00'));
    expect(readings.map((r) => [r.typeId, r.value])).toEqual([
      [121, 0],
      [130, 0],
    ]);
    expect(rest.length).toBe(0);
  });

  it('decodes a negative temperature (0xFF38 → −20.0 °C)', () => {
    expect(decodeLpp(bytes('02 67 FF 38')).readings[0].value).toBe(-20);
  });

  it('decodes negative longitude and altitude as signed int24', () => {
    const gps = decodeLpp(bytes('01 88 FB 63 DE F1 15 2A FF FF 9C')).readings[0].value;
    expect(gps).toEqual({ lat: -30.2114, lon: -97.7622, alt: -1 });
  });

  it('decodes voltage and current as signed int16', () => {
    const { readings } = decodeLpp(bytes('02 74 FF FF 02 75 FF 4A'));
    expect(readings.map((r) => r.value)).toEqual([-0.01, -0.182]);
  });

  it('stops at an unknown type id mid-payload, keeping earlier readings and the tail in rest', () => {
    const { readings, rest } = decodeLpp(bytes('01 74 01 A9 02 FE 01 02 02 67 00 F6'));
    expect(readings).toHaveLength(1);
    expect(bytesToHex(rest)).toBe('02fe0102026700f6');
  });

  it('stops at a truncated final reading', () => {
    const { readings, rest } = decodeLpp(bytes('01 74 01 A9 02 67 00'));
    expect(readings).toHaveLength(1);
    expect(bytesToHex(rest)).toBe('026700');
  });

  it('puts a lone trailing channel byte in rest', () => {
    const { readings, rest } = decodeLpp(bytes('01 74 01 A9 05'));
    expect(readings).toHaveLength(1);
    expect(bytesToHex(rest)).toBe('05');
  });

  it('returns nothing for an empty payload', () => {
    const { readings, rest } = decodeLpp(new Uint8Array(0));
    expect(readings).toEqual([]);
    expect(rest.length).toBe(0);
  });

  it('never throws on junk', () => {
    expect(() => decodeLpp(null as unknown as Uint8Array)).not.toThrow();
    for (let seed = 0; seed < 200; seed += 1) {
      const junk = Uint8Array.from({ length: seed % 40 }, (_, i) => (seed * 31 + i * 17) & 0xff);
      expect(() => decodeLpp(junk)).not.toThrow();
    }
  });

  it('returns rest as a copy, not a view of the input', () => {
    const raw = bytes('01 74 01 A9 02 FE');
    const { rest } = decodeLpp(raw);
    raw[4] = 0x09;
    expect(rest[0]).toBe(0x02);
  });

  it('returns rest as a plain copy when given a Node Buffer (whose slice() is a view)', () => {
    const raw = Buffer.from(bytes('01 74 01 A9 02 FE'));
    const { rest } = decodeLpp(raw);
    raw[4] = 0x09;
    expect(rest[0]).toBe(0x02);
    expect(Buffer.isBuffer(rest)).toBe(false);
    expect(rest.buffer).not.toBe(raw.buffer);
  });

  it('decodes the types MeshCore does not emit', () => {
    const { readings } = decodeLpp(bytes('05 00 01 05 65 01 F4 05 7D 01 90 05 8E 01 05 76 00 00 04 DB 05 78 25'));
    expect(readings.map((r) => [r.typeId, r.value])).toEqual([
      [0, 1],
      [101, 500],
      [125, 400],
      [142, 1],
      [118, 1243],
      [120, 37],
    ]);
  });
});

describe('hex helpers', () => {
  it('round-trips and rejects odd or non-hex input', () => {
    expect(bytesToHex(hexToBytes('01A9ff') as Uint8Array)).toBe('01a9ff');
    expect(hexToBytes('abc')).toBeNull();
    expect(hexToBytes('zz')).toBeNull();
    expect(hexToBytes('')).toEqual(new Uint8Array(0));
  });
});
