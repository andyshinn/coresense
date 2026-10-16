/** A WGS84 position in decimal degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6371008.8; // mean Earth radius (metres)
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance between two positions, in metres (mean Earth radius). */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lon - a.lon);
  const s = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial (forward-azimuth) bearing from `a` to `b`, in degrees 0..360 clockwise from north. */
export function initialBearingDeg(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lon - a.lon);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-wind compass label (N, NNE, ...) for a bearing in degrees; any angle is normalised. */
export function compassPoint(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return POINTS[idx];
}

/** True iff the contact carries a usable WGS84 fix: both coords present, not
 *  the 0/0 "no GPS" sentinel, and within valid lat/lon ranges. Corrupt adverts
 *  can yield out-of-range coords — treat those as no fix rather than letting
 *  them reach MapLibre, which throws on an invalid LngLat. Structural, so it
 *  narrows any `{ gpsLat, gpsLon }` shape (Contact, DiscoveredContact, …). */
export function hasValidFix<T extends { gpsLat?: number | null; gpsLon?: number | null }>(
  c: T,
): c is T & { gpsLat: number; gpsLon: number } {
  return (
    typeof c.gpsLat === 'number' &&
    typeof c.gpsLon === 'number' &&
    (c.gpsLat !== 0 || c.gpsLon !== 0) &&
    c.gpsLat >= -90 &&
    c.gpsLat <= 90 &&
    c.gpsLon >= -180 &&
    c.gpsLon <= 180
  );
}
