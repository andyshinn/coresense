import { useId, useMemo, useState } from 'react';
import type { DescribedReading } from '../../../shared/telemetry/describe';
import { formatNumber, withUnit } from '../../../shared/telemetry/format';
import { hexToBytes, isGpsValue, LPP_TYPES } from '../../../shared/telemetry/lpp';
import { Collapsible } from '../../components/Collapsible';
import { ByteStrip } from '../../components/packet/ByteStrip';
import { fieldColorVar, type InspectField } from '../../lib/packetInspect';
import { cn } from '../../lib/utils';
import { sizeLine } from './format';
import { LABEL_CAPS, META } from './ui';

// Role colours from the Packet Log field palette: the type id takes the teal
// the mockup gives it (field-4 = hash-1's hue), the value the amber of its
// "selected value", the channel blue.
const ROLE = { ch: 1, type: 4, value: 0 } as const;

const hx = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

interface Props {
  /** The payload exactly as received (padding included); null when there was no reply. */
  rawHex: string | null;
  /** The request's readings, described (flatten describeChannels()). */
  readings: readonly DescribedReading[];
  /** Undecoded tail (unknown type id or truncated record); '' when fully decoded. */
  restHex?: string;
  defaultOpen?: boolean;
}

/** "ch 2 temp → 0x00F6 = 246 ÷ 10 = 24.6 °C": how a record's value bytes became its value. */
export function explainReading(d: DescribedReading, bytes: Uint8Array): string {
  const { ch, typeId, offset, len } = d.reading;
  const head = `ch ${ch} ${d.typeName} →`;
  const data = bytes.slice(offset + 2, offset + len);
  if (isGpsValue(d.reading.value)) return `${head} ${data.length} bytes = ${d.text} · ${d.secondary ?? ''}`.trim();
  const type = LPP_TYPES[typeId];
  const hex = `0x${Array.from(data, hx).join('')}`;
  if (!type || typeof d.reading.value !== 'number') return `${head} ${hex}`;
  let int = 0;
  for (const b of data) int = int * 256 + b;
  if (type.signed && int >= 2 ** (data.length * 8 - 1)) int -= 2 ** (data.length * 8);
  const mult = Math.round(1 / type.step);
  const value = withUnit(formatNumber(d.reading.value, type.decimals), d.baseUnit);
  return mult === 1 ? `${head} ${hex} = ${value}` : `${head} ${hex} = ${formatNumber(int, 0)} ÷ ${mult} = ${value}`;
}

function recordHex(bytes: Uint8Array, start: number, len: number): string {
  return Array.from(bytes.slice(start, start + len), hx).join(' ');
}

/**
 * The raw CayenneLPP payload, collapsed by default: the Packet Log byte strip
 * with each record's channel, type id and value bytes in their own colour
 * (hover a record, or its table row, to spotlight it), a decoded table, and
 * whatever wasn't decoded left dim — the undecoded tail, or the zero padding a
 * mesh reply carries to the AES block.
 */
export function LppInspector({ rawHex, readings, restHex = '', defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState<string | null>(null);
  const scope = useId();
  const bytes = useMemo(() => (rawHex ? (hexToBytes(rawHex) ?? new Uint8Array()) : new Uint8Array()), [rawHex]);

  const fields = useMemo<InspectField[]>(
    () =>
      readings.flatMap((d, i) => {
        const { offset, len } = d.reading;
        // One key per record, three roles: the strip spotlights the whole
        // record together while each role keeps its colour.
        const key = `r${i}`;
        const base = { key, name: d.label, value: d.text };
        return [
          { ...base, start: offset, end: offset, colorIdx: ROLE.ch },
          { ...base, start: offset + 1, end: offset + 1, colorIdx: ROLE.type },
          { ...base, start: offset + 2, end: offset + len - 1, colorIdx: ROLE.value },
        ];
      }),
    [readings],
  );

  const decodedEnd = readings.reduce((end, d) => Math.max(end, d.reading.offset + d.reading.len), 0);
  const restBytes = restHex.length / 2;
  const paddingBytes = Math.max(0, bytes.length - decodedEnd - restBytes);
  const hoveredIndex = hovered?.startsWith(`${scope}:r`) ? Number(hovered.slice(scope.length + 2)) : null;
  const hoveredReading = hoveredIndex !== null ? readings[hoveredIndex] : undefined;

  return (
    <section className="rounded-lg border border-cs-border bg-cs-bg-2 px-1.5 py-1">
      <Collapsible
        sectionHeader
        label="Decoded CayenneLPP"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        trailing={
          <span className={cn(META, 'shrink-0 normal-case tracking-normal')}>{sizeLine(bytes.length, readings.length)}</span>
        }
      >
        <div className="flex flex-col gap-2.5 px-2 pt-1.5 pb-2">
          {bytes.length > 0 ? (
            <ByteStrip bytes={Array.from(bytes)} fields={fields} scope={scope} hovered={hovered} setHovered={setHovered} />
          ) : (
            <p className="text-[12px] text-cs-text-dim">No payload: the node didn’t reply.</p>
          )}

          <div className={cn(META, 'flex flex-wrap items-center gap-x-4 gap-y-1')}>
            {(
              [
                ['channel', ROLE.ch],
                ['type id', ROLE.type],
                ['value', ROLE.value],
              ] as const
            ).map(([name, idx]) => (
              <span key={name} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-[2px]"
                  style={{ background: `color-mix(in srgb, ${fieldColorVar(idx)} 40%, transparent)` }}
                />
                {name}
              </span>
            ))}
            {hoveredReading && (
              <span data-testid="lpp-explain" className="text-cs-text-muted">
                {explainReading(hoveredReading, bytes)}
              </span>
            )}
          </div>

          {readings.length > 0 && (
            <table className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className={LABEL_CAPS}>
                  <th className="w-9 py-1 font-normal">Ch</th>
                  <th className="w-11 py-1 font-normal">Type</th>
                  <th className="py-1 font-normal">Name</th>
                  <th className="py-1 font-normal">Bytes</th>
                  <th className="py-1 text-right font-normal">Value</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[11px] tabular-nums">
                {readings.map((d, i) => {
                  const id = `${scope}:r${i}`;
                  return (
                    <tr
                      key={d.reading.offset}
                      data-testid="lpp-row"
                      data-active={hovered === id || undefined}
                      onMouseEnter={() => setHovered(id)}
                      onMouseLeave={() => setHovered(null)}
                      className={cn('border-t border-cs-border', hovered === id && 'bg-cs-bg-3')}
                    >
                      <td className="py-1 text-cs-text-muted">{d.reading.ch}</td>
                      <td className="py-1 text-cs-text-muted">{d.reading.typeId}</td>
                      <td className="truncate py-1 font-sans text-[12px] text-cs-text">{d.label}</td>
                      <td
                        className="truncate py-1 text-cs-text-dim"
                        title={recordHex(bytes, d.reading.offset, d.reading.len)}
                      >
                        {recordHex(bytes, d.reading.offset, d.reading.len)}
                      </td>
                      <td className="truncate py-1 text-right text-cs-text">{d.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {restBytes > 0 && (
            <p className={cn(META, 'text-cs-text-muted')}>
              {restBytes} undecoded byte{restBytes === 1 ? '' : 's'} (unknown type id or truncated record), shown dim
            </p>
          )}
          {paddingBytes > 0 && (
            <p className={META}>
              {paddingBytes} byte{paddingBytes === 1 ? '' : 's'} of zero padding (mesh replies fill a 16-byte block)
            </p>
          )}
        </div>
      </Collapsible>
    </section>
  );
}
