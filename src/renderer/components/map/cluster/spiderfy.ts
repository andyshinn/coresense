import type maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';

/** Layout used when a co-located site has exactly 2 members. */
export const SPIDERFY_PAIR_LAYOUT: 'horizontal' | 'vertical' = 'vertical';

/** Distance from the anchor to each spiderfied member, in pixels. */
export const SPIDERFY_RADIUS_PX = 50;

/** Global clockwise rotation (degrees) applied to the spiderfy ring. */
export const SPIDERFY_RING_ROTATION_DEG = 40;

/** Per-member-count rotation overrides (extra degrees added on top of the global rotation). */
export const SPIDERFY_RING_ROTATION_BY_COUNT: Record<number, number> = {
  3: 0,
  4: 20,
};

/** MapLibre source id for spiderfy leader lines. */
export const SPIDERFY_LEADER_SOURCE = 'cs-spiderfy-leaders';

/** MapLibre layer id for spiderfy leader lines. */
export const SPIDERFY_LEADER_LAYER = 'cs-spiderfy-leaders-line';

/** Fill color of the small centroid dot rendered when a site is spiderfied. */
export const SPIDERFY_CENTER_COLOR = '#f59e0b';

/** Pixel size of the centroid dot SVG. */
export const SPIDERFY_CENTER_SIZE = 6;

/** Padding (px) added to the outermost offset when sizing the bounding disc. */
export const SPIDERFY_CIRCLE_PADDING_PX = 60;

/** Pixel offsets from the centroid for N spiderfied members. */
export function spiderfyOffsets(n: number): Array<{ x: number; y: number }> {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  if (n === 2) {
    if (SPIDERFY_PAIR_LAYOUT === 'horizontal') {
      return [
        { x: -SPIDERFY_RADIUS_PX, y: 0 },
        { x: SPIDERFY_RADIUS_PX, y: 0 },
      ];
    }
    return [
      { x: 0, y: -SPIDERFY_RADIUS_PX },
      { x: 0, y: SPIDERFY_RADIUS_PX },
    ];
  }
  const radius = n <= 6 ? SPIDERFY_RADIUS_PX : SPIDERFY_RADIUS_PX * 1.4;
  const rotationDeg = SPIDERFY_RING_ROTATION_DEG + (SPIDERFY_RING_ROTATION_BY_COUNT[n] ?? 0);
  const rotationRad = (rotationDeg * Math.PI) / 180;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + rotationRad;
    out.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return out;
}

/** Builds the small amber centroid dot DOM element used when spiderfying. */
export function buildSpiderCenterElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'cs-map-spider-center';
  const s = SPIDERFY_CENTER_SIZE;
  el.innerHTML = `
    <svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true">
      <circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 0.5}" fill="${SPIDERFY_CENTER_COLOR}" stroke="#0c0a06" stroke-width="0.6" />
    </svg>
  `;
  return el;
}

/** Updates the leader-line GeoJSON source with the given line features (no-op if source missing). */
export function setLeaderLines(
  map: MapLibreMap,
  features: GeoJSON.Feature<GeoJSON.LineString>[],
): void {
  const src = map.getSource(SPIDERFY_LEADER_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  src.setData({ type: 'FeatureCollection', features });
}
