import type { TypeBreakdown } from './cluster';
import { MARKER_KIND_ORDER, MARKER_TYPES } from './MarkerShape';

interface DonutArgs {
  breakdown: TypeBreakdown;
  total: number;
  size?: number;
}

// SVG markup for the cluster donut — arcs sized by per-type counts with the
// total centered. Used both as inner-HTML for the map's cluster <button> and
// by the React preview component below.
export function donutMarkup({ breakdown, total, size = 44 }: DonutArgs): string {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1;
  const innerR = size / 2 - 7;
  const sum = MARKER_KIND_ORDER.reduce((s, k) => s + (breakdown[k] || 0), 0) || 1;

  let acc = 0;
  const arcs = MARKER_KIND_ORDER.map((kind) => {
    const v = breakdown[kind] || 0;
    if (!v) return '';
    const start = (acc / sum) * Math.PI * 2 - Math.PI / 2;
    acc += v;
    const end = (acc / sum) * Math.PI * 2 - Math.PI / 2;
    // Half-circle and larger needs the SVG large-arc flag — also handles the
    // common single-type cluster (one full ring).
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + outerR * Math.cos(start);
    const y1 = cy + outerR * Math.sin(start);
    const x2 = cx + outerR * Math.cos(end);
    const y2 = cy + outerR * Math.sin(end);
    const x3 = cx + innerR * Math.cos(end);
    const y3 = cy + innerR * Math.sin(end);
    const x4 = cx + innerR * Math.cos(start);
    const y4 = cy + innerR * Math.sin(start);
    // A single-type cluster degenerates to a full circle; emit a path that
    // wraps the full ring instead of M..A..L..A..Z which collapses to nothing
    // when start == end.
    if (sum === v) {
      return `<path d="M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy} M ${cx - innerR} ${cy} A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy} A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy} Z" fill="${MARKER_TYPES[kind].color}" opacity="0.95" fill-rule="evenodd" />`;
    }
    return `<path d="M ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4} Z" fill="${MARKER_TYPES[kind].color}" opacity="0.95" />`;
  }).join('');

  const fs = size > 40 ? 13 : 11;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#13110b" stroke="#2a2419" stroke-width="0.5" />
      ${arcs}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="${fs}" font-weight="700" fill="#f5f1e6">${total}</text>
    </svg>
  `;
}

// Build the imperative DOM element for a cluster donut marker. The map's
// MapClusters layer mounts this via `maplibregl.Marker`.
export function buildClusterMarker(
  clusterId: number,
  breakdown: TypeBreakdown,
  total: number,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-map-cluster';
  btn.setAttribute('aria-label', `Cluster of ${total} nodes`);
  btn.dataset.clusterId = String(clusterId);
  btn.innerHTML = donutMarkup({ breakdown, total });
  return btn;
}
