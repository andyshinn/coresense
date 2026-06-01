import type { ResolvedNeighbour } from '../../lib/neighbours';
import { snrColor } from '../path/SignalBars';

export interface FocalPoint {
  lat: number;
  lon: number;
}

interface LinkProps {
  id: string;
  color: string;
  width: number;
  opacity: number;
}

// One dashed LineString per located neighbour, focal -> neighbour, with the
// paint values baked into each feature's properties so the line layer can read
// them via ['get', ...]. The active (hovered/selected) link brightens; the rest
// dim when something is active.
export function buildNeighbourLinkFeatures(
  focal: FocalPoint,
  located: ResolvedNeighbour[],
  activeId: string | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString, LinkProps> {
  const features = located
    .filter(
      (n): n is ResolvedNeighbour & { lat: number; lon: number } => n.lat != null && n.lon != null,
    )
    .map((n) => {
      const isActive = activeId === n.pubKeyPrefixHex;
      const dim = activeId != null && !isActive;
      return {
        type: 'Feature' as const,
        properties: {
          id: n.pubKeyPrefixHex,
          color: snrColor(n.snrDb),
          width: isActive ? 2.4 : 1.4,
          opacity: dim ? 0.16 : isActive ? 0.95 : 0.5,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [focal.lon, focal.lat],
            [n.lon, n.lat],
          ],
        },
      };
    });
  return { type: 'FeatureCollection', features };
}

// Bounds [[west,south],[east,north]] enclosing the focal point + all located
// neighbours, or null if there is nothing to frame.
export function computeNeighbourBounds(
  focal: FocalPoint | null,
  located: ResolvedNeighbour[],
): [[number, number], [number, number]] | null {
  const pts: Array<[number, number]> = [];
  if (focal) pts.push([focal.lon, focal.lat]);
  for (const n of located) {
    if (n.lat != null && n.lon != null) pts.push([n.lon, n.lat]);
  }
  const first = pts[0];
  if (!first) return null;
  let [west, south] = first;
  let [east, north] = first;
  for (const [lng, lat] of pts) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [
    [west, south],
    [east, north],
  ];
}
