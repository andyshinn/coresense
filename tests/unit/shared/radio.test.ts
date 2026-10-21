import { describe, expect, it } from 'vitest';
import { NODE_NAME_MAX_BYTES, normalizeNodeName, validateNodeName, validateTxPower } from '../../../src/shared/radio';
import { DEFAULT_RADIO_LIMITS } from '../../../src/shared/types';

describe('validateNodeName', () => {
  it('trims surrounding whitespace and returns the trimmed name', () => {
    expect(validateNodeName('  Base Camp \t')).toEqual({ ok: true, value: 'Base Camp' });
  });

  it('normalises to NFC, so a decomposed accent sends the composed form', () => {
    const nfd = 'Café'; // "e" + combining acute
    const r = validateNodeName(nfd);
    expect(r).toEqual({ ok: true, value: 'Café' });
    expect(normalizeNodeName(nfd)).toBe(normalizeNodeName('Café'));
  });

  it('counts the byte limit on the normalised string', () => {
    // 15 two-byte characters as NFD would be 45 bytes; as NFC they are 30.
    const nfd = 'é'.repeat(15);
    expect(validateNodeName(nfd).ok).toBe(true);
  });

  it('accepts exactly 31 UTF-8 bytes of multi-byte text', () => {
    // 10 three-byte characters + 1 ASCII = 31 bytes.
    const name = `${'中'.repeat(10)}x`;
    expect(new TextEncoder().encode(name).length).toBe(NODE_NAME_MAX_BYTES);
    expect(validateNodeName(name)).toEqual({ ok: true, value: name });
  });

  it('refuses 32 bytes, naming the limit and the actual size', () => {
    const name = `${'中'.repeat(10)}xy`;
    expect(validateNodeName(name)).toEqual({ ok: false, error: 'Name must be at most 31 bytes (it is 32)' });
  });

  it('refuses a name that is empty after trimming', () => {
    expect(validateNodeName('   ')).toEqual({ ok: false, error: 'Name must not be empty' });
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['newline', 'line\nbreak'],
    ['DEL', 'a\u007fb'],
    ['C1', 'a\u0085b'],
  ])('refuses a %s control character', (_label, name) => {
    expect(validateNodeName(name)).toEqual({ ok: false, error: 'Name must not contain control characters' });
  });
});

describe('validateTxPower', () => {
  const limits = { minTxPowerDbm: -9, maxTxPowerDbm: 20 };

  it('accepts the firmware minimum and the reported maximum', () => {
    expect(validateTxPower(-9, limits)).toEqual({ ok: true, value: -9 });
    expect(validateTxPower(20, limits)).toEqual({ ok: true, value: 20 });
  });

  it('refuses one below the minimum and one above the maximum', () => {
    expect(validateTxPower(-10, limits)).toEqual({ ok: false, error: 'TX power must be at least -9 dBm' });
    expect(validateTxPower(21, limits)).toEqual({ ok: false, error: 'TX power must be at most 20 dBm on this radio' });
  });

  it('refuses a fractional value', () => {
    expect(validateTxPower(10.5, limits).ok).toBe(false);
  });

  it('checks only the minimum while the maximum is unknown', () => {
    expect(validateTxPower(30, DEFAULT_RADIO_LIMITS)).toEqual({ ok: true, value: 30 });
    expect(validateTxPower(-10, DEFAULT_RADIO_LIMITS).ok).toBe(false);
  });
});
