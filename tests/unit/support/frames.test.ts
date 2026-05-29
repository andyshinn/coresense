import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { frameBuf, frameHex } from '../../support/frames';

describe('fixture loader', () => {
  it('returns the hex string for a named frame', () => {
    expect(frameHex('deviceInfo')).toMatch(/^0d0baf28/);
  });

  it('returns a Buffer whose first byte is the frame code', () => {
    const buf = frameBuf('selfInfo');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x05);
  });

  it('throws on an unknown fixture name', () => {
    expect(() => frameHex('nope')).toThrow(/unknown frame fixture/i);
  });
});
