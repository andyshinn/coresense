import { createElement } from 'react';
import type { ContactKind } from '../../../../shared/types';

// Type → shape + color mapping. Shape carries the signal so the encoding still
// works for colorblind users and at zoom-out where colors compress.
//
// `chat` is the data-layer name for what users call "User" — the display label
// here is the human term ("User"/"Users"); the data type stays `chat`.
export interface MarkerTypeMeta {
  shape: 'circle' | 'square' | 'diamond' | 'triangle';
  color: string;
  label: string;
  plural: string;
}

export const MARKER_TYPES: Record<ContactKind, MarkerTypeMeta> = {
  chat: { shape: 'circle', color: '#f59e0b', label: 'User', plural: 'Users' },
  repeater: { shape: 'square', color: '#84cc16', label: 'Repeater', plural: 'Repeaters' },
  room: { shape: 'diamond', color: '#c084fc', label: 'Room Server', plural: 'Room Servers' },
  sensor: { shape: 'triangle', color: '#38bdf8', label: 'Sensor', plural: 'Sensors' },
};

export const MARKER_KIND_ORDER: ContactKind[] = ['chat', 'repeater', 'room', 'sensor'];

interface ShapeArgs {
  type: ContactKind;
  size?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  dashed?: boolean;
}

const DEFAULT_SIZE = 18;

type ShapeAttrs = Record<string, string | number>;

// Single source of the marker geometry: the SVG element and its attributes
// (SVG names, in output order) for the requested type. shapeMarkup() and
// <MarkerShape> only serialise it, so the map markers and the React badges
// can't drift apart.
function shapeGeometry(args: ShapeArgs): { tag: 'circle' | 'rect' | 'polygon'; attrs: ShapeAttrs } {
  const { type, size = DEFAULT_SIZE, fill, stroke = '#0c0a06', strokeWidth = 1.5, opacity = 1, dashed } = args;
  const meta = MARKER_TYPES[type];
  const sw = strokeWidth;
  const paint: ShapeAttrs = { fill: fill ?? meta.color, stroke, 'stroke-width': sw };
  const tail: ShapeAttrs = {
    ...(opacity === 1 ? {} : { opacity }),
    ...(dashed ? { 'stroke-dasharray': '2 1.5' } : {}),
  };

  if (meta.shape === 'circle') {
    const r = size / 2 - sw;
    return { tag: 'circle', attrs: { cx: size / 2, cy: size / 2, r, ...paint, ...tail } };
  }
  if (meta.shape === 'square') {
    const inset = sw;
    const sz = size - 2 * inset;
    const rx = (size * 0.18).toFixed(2);
    return { tag: 'rect', attrs: { x: inset, y: inset, width: sz, height: sz, rx, ...paint, ...tail } };
  }
  let points: string;
  if (meta.shape === 'diamond') {
    const c2 = size / 2;
    const off = size / 2 - sw;
    points = `${c2},${c2 - off} ${c2 + off},${c2} ${c2},${c2 + off} ${c2 - off},${c2}`;
  } else {
    // triangle
    const c2 = size / 2;
    const top = sw + 1;
    const bot = size - sw;
    const left = sw + 1;
    const right = size - sw - 1;
    points = `${c2},${top} ${right},${bot} ${left},${bot}`;
  }
  return { tag: 'polygon', attrs: { points, ...paint, 'stroke-linejoin': 'round', ...tail } };
}

// Returns the inner SVG markup (no <svg> wrapper) for the requested type. The
// imperative HTML builders (map markers, co-located site chips) use this.
export function shapeMarkup(args: ShapeArgs): string {
  const { tag, attrs } = shapeGeometry(args);
  const serialised = Object.entries(attrs)
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
  return `<${tag} ${serialised} />`;
}

// SVG attribute name → React prop name (`stroke-width` → `strokeWidth`).
function reactProps(attrs: ShapeAttrs): ShapeAttrs {
  return Object.fromEntries(
    Object.entries(attrs).map(([name, value]) => [name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), value]),
  );
}

interface MarkerShapeProps extends ShapeArgs {
  className?: string;
  ariaLabel?: string;
}

// React wrapper that renders the same primitive as shapeMarkup() — both
// serialise shapeGeometry(). Used by the legend, filter rows, node card;
// markers on the map use shapeMarkup() directly for the HTML element path.
export function MarkerShape({ className, ariaLabel, ...args }: MarkerShapeProps) {
  const size = args.size ?? DEFAULT_SIZE;
  const { tag, attrs } = shapeGeometry(args);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {createElement(tag, reactProps(attrs))}
    </svg>
  );
}
