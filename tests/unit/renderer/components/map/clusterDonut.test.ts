import { describe, expect, it } from 'vitest';
import { donutMarkup } from '../../../../../src/renderer/components/map/markers/clusterDonut';
import { MARKER_TYPES } from '../../../../../src/renderer/components/map/markers/MarkerShape';

const paths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"[^>]*\/>/g)];

describe('donutMarkup', () => {
  it('draws one arc per non-empty kind, in kind order, and centres the total', () => {
    const svg = donutMarkup({ breakdown: { chat: 2, repeater: 0, room: 1, sensor: 1 }, total: 4 });
    expect(paths(svg).map((m) => m[2])).toEqual([
      MARKER_TYPES.chat.color,
      MARKER_TYPES.room.color,
      MARKER_TYPES.sensor.color,
    ]);
    expect(svg).toMatch(/>4<\/text>/);
  });

  it('sets the large-arc flag only on an arc spanning more than half the ring', () => {
    const svg = donutMarkup({ breakdown: { chat: 3, repeater: 1, room: 0, sensor: 0 }, total: 4 });
    const [chat, repeater] = paths(svg).map((m) => m[1]);
    // `A rx ry rotation large sweep x y` — the outer arc is the first A.
    const largeFlag = (d: string | undefined) => d?.match(/A \S+ \S+ 0 (\d) 1/)?.[1];
    expect(largeFlag(chat)).toBe('1');
    expect(largeFlag(repeater)).toBe('0');
  });

  it('draws a single-kind cluster as a full even-odd ring instead of a collapsed arc', () => {
    const svg = donutMarkup({ breakdown: { chat: 0, repeater: 5, room: 0, sensor: 0 }, total: 5, size: 44 });
    const arcs = paths(svg);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.[2]).toBe(MARKER_TYPES.repeater.color);
    expect(svg).toContain('fill-rule="evenodd"');
    // Outer ring from x=1 to x=43 (r=21), inner from x=7 to x=37 (r=15).
    expect(arcs[0]?.[1]).toContain('M 1 22 A 21 21 0 1 1 43 22');
    expect(arcs[0]?.[1]).toContain('M 7 22 A 15 15 0 1 0 37 22');
  });

  it('draws no arcs for an empty breakdown and uses the smaller font below 40px', () => {
    const svg = donutMarkup({ breakdown: { chat: 0, repeater: 0, room: 0, sensor: 0 }, total: 0, size: 32 });
    expect(paths(svg)).toHaveLength(0);
    expect(svg).toContain('font-size="11"');
  });
});
