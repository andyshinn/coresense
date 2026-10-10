import { describe, expect, it } from 'vitest';
import {
  SPIDERFY_PAIR_LAYOUT,
  SPIDERFY_RADIUS_PX,
  spiderfyOffsets,
} from '../../../../../src/renderer/components/map/cluster/spiderfy';

const dist = (o: { x: number; y: number }) => Math.hypot(o.x, o.y);

describe('spiderfyOffsets', () => {
  it('returns nothing for zero members and the anchor itself for one', () => {
    expect(spiderfyOffsets(0)).toEqual([]);
    expect(spiderfyOffsets(-1)).toEqual([]);
    expect(spiderfyOffsets(1)).toEqual([{ x: 0, y: 0 }]);
  });

  it('places a pair on opposite sides of the anchor along the configured axis', () => {
    const [a, b] = spiderfyOffsets(2);
    if (SPIDERFY_PAIR_LAYOUT === 'vertical') {
      expect(a).toEqual({ x: 0, y: -SPIDERFY_RADIUS_PX });
      expect(b).toEqual({ x: 0, y: SPIDERFY_RADIUS_PX });
    } else {
      expect(a).toEqual({ x: -SPIDERFY_RADIUS_PX, y: 0 });
      expect(b).toEqual({ x: SPIDERFY_RADIUS_PX, y: 0 });
    }
  });

  it.each([3, 4, 5, 6])('puts %i members evenly on a ring at the base radius', (n) => {
    const offsets = spiderfyOffsets(n);
    expect(offsets).toHaveLength(n);
    for (const o of offsets) expect(dist(o)).toBeCloseTo(SPIDERFY_RADIUS_PX, 9);
    // Neighbouring members are all the same chord apart.
    const chord = 2 * SPIDERFY_RADIUS_PX * Math.sin(Math.PI / n);
    for (let i = 0; i < n; i++) {
      const a = offsets[i];
      const b = offsets[(i + 1) % n];
      if (!a || !b) throw new Error('missing offset');
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(chord, 9);
    }
  });

  it('widens the ring past six members', () => {
    for (const o of spiderfyOffsets(7)) expect(dist(o)).toBeCloseTo(SPIDERFY_RADIUS_PX * 1.4, 9);
  });
});
