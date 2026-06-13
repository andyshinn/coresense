import { describe, expect, it } from 'vitest';
import {
  buildNeighbourLinkFeatures,
  computeNeighbourBounds,
} from '../../../../../src/renderer/components/map/neighbourLinks';
import type { ResolvedNeighbour } from '../../../../../src/renderer/lib/neighbours';

const focal = { lat: 30, lon: -97 };
function n(p: Partial<ResolvedNeighbour> & { pubKeyPrefixHex: string }): ResolvedNeighbour {
  return {
    heardSecsAgo: 1,
    snrDb: 1,
    name: 'n',
    nameSource: 'contacts',
    contactKey: null,
    lat: null,
    lon: null,
    located: false,
    ambiguous: false,
    ...p,
  };
}

describe('buildNeighbourLinkFeatures', () => {
  it('emits one feature per located neighbour, focal -> neighbour', () => {
    const located = [n({ pubKeyPrefixHex: 'a', lat: 31, lon: -96, located: true, snrDb: 8 })];
    const fc = buildNeighbourLinkFeatures(focal, located, null);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([
      [-97, 30],
      [-96, 31],
    ]);
    expect(fc.features[0].properties).toMatchObject({ id: 'a', color: '#84cc16', opacity: 0.5 });
  });

  it('skips neighbours without coordinates', () => {
    const fc = buildNeighbourLinkFeatures(focal, [n({ pubKeyPrefixHex: 'a', located: true })], null);
    expect(fc.features).toHaveLength(0);
  });

  it('brightens the active link and dims the rest', () => {
    const located = [
      n({ pubKeyPrefixHex: 'a', lat: 31, lon: -96, located: true }),
      n({ pubKeyPrefixHex: 'b', lat: 29, lon: -98, located: true }),
    ];
    const fc = buildNeighbourLinkFeatures(focal, located, 'a');
    const a = fc.features.find((f) => f.properties.id === 'a');
    const b = fc.features.find((f) => f.properties.id === 'b');
    expect(a?.properties.opacity).toBe(0.95);
    expect(a?.properties.width).toBe(2.4);
    expect(b?.properties.opacity).toBe(0.16);
  });
});

describe('computeNeighbourBounds', () => {
  it('encloses focal + located neighbours', () => {
    const located = [
      n({ pubKeyPrefixHex: 'a', lat: 31, lon: -96, located: true }),
      n({ pubKeyPrefixHex: 'b', lat: 29, lon: -98, located: true }),
    ];
    expect(computeNeighbourBounds(focal, located)).toEqual([
      [-98, 29],
      [-96, 31],
    ]);
  });
  it('returns the single focal point when no neighbours are located', () => {
    expect(computeNeighbourBounds(focal, [])).toEqual([
      [-97, 30],
      [-97, 30],
    ]);
  });
  it('returns null when there is nothing to frame', () => {
    expect(computeNeighbourBounds(null, [])).toBeNull();
  });
});
