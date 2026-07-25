import { describe, expect, it } from 'vitest';
import { bearingText, distanceValue, normalizeUnit, unitText } from '../../../src/shared/macros/filters';

describe('distanceValue', () => {
  it('returns metres for two valid positions', () => {
    expect(distanceValue({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111194.9, 0);
  });
  it('returns null when a position is missing/invalid', () => {
    expect(distanceValue(null, { lat: 0, lon: 1 })).toBeNull();
    expect(distanceValue({ lat: 0, lon: 0 }, { lat: 999, lon: 0 })).toBeNull();
  });
});

describe('bearingText', () => {
  it('formats degrees + compass point', () => {
    expect(bearingText({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBe('90° E');
  });
  it('returns null on invalid input', () => {
    expect(bearingText({ lat: 0, lon: 0 }, null)).toBeNull();
  });
});

describe('normalizeUnit', () => {
  it('maps metric/imperial and passthrough', () => {
    expect(normalizeUnit('metric')).toBe('km');
    expect(normalizeUnit('imperial')).toBe('mi');
    expect(normalizeUnit('km')).toBe('km');
    expect(normalizeUnit('mi')).toBe('mi');
  });
});

describe('unitText', () => {
  it('metric: sub-km shows metres, else km', () => {
    expect(unitText(0, 'km')).toBe('0 m');
    expect(unitText(999, 'km')).toBe('999 m');
    expect(unitText(1000, 'km')).toBe('1.0 km');
    expect(unitText(1500, 'km')).toBe('1.5 km');
  });
  it('imperial: sub-mile shows feet, else miles', () => {
    expect(unitText(100, 'mi')).toBe('328 ft');
    expect(unitText(1609.344, 'mi')).toBe('1.0 mi');
  });
});
