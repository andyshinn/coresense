import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeExportedPrivateKey,
  encodeExportPrivateKey,
  encodeFactoryReset,
  encodeImportPrivateKey,
  encodeSetDevicePin,
} from '../../../../../src/main/protocol/features/deviceAdmin';

const hex = (b: Buffer) => b.toString('hex');
const KEY = 'ab'.repeat(64); // 64-byte ed25519 expanded private key

describe('deviceAdmin: encodeExportPrivateKey', () => {
  it('is the bare opcode', () => {
    expect(hex(encodeExportPrivateKey())).toBe('17');
  });
});

describe('deviceAdmin: encodeImportPrivateKey', () => {
  it('is [0x18][64B prv_key]', () => {
    expect(hex(encodeImportPrivateKey(KEY))).toBe(`18${KEY}`);
  });

  it('rejects a key that is not exactly 64 bytes', () => {
    expect(() => encodeImportPrivateKey('aabb')).toThrow(/64/);
    expect(() => encodeImportPrivateKey('ab'.repeat(32))).toThrow(/64/);
  });
});

describe('deviceAdmin: decodeExportedPrivateKey', () => {
  it('reads the 64-byte private key, or null when short', () => {
    const frame = Buffer.concat([Buffer.from([0x0e]), Buffer.from(KEY, 'hex')]);
    expect(decodeExportedPrivateKey(frame)).toBe(KEY);
    expect(decodeExportedPrivateKey(Buffer.from([0x0e]))).toBeNull();
    // 1 + 63 bytes is one short of a full key.
    expect(decodeExportedPrivateKey(Buffer.alloc(64))).toBeNull();
  });
});

describe('deviceAdmin: encodeSetDevicePin', () => {
  it('is [0x25][pin u32 LE]', () => {
    expect(hex(encodeSetDevicePin(123456))).toBe('2540e20100');
  });

  it('accepts 0 to disable the PIN', () => {
    expect(hex(encodeSetDevicePin(0))).toBe('2500000000');
  });

  it('rejects a non-zero PIN outside the 6-digit range', () => {
    expect(() => encodeSetDevicePin(99999)).toThrow(/6-digit/);
    expect(() => encodeSetDevicePin(1000000)).toThrow(/6-digit/);
  });
});

describe('deviceAdmin: encodeFactoryReset', () => {
  it('is [0x33] followed by the literal "reset" bytes', () => {
    expect(hex(encodeFactoryReset())).toBe('337265736574'); // 0x33 + "reset"
  });

  it('encodes exactly 6 bytes ending in "reset"', () => {
    const out = encodeFactoryReset();
    expect(out.length).toBe(6);
    expect(out[0]).toBe(0x33);
    expect(out.subarray(1).toString('ascii')).toBe('reset');
  });
});
