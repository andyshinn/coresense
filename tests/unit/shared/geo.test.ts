import { describe, expect, it } from 'vitest';
import {
  compassPoint,
  haversineMeters,
  initialBearingDeg,
  isValidCoord,
  parseCoord,
  validateLatLon,
} from '../../../src/shared/geo';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
  });
  it('equals one degree of arc at the equator', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111194.9, 0);
  });
  it('handles a sub-kilometre distance', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 })).toBeCloseTo(111.19, 1);
  });
  it('handles a near-antipodal distance', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6371008.8, 0);
  });
});

describe('initialBearingDeg', () => {
  it('points north', () => expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 5));
  it('points east', () => expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 5));
  it('points south', () => expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 5));
  it('points west', () => expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 5));
});

describe('compassPoint', () => {
  it('maps cardinals and an intercardinal', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
    expect(compassPoint(247)).toBe('WSW');
    expect(compassPoint(360)).toBe('N');
  });
});

describe('parseCoord', () => {
  it('parses a plain decimal in range', () => {
    expect(parseCoord('45.52345', 'lat')).toEqual({ ok: true, value: 45.52345 });
    expect(parseCoord(' -122.6765 ', 'lon')).toEqual({ ok: true, value: -122.6765 });
  });

  it('accepts the exact boundaries', () => {
    expect(parseCoord('-90', 'lat')).toEqual({ ok: true, value: -90 });
    expect(parseCoord('90', 'lat')).toEqual({ ok: true, value: 90 });
    expect(parseCoord('-180', 'lon')).toEqual({ ok: true, value: -180 });
    expect(parseCoord('180', 'lon')).toEqual({ ok: true, value: 180 });
  });

  it('refuses values just past each boundary', () => {
    expect(parseCoord('90.00001', 'lat')).toEqual({ ok: false, error: 'Latitude must be between -90 and 90' });
    expect(parseCoord('-180.1', 'lon')).toEqual({ ok: false, error: 'Longitude must be between -180 and 180' });
  });

  it('normalises -0 to 0', () => {
    const r = parseCoord('-0', 'lat');
    expect(r).toEqual({ ok: true, value: 0 });
    expect(r.ok && Object.is(r.value, -0)).toBe(false);
  });

  it('refuses blank input', () => {
    expect(parseCoord('  ', 'lon')).toEqual({ ok: false, error: 'Longitude is required' });
  });

  it.each(['abc', '1e2', '0x10', '1,5', '12.3.4', '--1', 'Infinity'])('refuses non-decimal input %j', (text) => {
    expect(parseCoord(text, 'lat')).toEqual({ ok: false, error: 'Latitude must be a number' });
  });

  it('caps decimal places only when asked', () => {
    expect(parseCoord('1.123456', 'lat').ok).toBe(true);
    expect(parseCoord('1.123456', 'lat', { maxDecimals: 5 })).toEqual({
      ok: false,
      error: 'Latitude allows at most 5 decimal places',
    });
    expect(parseCoord('1.12345', 'lat', { maxDecimals: 5 }).ok).toBe(true);
  });
});

describe('validateLatLon', () => {
  it('defaults to at most 5 decimal places', () => {
    expect(validateLatLon('45.12345', '-122.12345')).toEqual({ ok: true, value: { lat: 45.12345, lon: -122.12345 } });
    expect(validateLatLon('45.123456', '0').ok).toBe(false);
  });

  it('reports the latitude first when both are invalid', () => {
    expect(validateLatLon('', 'x')).toEqual({ ok: false, error: 'Latitude is required' });
  });

  it('reports a bad longitude after a good latitude', () => {
    expect(validateLatLon('1', '181')).toEqual({ ok: false, error: 'Longitude must be between -180 and 180' });
  });
});

describe('isValidCoord', () => {
  it('rejects NaN and infinities', () => {
    expect(isValidCoord(Number.NaN, 'lat')).toBe(false);
    expect(isValidCoord(Number.POSITIVE_INFINITY, 'lon')).toBe(false);
    expect(isValidCoord(0, 'lat')).toBe(true);
  });
});
