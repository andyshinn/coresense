import { describe, expect, it } from 'vitest';
import { formatHops, hashSizeFromOutPathLen, hopsFromOutPathLen } from '../../../src/shared/contacts/discovered';

// MeshCore packs the contact `out_path_len` byte as `((hashSize - 1) << 6) | hopCount`
// (firmware Packet::setPathHashSizeAndCount / getPathByteLen), NOT a raw byte
// count. 0xFF (OUT_PATH_UNKNOWN) means flood. In 2-byte mode a direct/0-hop
// contact stores 0x40 — its hop count is 0, not 64.
describe('hopsFromOutPathLen', () => {
  it('returns undefined for flood (0xFF)', () => {
    expect(hopsFromOutPathLen(0xff)).toBeUndefined();
  });
  it('returns 0 for a direct 2-byte-mode contact (0x40), not 64', () => {
    expect(hopsFromOutPathLen(0x40)).toBe(0);
  });
  it('returns 3 for a 3-hop 2-byte path (0x43), not 67', () => {
    expect(hopsFromOutPathLen(0x43)).toBe(3);
  });
  it('returns 0 for a direct 3-byte-mode contact (0x80)', () => {
    expect(hopsFromOutPathLen(0x80)).toBe(0);
  });
  it('returns 2 for a 2-hop 1-byte-mode path (0x02)', () => {
    expect(hopsFromOutPathLen(0x02)).toBe(2);
  });
});

describe('hashSizeFromOutPathLen', () => {
  it('returns undefined for flood (0xFF)', () => {
    expect(hashSizeFromOutPathLen(0xff)).toBeUndefined();
  });
  it('returns 1 for a 1-byte-mode path (0x02)', () => {
    expect(hashSizeFromOutPathLen(0x02)).toBe(1);
  });
  it('returns 2 for a 2-byte-mode path (0x43 and direct 0x40)', () => {
    expect(hashSizeFromOutPathLen(0x43)).toBe(2);
    expect(hashSizeFromOutPathLen(0x40)).toBe(2);
  });
  it('returns 3 for a 3-byte-mode path (0x83)', () => {
    expect(hashSizeFromOutPathLen(0x83)).toBe(3);
  });
  it('returns undefined for a malformed 0b11 top-pair (size 4), e.g. 0xC0/0xC3', () => {
    // Firmware only encodes hashSize 1/2/3; a 0b11 top-pair would decode to 4,
    // which is outside PathHashSize — it must not leak into hop splitting.
    expect(hashSizeFromOutPathLen(0xc0)).toBeUndefined();
    expect(hashSizeFromOutPathLen(0xc3)).toBeUndefined();
  });
});

// One formatter for every surface that renders a contact's hop state. The
// states it has to keep apart are "no learned route → the radio floods"
// (undefined), "known direct route" (0) and "N relay hops" — and none of them
// may render as blank, which is what an `hops || '—'` style check would do to 0.
describe('formatHops', () => {
  it('calls an unknown out_path what it is — the radio will flood', () => {
    expect(formatHops(undefined)).toBe('Flood');
  });
  it('renders 0 as a real value, not as missing data', () => {
    expect(formatHops(0)).toBe('0 hops');
  });
  it('singularises exactly one hop', () => {
    expect(formatHops(1)).toBe('1 hop');
  });
  it('pluralises two or more', () => {
    expect(formatHops(2)).toBe('2 hops');
  });
  it('handles the 6-bit hop-count ceiling', () => {
    expect(formatHops(63)).toBe('63 hops');
  });

  // The overrides exist for surfaces with their own established vocabulary —
  // the repeater login button mirrors meshcore_py's `effective`, where a known
  // 0-hop route reads "Direct".
  it('lets a caller override the direct wording without touching the rest', () => {
    expect(formatHops(0, { direct: 'Direct' })).toBe('Direct');
    expect(formatHops(3, { direct: 'Direct' })).toBe('3 hops');
    expect(formatHops(undefined, { direct: 'Direct' })).toBe('Flood');
  });
  it('lets a caller override the unknown wording', () => {
    expect(formatHops(undefined, { unknown: 'not measured' })).toBe('not measured');
  });
});
