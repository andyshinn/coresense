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

// Returns the inner SVG markup (no <svg> wrapper) for the requested type. Used
// by both the React component and the imperative HTML builder so the visual
// stays identical regardless of mount path.
export function shapeMarkup(args: ShapeArgs): string {
  const {
    type,
    size = 18,
    fill,
    stroke = '#0c0a06',
    strokeWidth = 1.5,
    opacity = 1,
    dashed,
  } = args;
  const meta = MARKER_TYPES[type];
  const c = fill ?? meta.color;
  const sw = strokeWidth;
  const dashAttr = dashed ? ` stroke-dasharray="2 1.5"` : '';
  const opAttr = opacity === 1 ? '' : ` opacity="${opacity}"`;

  if (meta.shape === 'circle') {
    const r = size / 2 - sw;
    return `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${c}" stroke="${stroke}" stroke-width="${sw}"${opAttr}${dashAttr} />`;
  }
  if (meta.shape === 'square') {
    const inset = sw;
    const sz = size - 2 * inset;
    const r = (size * 0.18).toFixed(2);
    return `<rect x="${inset}" y="${inset}" width="${sz}" height="${sz}" rx="${r}" fill="${c}" stroke="${stroke}" stroke-width="${sw}"${opAttr}${dashAttr} />`;
  }
  if (meta.shape === 'diamond') {
    const c2 = size / 2;
    const off = size / 2 - sw;
    const pts = `${c2},${c2 - off} ${c2 + off},${c2} ${c2},${c2 + off} ${c2 - off},${c2}`;
    return `<polygon points="${pts}" fill="${c}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"${opAttr}${dashAttr} />`;
  }
  // triangle
  const c2 = size / 2;
  const top = sw + 1;
  const bot = size - sw;
  const left = sw + 1;
  const right = size - sw - 1;
  const pts = `${c2},${top} ${right},${bot} ${left},${bot}`;
  return `<polygon points="${pts}" fill="${c}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"${opAttr}${dashAttr} />`;
}

interface MarkerShapeProps extends ShapeArgs {
  className?: string;
  ariaLabel?: string;
}

// React wrapper that renders the same primitives as shapeMarkup() via JSX.
// Kept in sync with shapeMarkup by construction — both consult MARKER_TYPES
// for the shape and use the same geometry. Used by the legend, filter rows,
// node card; markers on the map use shapeMarkup() directly for the HTML
// element path.
export function MarkerShape({ className, ariaLabel, ...args }: MarkerShapeProps) {
  const {
    type,
    size = 18,
    fill,
    stroke = '#0c0a06',
    strokeWidth = 1.5,
    opacity = 1,
    dashed,
  } = args;
  const meta = MARKER_TYPES[type];
  const c = fill ?? meta.color;
  const sw = strokeWidth;
  const dashAttr = dashed ? { strokeDasharray: '2 1.5' } : undefined;

  let body: React.ReactNode;
  if (meta.shape === 'circle') {
    const r = size / 2 - sw;
    body = (
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill={c}
        stroke={stroke}
        strokeWidth={sw}
        opacity={opacity}
        {...dashAttr}
      />
    );
  } else if (meta.shape === 'square') {
    const inset = sw;
    body = (
      <rect
        x={inset}
        y={inset}
        width={size - 2 * inset}
        height={size - 2 * inset}
        rx={size * 0.18}
        fill={c}
        stroke={stroke}
        strokeWidth={sw}
        opacity={opacity}
        {...dashAttr}
      />
    );
  } else if (meta.shape === 'diamond') {
    const c2 = size / 2;
    const off = size / 2 - sw;
    body = (
      <polygon
        points={`${c2},${c2 - off} ${c2 + off},${c2} ${c2},${c2 + off} ${c2 - off},${c2}`}
        fill={c}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        opacity={opacity}
        {...dashAttr}
      />
    );
  } else {
    const c2 = size / 2;
    const top = sw + 1;
    const bot = size - sw;
    const left = sw + 1;
    const right = size - sw - 1;
    body = (
      <polygon
        points={`${c2},${top} ${right},${bot} ${left},${bot}`}
        fill={c}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        opacity={opacity}
        {...dashAttr}
      />
    );
  }

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
      {body}
    </svg>
  );
}
