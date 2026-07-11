import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { InspectField } from '../../lib/packetInspect';
import { BitTable } from './BitTable';

const colorVar = (idx: number) => `rgb(var(--cs-field${idx}))`;

interface Props {
  field: InspectField;
  scope: string;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}

export function FieldCard({ field, scope, hovered, setHovered }: Props) {
  const id = `${scope}:${field.key}`;
  const color = colorVar(field.colorIdx);
  const active = hovered === id;
  const dimmed = hovered != null && hovered !== id;
  const [openBits, setOpenBits] = useState(true);
  const range = field.start === field.end ? `Byte ${field.start}` : `Bytes ${field.start}-${field.end}`;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-only highlight, mirrors selection driven by the byte strip elsewhere
    <div
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      className="relative rounded-lg border px-3 py-2.5 pl-3.5 transition-[opacity,border-color] bg-cs-bg-3"
      style={{
        borderColor: active ? `color-mix(in srgb, ${color} 55%, transparent)` : 'rgb(var(--cs-border))',
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <div className="absolute top-2 bottom-2 left-0 w-[3px] rounded" style={{ background: color }} />
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[12px] font-semibold" style={{ color }}>
          {field.name}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10px] whitespace-nowrap text-cs-text-dim">{range}</span>
        {field.bits && (
          <button
            type="button"
            onClick={() => setOpenBits((v) => !v)}
            title={openBits ? 'Hide bits' : 'Show bits'}
            className="text-cs-text-dim"
            style={{ transform: openBits ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }}
          >
            <ChevronDown size={13} />
          </button>
        )}
      </div>
      <div className="max-h-24 overflow-y-auto rounded border border-cs-border bg-cs-bg-2 px-2.5 py-1.5 font-mono text-[11.5px] break-all text-cs-text-muted">
        {field.value || '—'}
      </div>
      {field.bits && openBits && <BitTable rows={field.bits} colorVar={color} />}
      {field.desc && (
        <div className="mt-2 truncate text-[11px] text-cs-text-dim" title={field.desc}>
          {field.desc}
        </div>
      )}
    </div>
  );
}
