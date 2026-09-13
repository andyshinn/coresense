import type { BitRow } from '../../lib/packetInspect';

export function BitTable({ rows, colorVar }: { rows: BitRow[]; colorVar: string }) {
  return (
    <table className="mt-2 w-full table-fixed border-collapse">
      <thead>
        <tr className="text-[9px] uppercase tracking-wide text-cs-text-dim">
          <th className="w-[20%] border-b border-cs-border px-2 py-1 text-left font-mono font-medium">Bits</th>
          <th className="w-[34%] border-b border-cs-border px-2 py-1 text-left font-mono font-medium">Field</th>
          <th className="w-[28%] border-b border-cs-border px-2 py-1 text-left font-mono font-medium">Value</th>
          <th className="w-[18%] border-b border-cs-border px-2 py-1 text-left font-mono font-medium">Bin</th>
        </tr>
      </thead>
      <tbody className="font-mono text-[11px]">
        {rows.map((r) => (
          <tr key={`${r.range}-${r.field}`}>
            <td className="border-b border-cs-border px-2 py-1 text-cs-text-dim">{r.range}</td>
            <td className="border-b border-cs-border px-2 py-1 text-cs-text">{r.field}</td>
            <td className="border-b border-cs-border px-2 py-1 text-cs-text-muted">{r.value}</td>
            <td className="border-b border-cs-border px-2 py-1 font-semibold" style={{ color: colorVar }}>
              {r.binary}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
