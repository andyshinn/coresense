import { describe, expect, it } from 'vitest';
import {
  cellHops,
  formatHops,
  formatHopsCell,
  formatLastHeard,
  formatObservedHops,
  hashSizeFromOutPathLen,
  hopsCellTitle,
  hopsFromOutPathLen,
} from '../../../src/shared/contacts/discovered';

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
});

// The last-heard half of the same drift: the Contact Manager's table rendered
// "—", its list layout "never" and the contact rail "not heard yet" for one
// identical state — and the first two sit behind a layout toggle, so the word
// changed under the user on the same row.
describe('formatLastHeard', () => {
  const relative = (ms: number) => `rel(${ms})`;

  it('has one word for never-heard, whatever the surface', () => {
    expect(formatLastHeard(undefined, relative)).toBe('never');
  });
  it("defers to the caller's relative formatter when there is a value", () => {
    expect(formatLastHeard(1_750_000_000_000, relative)).toBe('rel(1750000000000)');
  });
  it('treats 0 as a real timestamp rather than an absence', () => {
    expect(formatLastHeard(0, relative)).toBe('rel(0)');
  });
});

// The inbound counterpart (#45 item 7). The hop COUNT is still formatHops —
// one vocabulary — but the absent case is a different absence and must read as
// one: "Flood" is a claim about routing, and we have no such claim to make
// about an advert nobody has asked the radio about.
describe('formatObservedHops', () => {
  it('says nobody has measured it, rather than claiming a flood route', () => {
    expect(formatObservedHops(undefined)).toBe('not measured');
    expect(formatObservedHops(undefined)).not.toBe(formatHops(undefined));
  });
  it('renders 0 as "heard direct", not as missing data', () => {
    expect(formatObservedHops(0)).toBe('0 hops');
  });
  it('shares formatHops wording for every measured value', () => {
    expect(formatObservedHops(1)).toBe('1 hop');
    expect(formatObservedHops(4)).toBe('4 hops');
  });
});

// The Contact Manager has ONE hop cell and has to choose a direction for it.
// It used to render out_path_len unconditionally, which is 0xFF ("Flood") for
// the overwhelming majority of a real pool — so a node we have a measured
// inbound hop count for still read "Flood", and the sort buried it with the
// rows that have no number at all (#45 item 7).
describe('cellHops — the value a direction-less hop cell shows', () => {
  it('prefers a measured inbound count over an unlearned outbound route', () => {
    expect(cellHops({ hops: undefined, observedHops: 2 })).toBe(2);
  });
  it('prefers the measurement even when an outbound route exists', () => {
    // Asymmetric mesh: 5 hops out, 2 hops in. The one the user heard wins.
    expect(cellHops({ hops: 5, observedHops: 2 })).toBe(2);
  });
  it('keeps a 0-hop measurement rather than falling through to the route', () => {
    expect(cellHops({ hops: 4, observedHops: 0 })).toBe(0);
  });
  it('falls back to the outbound route when nothing has been measured', () => {
    expect(cellHops({ hops: 3 })).toBe(3);
    expect(cellHops({ hops: 0 })).toBe(0);
  });
  it('is undefined only when neither direction has a value', () => {
    expect(cellHops({})).toBeUndefined();
  });
});

describe('formatHopsCell', () => {
  it('marks an inbound value so the column never swaps direction silently', () => {
    expect(formatHopsCell({ hops: undefined, observedHops: 2 })).toBe('2 hops in');
    expect(formatHopsCell({ hops: 5, observedHops: 0 })).toBe('0 hops in');
  });
  it('leaves the outbound fallback exactly as it always read', () => {
    expect(formatHopsCell({ hops: undefined })).toBe('Flood');
    expect(formatHopsCell({ hops: 1 })).toBe('1 hop');
  });
  it('names both directions on hover whichever one is showing', () => {
    expect(hopsCellTitle({ hops: undefined, observedHops: 2 })).toBe('Heard (inbound): 2 hops · Path (outbound): Flood');
    expect(hopsCellTitle({ hops: 1 })).toBe('Heard (inbound): not measured · Path (outbound): 1 hop');
  });
});
