import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '../../../src/shared/hex';
import { clamp, clampFiniteInt } from '../../../src/shared/math';
import { abbreviatePubkey } from '../../../src/shared/pubkey';
import { DAY_MS, HOUR_MS, MINUTE_MS, WEEK_MS } from '../../../src/shared/time';

describe('hexToBytes', () => {
  it('decodes hex pairs', () => expect(hexToBytes('00ff7A')).toEqual([0, 255, 122]));
  it('strips separators and drops a trailing odd nibble', () => {
    expect(hexToBytes('de:ad be-ef')).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(hexToBytes('abc')).toEqual([0xab]);
    expect(hexToBytes('')).toEqual([]);
  });
});

describe('bytesToHex', () => {
  it('encodes lowercase, padded', () => expect(bytesToHex([0, 15, 255])).toBe('000fff'));
  it('uses slice semantics and clamps end to the length', () => {
    const b = Uint8Array.of(1, 2, 3, 4);
    expect(bytesToHex(b, 1, 3)).toBe('0203');
    expect(bytesToHex(b, 2, 99)).toBe('0304');
    expect(bytesToHex(b, 3, 3)).toBe('');
  });
  it('covers an inclusive [a, z] range via end = z + 1', () => {
    expect(bytesToHex([0xde, 0xad, 0xbe, 0xef], 1, 2 + 1).toUpperCase()).toBe('ADBE');
  });
  it('round-trips with hexToBytes', () => expect(bytesToHex(hexToBytes('a1b2c3'))).toBe('a1b2c3'));
});

describe('time units', () => {
  it('nest correctly', () => {
    expect(MINUTE_MS).toBe(60_000);
    expect(HOUR_MS).toBe(3_600_000);
    expect(DAY_MS).toBe(86_400_000);
    expect(WEEK_MS).toBe(604_800_000);
  });
});

describe('clamp', () => {
  it('limits to the inclusive range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(2.5, 0, 10)).toBe(2.5);
  });
});

describe('clampFiniteInt', () => {
  it('floors and clamps finite numbers', () => {
    expect(clampFiniteInt(7.9, 1, 10, 5)).toBe(7);
    expect(clampFiniteInt(99, 1, 10, 5)).toBe(10);
    expect(clampFiniteInt(-3, 1, 10, 5)).toBe(1);
  });
  it('uses the fallback for non-finite or non-numeric input', () => {
    expect(clampFiniteInt(Number.NaN, 1, 10, 5)).toBe(5);
    expect(clampFiniteInt(Number.POSITIVE_INFINITY, 1, 10, 5)).toBe(5);
    expect(clampFiniteInt('8', 1, 10, 5)).toBe(5);
    expect(clampFiniteInt(null, 1, 10, 5)).toBe(5);
    expect(clampFiniteInt(undefined, 1, 10, 5)).toBe(5);
  });
});

describe('abbreviatePubkey', () => {
  const pk = '0123456789abcdef0123456789abcdef';
  it('defaults to 6…4', () => expect(abbreviatePubkey(pk)).toBe('012345…cdef'));
  it('takes custom head/tail widths', () => {
    expect(abbreviatePubkey(pk, { head: 8, tail: 8 })).toBe('01234567…89abcdef');
    expect(abbreviatePubkey(pk, { head: 8, tail: 0 })).toBe('01234567…');
  });
  it('returns keys within two chars of the abbreviation whole', () => {
    expect(abbreviatePubkey('0123456789ab')).toBe('0123456789ab');
    expect(abbreviatePubkey('0123456789abc')).toBe('012345…9abc');
  });
});
