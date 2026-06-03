import { describe, expect, it } from 'vitest';
import {
  type ResolvedNeighbour,
  resolveNeighbourPublicKey,
  resolveNeighbours,
  sortNeighbours,
} from '../../../../src/renderer/lib/neighbours';
import type { DiscoveredContact } from '../../../../src/shared/contacts/discovered';
import type { Contact, RepeaterNeighbour } from '../../../../src/shared/types';

function contact(p: Partial<Contact> & { publicKeyHex: string }): Contact {
  return {
    key: `c:${p.publicKeyHex}`,
    name: 'C',
    kind: 'repeater',
    ...p,
  } as Contact;
}
function disc(p: Partial<DiscoveredContact> & { publicKeyHex: string }): DiscoveredContact {
  return {
    key: `c:${p.publicKeyHex}`,
    name: 'D',
    kind: 'repeater',
    firstHeardMs: 0,
    onRadio: false,
    favourite: false,
    blocked: false,
    ...p,
  } as DiscoveredContact;
}
const raw = (prefix: string, snrDb = 1, heardSecsAgo = 10): RepeaterNeighbour => ({
  pubKeyPrefixHex: prefix,
  snrDb,
  heardSecsAgo,
});

describe('resolveNeighbours', () => {
  it('marks an unmatched prefix as Unknown / off-map', () => {
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [], []);
    expect(r.name).toBe('Unknown repeater');
    expect(r.nameSource).toBe('unknown');
    expect(r.located).toBe(false);
    expect(r.ambiguous).toBe(false);
    expect(r.contactKey).toBeNull();
  });

  it('resolves a unique match with a valid fix (located)', () => {
    const c = contact({
      publicKeyHex: 'aabbccddeeff0011',
      name: 'Mt Bonnell',
      gpsLat: 30.3,
      gpsLon: -97.7,
    });
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [c], []);
    expect(r.name).toBe('Mt Bonnell');
    expect(r.nameSource).toBe('contacts');
    expect(r.located).toBe(true);
    expect(r.lat).toBe(30.3);
    expect(r.lon).toBe(-97.7);
    expect(r.contactKey).toBe('c:aabbccddeeff0011');
  });

  it('treats a 0/0 fix as no location (off-map)', () => {
    const c = contact({ publicKeyHex: 'aabbccddeeff0011', gpsLat: 0, gpsLon: 0 });
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [c], []);
    expect(r.located).toBe(false);
    expect(r.lat).toBeNull();
  });

  it('flags ambiguity and prefers a located, recently-heard match', () => {
    const a = contact({ publicKeyHex: 'aabbccddeeff1111', name: 'NoFix', lastSeenMs: 9999 });
    const b = contact({
      publicKeyHex: 'aabbccddeeff2222',
      name: 'HasFix',
      gpsLat: 1,
      gpsLon: 1,
      lastSeenMs: 1,
    });
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [a, b], []);
    expect(r.ambiguous).toBe(true);
    expect(r.name).toBe('HasFix'); // located wins over recency
    expect(r.located).toBe(true);
  });

  it('lets an on-radio contact win over a discovered duplicate of the same key', () => {
    const c = contact({ publicKeyHex: 'aabbccddeeff0011', name: 'OnRadio' });
    const d = disc({ publicKeyHex: 'aabbccddeeff0011', name: 'Discovered' });
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [c], [d]);
    expect(r.name).toBe('OnRadio');
    expect(r.ambiguous).toBe(false);
  });
});

describe('resolveNeighbourPublicKey', () => {
  it('returns the matched contact publicKeyHex for a prefix', () => {
    const c = contact({ publicKeyHex: 'aabbccddeeff0011', name: 'Mt Bonnell' });
    expect(resolveNeighbourPublicKey('aabbccddeeff', [c], [])).toBe('aabbccddeeff0011');
  });
  it('returns null for an unmatched prefix', () => {
    expect(resolveNeighbourPublicKey('zzzz', [], [])).toBeNull();
  });
});

describe('sortNeighbours', () => {
  const list: ResolvedNeighbour[] = [
    {
      ...raw('a1', 2, 100),
      name: 'Zeta',
      nameSource: 'contacts',
      contactKey: null,
      lat: null,
      lon: null,
      located: false,
      ambiguous: false,
    },
    {
      ...raw('a2', 8, 5),
      name: 'Alpha',
      nameSource: 'contacts',
      contactKey: null,
      lat: null,
      lon: null,
      located: false,
      ambiguous: false,
    },
  ];
  it('sorts strongest SNR first', () => {
    expect(sortNeighbours(list, 'snr-desc').map((n) => n.snrDb)).toEqual([8, 2]);
  });
  it('sorts most recent first (smallest heardSecsAgo)', () => {
    expect(sortNeighbours(list, 'recent').map((n) => n.heardSecsAgo)).toEqual([5, 100]);
  });
  it('sorts by name A–Z', () => {
    expect(sortNeighbours(list, 'name').map((n) => n.name)).toEqual(['Alpha', 'Zeta']);
  });
});
