import { describe, expect, it } from 'vitest';
import {
  buildClusterIndex,
  type ClusterFeatureProps,
  centroidOf,
  type GroupedItem,
  groupByColocation,
  type PointFeatureProps,
  parseSiteKey,
  siteKeyFor,
} from '../../../../../src/renderer/components/map/markers/cluster';
import type { Contact, ContactKind } from '../../../../../src/shared/types';

function contact(key: string, kind: ContactKind, gpsLat: number | undefined, gpsLon: number | undefined): Contact {
  return { key, publicKeyHex: key, name: key, kind, gpsLat, gpsLon } as Contact;
}

// ~1.1 m of latitude per 0.00001°.
const BASE = { lat: 30, lon: -97 };

describe('groupByColocation', () => {
  it('drops contacts without a valid fix', () => {
    const items = groupByColocation(
      [contact('a', 'chat', undefined, undefined), contact('b', 'chat', 0, 0), contact('c', 'chat', BASE.lat, BASE.lon)],
      10,
    );
    expect(items).toEqual([
      { kind: 'single', contact: expect.objectContaining({ key: 'c' }), lng: BASE.lon, lat: BASE.lat },
    ]);
  });

  it('never groups when the distance is 0', () => {
    const items = groupByColocation(
      [contact('a', 'chat', BASE.lat, BASE.lon), contact('b', 'repeater', BASE.lat, BASE.lon)],
      0,
    );
    expect(items.map((i) => i.kind)).toEqual(['single', 'single']);
  });

  it('groups contacts within the distance into a site keyed by sorted member keys', () => {
    const items = groupByColocation(
      [
        contact('z', 'repeater', BASE.lat, BASE.lon),
        contact('a', 'chat', BASE.lat + 0.00002, BASE.lon),
        contact('far', 'room', BASE.lat + 1, BASE.lon),
      ],
      10,
    );
    expect(items).toHaveLength(2);
    const site = items[0] as Extract<GroupedItem, { kind: 'site' }>;
    expect(site.kind).toBe('site');
    expect(site.site.key).toBe('site:a|z');
    // Members stay in input order; only the key is sorted.
    expect(site.site.members.map((m) => m.key)).toEqual(['z', 'a']);
    expect(site.site.centroid.lng).toBeCloseTo(BASE.lon, 9);
    expect(site.site.centroid.lat).toBeCloseTo(BASE.lat + 0.00001, 9);
    expect(items[1]).toMatchObject({ kind: 'single', contact: { key: 'far' } });
  });

  it('is greedy from the first unassigned contact, not transitive', () => {
    // a—b and b—c are each ~8.9 m apart, a—c ~17.8 m: with 10 m, a claims b and
    // c is left on its own even though it is within range of b.
    const items = groupByColocation(
      [
        contact('a', 'chat', BASE.lat, BASE.lon),
        contact('b', 'chat', BASE.lat + 0.00008, BASE.lon),
        contact('c', 'chat', BASE.lat + 0.00016, BASE.lon),
      ],
      10,
    );
    expect(items.map((i) => (i.kind === 'site' ? i.site.key : i.contact.key))).toEqual(['site:a|b', 'c']);
  });
});

describe('buildClusterIndex', () => {
  type Feature = GeoJSON.Feature<GeoJSON.Point, ClusterFeatureProps | PointFeatureProps>;

  it('aggregates per-kind breakdowns, counting every site member', () => {
    const items = groupByColocation(
      [
        contact('r1', 'repeater', BASE.lat, BASE.lon),
        contact('c1', 'chat', BASE.lat + 0.00002, BASE.lon),
        contact('s1', 'sensor', BASE.lat + 0.01, BASE.lon + 0.01),
        contact('m1', 'room', BASE.lat - 0.01, BASE.lon - 0.01),
      ],
      10,
    );
    expect(items).toHaveLength(3);
    const index = buildClusterIndex(items);
    const world = index.getClusters([-180, -85, 180, 85], 0) as Feature[];
    expect(world).toHaveLength(1);
    const props = world[0]?.properties as ClusterFeatureProps;
    expect(props.cluster).toBe(true);
    // Supercluster counts index points (the site is one point)…
    expect(props.point_count).toBe(3);
    // …while the breakdown counts contacts.
    expect(props.breakdown).toEqual({ chat: 1, repeater: 1, room: 1, sensor: 1 });
  });

  it('keeps fewer than three points unclustered and carries each item on its leaf', () => {
    const items = groupByColocation(
      [contact('a', 'chat', BASE.lat, BASE.lon), contact('b', 'repeater', BASE.lat + 0.01, BASE.lon)],
      10,
    );
    const leaves = buildClusterIndex(items).getClusters([-180, -85, 180, 85], 0) as Feature[];
    expect(leaves).toHaveLength(2);
    for (const f of leaves) {
      const props = f.properties as PointFeatureProps;
      expect(props.cluster).toBe(false);
      expect(items).toContain(props.item);
    }
    const breakdowns = leaves.map((f) => (f.properties as PointFeatureProps).breakdown);
    expect(breakdowns).toContainEqual({ chat: 1, repeater: 0, room: 0, sensor: 0 });
    expect(breakdowns).toContainEqual({ chat: 0, repeater: 1, room: 0, sensor: 0 });
  });
});

describe('site keys', () => {
  it('round-trips the member keys, sorted', () => {
    const key = siteKeyFor([{ key: 'c:bb' }, { key: 'c:aa' }]);
    expect(key).toBe('site:c:aa|c:bb');
    expect(parseSiteKey(key)).toEqual(['c:aa', 'c:bb']);
  });

  it('is independent of member order and does not reorder the input', () => {
    const members = [{ key: 'c:z' as const }, { key: 'c:a' as const }];
    expect(siteKeyFor(members)).toBe(siteKeyFor([...members].reverse()));
    expect(members.map((m) => m.key)).toEqual(['c:z', 'c:a']);
  });

  it('treats an unprefixed key as a bare member list', () => {
    expect(parseSiteKey('a|b')).toEqual(['a', 'b']);
  });
});

describe('centroidOf', () => {
  it('averages longitude and latitude', () => {
    expect(
      centroidOf([
        { gpsLat: 10, gpsLon: 20 },
        { gpsLat: 12, gpsLon: 26 },
      ]),
    ).toEqual({ lng: 23, lat: 11 });
  });
});
