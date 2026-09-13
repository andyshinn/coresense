import type { InspectField } from '../../lib/packetInspect';
import { ByteStrip } from './ByteStrip';
import { FieldCard } from './FieldCard';

interface Props {
  title: string;
  count?: number;
  bytes: number[];
  fields: InspectField[];
  scope: string;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}

export function PacketBreakdown({ title, count, bytes, fields, scope, hovered, setHovered }: Props) {
  return (
    <div>
      {(title || count != null) && (
        <div className="mt-5 mb-2.5 flex items-baseline gap-2">
          <span className="text-[13.5px] font-bold text-cs-text">{title}</span>
          {count != null && <span className="font-mono text-[11px] text-cs-text-dim">({count} bytes)</span>}
        </div>
      )}
      <ByteStrip bytes={bytes} fields={fields} scope={scope} hovered={hovered} setHovered={setHovered} />
      <div className="mt-2.5 flex flex-col gap-2">
        {fields.map((f) => (
          <FieldCard key={f.key} field={f} scope={scope} hovered={hovered} setHovered={setHovered} />
        ))}
      </div>
    </div>
  );
}
