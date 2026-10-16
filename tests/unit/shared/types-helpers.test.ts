import { describe, expect, expectTypeOf, it } from 'vitest';
import { hasValidFix } from '../../../src/shared/geo';
import { CONTACT_KINDS, type ContactKind, isPathHashSize } from '../../../src/shared/types';

describe('hasValidFix', () => {
  it('accepts an in-range, non-0/0 fix', () => {
    expect(hasValidFix({ gpsLat: 51.5, gpsLon: -0.12 })).toBe(true);
    expect(hasValidFix({ gpsLat: 0, gpsLon: 10 })).toBe(true);
    expect(hasValidFix({ gpsLat: -90, gpsLon: 180 })).toBe(true);
  });

  it('rejects missing, null, 0/0, non-finite and out-of-range coords', () => {
    expect(hasValidFix({})).toBe(false);
    expect(hasValidFix({ gpsLat: 10 })).toBe(false);
    expect(hasValidFix({ gpsLat: null, gpsLon: 10 })).toBe(false);
    expect(hasValidFix({ gpsLat: 0, gpsLon: 0 })).toBe(false);
    expect(hasValidFix({ gpsLat: Number.NaN, gpsLon: 10 })).toBe(false);
    expect(hasValidFix({ gpsLat: 91, gpsLon: 10 })).toBe(false);
    expect(hasValidFix({ gpsLat: 10, gpsLon: -180.5 })).toBe(false);
  });

  it('narrows any structural shape, keeping its other fields', () => {
    const node: { name: string; gpsLat?: number | null; gpsLon?: number | null } = { name: 'n', gpsLat: 1, gpsLon: 2 };
    if (hasValidFix(node)) {
      expectTypeOf(node.gpsLat).toEqualTypeOf<number>();
      expectTypeOf(node.name).toEqualTypeOf<string>();
    }
  });
});

describe('isPathHashSize', () => {
  it('accepts only 1, 2 and 3', () => {
    expect([0, 1, 2, 3, 4, 1.5, '1', null].map(isPathHashSize)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('CONTACT_KINDS', () => {
  it('lists every ContactKind once, in display order', () => {
    expect(CONTACT_KINDS).toEqual(['chat', 'repeater', 'room', 'sensor']);
    expectTypeOf<(typeof CONTACT_KINDS)[number]>().toEqualTypeOf<ContactKind>();
  });
});
