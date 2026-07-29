import { useMemo } from 'react';
import { fieldColorVar, type InspectField } from '../../lib/packetInspect';

const hx = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

interface Props {
  bytes: number[];
  fields: InspectField[];
  scope: string;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}

export function ByteStrip({ bytes, fields, scope, hovered, setHovered }: Props) {
  const map = useMemo(() => {
    const m: Array<{ key: string; colorIdx: number } | undefined> = [];
    for (const f of fields) for (let i = f.start; i <= f.end; i++) m[i] = { key: f.key, colorIdx: f.colorIdx };
    return m;
  }, [fields]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the container clears the hover spotlight when the pointer leaves the whole strip; the byte cells (below) drive it while inside. There's no interactive role for a hover-only highlight surface.
    <div
      onMouseLeave={() => setHovered(null)}
      className="rounded-lg border border-cs-border bg-cs-bg-3/40 px-3 py-2 font-mono text-[12.5px] leading-none tracking-wide break-all"
    >
      {bytes.map((b, i) => {
        const info = map[i];
        const id = info ? `${scope}:${info.key}` : null;
        const color = info ? fieldColorVar(info.colorIdx) : 'rgb(var(--cs-text-dim))';
        const active = id != null && hovered === id;
        const dimmed = hovered != null && id != null && hovered !== id;
        const prev = map[i - 1];
        const next = map[i + 1];
        const runStart = !prev || prev.key !== info?.key;
        const runEnd = !next || next.key !== info?.key;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: byte cells are a mouse-hover spotlight enhancement; per-byte focus would add dozens of tab stops. Keyboard users get the same byte↔field highlight by focusing the field cards, and all field data is always rendered in the cards regardless of hover.
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: byte position is the identity
            key={i}
            // Only onMouseEnter — clearing is delegated to the container's onMouseLeave.
            // With no per-cell leave handler and no margins between cells, the pointer is
            // always over some cell while inside the strip, so the highlight never blinks
            // to null in the gap between two cells (the old flicker).
            onMouseEnter={() => setHovered(id)}
            style={{
              display: 'inline-block',
              verticalAlign: 'top',
              background: active ? color : `color-mix(in srgb, ${color} ${dimmed ? '6%' : '16%'}, transparent)`,
              color: active ? 'rgb(var(--cs-bg))' : dimmed ? `color-mix(in srgb, ${color} 50%, transparent)` : color,
              // No horizontal margin between cells and full-height cells (padding + tight
              // line-height so wrapped rows touch top-to-bottom) => zero pointer gaps in
              // either axis. Runs are separated by color + rounded ends, not by whitespace.
              lineHeight: '15px',
              paddingTop: 3,
              paddingBottom: 3,
              paddingLeft: runStart ? 5 : 1,
              paddingRight: runEnd ? 5 : 1,
              borderTopLeftRadius: runStart ? 4 : 0,
              borderBottomLeftRadius: runStart ? 4 : 0,
              borderTopRightRadius: runEnd ? 4 : 0,
              borderBottomRightRadius: runEnd ? 4 : 0,
              cursor: 'default',
            }}
          >
            {hx(b)}
          </span>
        );
      })}
    </div>
  );
}
