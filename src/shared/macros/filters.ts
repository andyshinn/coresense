import type { Liquid } from 'liquidjs';
import { compassPoint, haversineMeters, initialBearingDeg, type LatLon } from './geo';
import { isPlaceholder } from './placeholder';
import type { DistanceUnit } from './types';

function asPosition(v: unknown): LatLon | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as { lat?: unknown; lon?: unknown };
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return null;
  return { lat: p.lat, lon: p.lon };
}

export function normalizeUnit(u: string): 'km' | 'mi' {
  if (u === 'imperial' || u === 'mi') return 'mi';
  return 'km';
}

export function distanceValue(a: unknown, b: unknown): number | null {
  const pa = asPosition(a);
  const pb = asPosition(b);
  if (!pa || !pb) return null;
  return haversineMeters(pa, pb);
}

export function bearingText(a: unknown, b: unknown): string | null {
  const pa = asPosition(a);
  const pb = asPosition(b);
  if (!pa || !pb) return null;
  const deg = initialBearingDeg(pa, pb);
  return `${Math.round(deg)}° ${compassPoint(deg)}`;
}

export function unitText(meters: number, unit: 'km' | 'mi'): string {
  if (unit === 'mi') {
    const miles = meters / 1609.344;
    if (miles < 1) return `${Math.round(meters * 3.28084)} ft`;
    return `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function registerMacroFilters(engine: Liquid, opts: { defaultDistanceUnit: DistanceUnit }): void {
  const def = normalizeUnit(opts.defaultDistanceUnit);

  engine.registerFilter('distance', (a: unknown, b: unknown) => {
    if (isPlaceholder(a)) return a;
    if (isPlaceholder(b)) return b;
    return distanceValue(a, b);
  });

  engine.registerFilter('bearing', (a: unknown, b: unknown) => {
    if (isPlaceholder(a)) return a;
    if (isPlaceholder(b)) return b;
    return bearingText(a, b);
  });

  engine.registerFilter('unit', (value: unknown, unitArg?: unknown) => {
    if (isPlaceholder(value)) return value;
    const meters = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(meters)) return null;
    const unit = typeof unitArg === 'string' ? normalizeUnit(unitArg) : def;
    return unitText(meters, unit);
  });
}
