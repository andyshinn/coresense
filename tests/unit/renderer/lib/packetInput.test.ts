import { describe, expect, it } from 'vitest';
import { normalizeToHex } from '../../../../src/renderer/lib/packetInput';

describe('normalizeToHex', () => {
  it('accepts spaced hex', () => {
    expect(normalizeToHex('15 01 78 2a')).toEqual({ hex: '1501782a', kind: 'hex' });
  });
  it('accepts a meshcore:// hex link', () => {
    expect(normalizeToHex('meshcore://1501782a')).toEqual({ hex: '1501782a', kind: 'uri' });
  });
  it('decodes base64', () => {
    // base64 of bytes [0x15,0x01,0x78,0x2a] = "FQF4Kg=="
    expect(normalizeToHex('FQF4Kg==')).toEqual({ hex: '1501782a', kind: 'base64' });
  });
  it('returns null for garbage', () => {
    expect(normalizeToHex('!!!')).toBeNull();
  });
  it('classifies an all-hex string as hex, never base64', () => {
    expect(normalizeToHex('deadbeef')).toEqual({ hex: 'deadbeef', kind: 'hex' });
  });
  it('returns null for a truncated (odd-length) hex paste instead of decoding garbage', () => {
    expect(normalizeToHex('2a01aabbccdd686')).toBeNull();
    expect(normalizeToHex('deadbee')).toBeNull();
  });
});
