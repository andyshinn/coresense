import { describe, expect, it } from 'vitest';
import { compassPoint, haversineMeters, initialBearingDeg } from '../../../src/shared/macros/geo';

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
