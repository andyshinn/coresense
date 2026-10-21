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

export type CoordAxis = 'lat' | 'lon';

const AXIS: Record<CoordAxis, { label: string; limit: number }> = {
  lat: { label: 'Latitude', limit: 90 },
  lon: { label: 'Longitude', limit: 180 },
};

/** A parsed coordinate, or why it was refused. */
export type CoordResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** True iff `value` is a finite coordinate inside its axis range. The same
 *  range firmware enforces on CMD_SET_ADVERT_LATLON (companion_radio
 *  MyMesh.cpp), so anything this accepts the radio does too. */
export function isValidCoord(value: number, axis: CoordAxis): boolean {
  return Number.isFinite(value) && Math.abs(value) <= AXIS[axis].limit;
}

// A plain decimal: optional sign, digits, optional fraction. No exponent, no
// hex, no thousands separators — Number() would accept some of those.
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Parse a coordinate typed by the user. `maxDecimals` caps the fraction
 *  digits: My Node edits 5 (about a metre); the radio itself keeps 6. */
export function parseCoord(text: string, axis: CoordAxis, opts: { maxDecimals?: number } = {}): CoordResult<number> {
  const { label, limit } = AXIS[axis];
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: `${label} is required` };
  if (!DECIMAL.test(trimmed)) return { ok: false, error: `${label} must be a number` };
  const fraction = trimmed.split('.')[1] ?? '';
  if (opts.maxDecimals !== undefined && fraction.length > opts.maxDecimals) {
    return { ok: false, error: `${label} allows at most ${opts.maxDecimals} decimal places` };
  }
  const value = Number(trimmed);
  if (!isValidCoord(value, axis)) return { ok: false, error: `${label} must be between -${limit} and ${limit}` };
  // Normalise -0 so "-0" and "0" compare equal against a saved position.
  return { ok: true, value: value === 0 ? 0 : value };
}

/** My Node's position fields: both required, at most 5 decimal places unless
 *  the caller says otherwise. */
export function validateLatLon(
  latText: string,
  lonText: string,
  opts: { maxDecimals?: number } = { maxDecimals: 5 },
): CoordResult<LatLon> {
  const lat = parseCoord(latText, 'lat', opts);
  if (!lat.ok) return lat;
  const lon = parseCoord(lonText, 'lon', opts);
  if (!lon.ok) return lon;
  return { ok: true, value: { lat: lat.value, lon: lon.value } };
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
