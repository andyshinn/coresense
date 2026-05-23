import Supercluster from 'supercluster';
import { type Contact, type ContactKind, hasValidFix } from '../../../../shared/types';

export interface ContactPoint {
  contact: Contact;
}

export interface SiteGroup {
  // Stable key built from sorted member contact keys so the same physical
  // group has the same id across re-renders (and so the right rail can
  // remember which site is selected even when the source list re-orders).
  key: string;
  centroid: { lng: number; lat: number };
  members: Contact[];
}

export type GroupedItem =
  | { kind: 'single'; contact: Contact; lng: number; lat: number }
  | { kind: 'site'; site: SiteGroup };

export interface ClusterFeatureProps {
  cluster: true;
  cluster_id: number;
  point_count: number;
  // Per-type counts aggregated through Supercluster's `map`/`reduce` so the
  // donut can render arc breakdowns without re-walking the source list.
  breakdown: TypeBreakdown;
}

export interface PointFeatureProps {
  cluster: false;
  item: GroupedItem;
  // Breakdown for a leaf is just its own contribution — keeps the reducer
  // type-uniform and lets us compute the legend totals from the same source.
  breakdown: TypeBreakdown;
}

export type TypeBreakdown = Record<ContactKind, number>;

const EARTH_RADIUS_M = 6_371_008.8;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Greedy co-location grouping. O(n²) in worst case but n is the number of
// contacts with a valid fix — currently small enough that the simplicity wins.
// Returns each contact wrapped as either a single point or a site group.
export function groupByColocation(contacts: Contact[], meters: number): GroupedItem[] {
  const sources = contacts.filter(hasValidFix);
  const assigned = new Set<string>();
  const out: GroupedItem[] = [];

  for (const c of sources) {
    if (assigned.has(c.key)) continue;
    const members: Contact[] = [c];
    assigned.add(c.key);
    if (meters > 0) {
      for (const other of sources) {
        if (assigned.has(other.key)) continue;
        const d = haversineMeters(
          { lat: c.gpsLat, lng: c.gpsLon },
          { lat: other.gpsLat, lng: other.gpsLon },
        );
        if (d <= meters) {
          members.push(other);
          assigned.add(other.key);
        }
      }
    }
    if (members.length === 1) {
      out.push({ kind: 'single', contact: c, lng: c.gpsLon, lat: c.gpsLat });
    } else {
      // Centroid of the site is the simple lng/lat average — good enough at
      // the 10m scale this groups within.
      const lng = members.reduce((s, m) => s + (m.gpsLon ?? 0), 0) / members.length;
      const lat = members.reduce((s, m) => s + (m.gpsLat ?? 0), 0) / members.length;
      const key = `site:${[...members.map((m) => m.key)].sort().join('|')}`;
      out.push({ kind: 'site', site: { key, centroid: { lng, lat }, members } });
    }
  }
  return out;
}

function emptyBreakdown(): TypeBreakdown {
  return { chat: 0, repeater: 0, room: 0, sensor: 0 };
}

// Build a Supercluster index from grouped items. Each grouped item becomes one
// point in the index; the per-point breakdown counts every member contact so a
// cluster's aggregate breakdown matches a flat enumeration of contacts.
export function buildClusterIndex(
  items: GroupedItem[],
): Supercluster<PointFeatureProps, ClusterFeatureProps> {
  const features: GeoJSON.Feature<GeoJSON.Point, PointFeatureProps>[] = items.map((item) => {
    const breakdown = emptyBreakdown();
    if (item.kind === 'single') {
      breakdown[item.contact.kind] = 1;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
        properties: { cluster: false, item, breakdown },
      };
    }
    for (const m of item.site.members) breakdown[m.kind] += 1;
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [item.site.centroid.lng, item.site.centroid.lat],
      },
      properties: { cluster: false, item, breakdown },
    };
  });

  const index = new Supercluster<PointFeatureProps, ClusterFeatureProps>({
    radius: 60,
    maxZoom: 18,
    minPoints: 3,
    // Properties carried per-leaf — only the breakdown participates in cluster
    // aggregation. `item` is preserved on leaves but not collapsed into the
    // cluster.
    map: (props) => ({
      cluster: true,
      cluster_id: 0, // overwritten by Supercluster on creation
      point_count: 1,
      breakdown: { ...props.breakdown },
    }),
    reduce: (accumulated, props) => {
      for (const k of Object.keys(props.breakdown) as ContactKind[]) {
        accumulated.breakdown[k] += props.breakdown[k];
      }
    },
  });
  index.load(features);
  return index;
}

export function totalsByKind(items: GroupedItem[]): TypeBreakdown {
  const out = emptyBreakdown();
  for (const item of items) {
    if (item.kind === 'single') out[item.contact.kind] += 1;
    else for (const m of item.site.members) out[m.kind] += 1;
  }
  return out;
}
