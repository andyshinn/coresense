import type { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  encodeSetAdvertLatLon,
  encodeSetAdvertName,
  encodeSetOtherParams,
} from '../../../../../src/main/protocol/features/advert';

const hex = (b: Buffer) => b.toString('hex');

describe('advert encode', () => {
  it('encodeSetAdvertName appends the UTF-8 name', () => {
    expect(hex(encodeSetAdvertName('Hand'))).toBe('0848616e64');
  });

  it('encodeSetAdvertLatLon writes signed micro-degrees', () => {
    const out = encodeSetAdvertLatLon(37.5, -122.25);
    expect(out[0]).toBe(0x0e);
    expect(out.readInt32LE(1)).toBe(37_500_000);
    expect(out.readInt32LE(5)).toBe(-122_250_000);
  });

  it('encodeSetOtherParams packs telemetry env<<4 | loc<<2 | base', () => {
    const out = encodeSetOtherParams({
      telemetryBase: 1,
      telemetryLoc: 2,
      telemetryEnv: 0,
      advertLocationPolicy: 1,
      multiAcks: 2,
    });
    // [0x26][reserved 0][(0<<4)|(2<<2)|1 = 0x09][0x01][0x02]
    expect(hex(out)).toBe('2600090102');
  });
});
