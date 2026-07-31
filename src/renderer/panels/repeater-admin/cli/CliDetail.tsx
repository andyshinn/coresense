import type { CliSuggestion } from './lib/suggest';

export interface CliDetailProps {
  item: CliSuggestion;
  /** The value currently on the node for this command's `key` (§2.3), if known. */
  nodeValue?: string;
  /** Airtime label such as '~2.9 s', or null when radioSettings is not yet loaded. */
  roundTripLabel: string | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">{label}</span>
      <span className="truncate font-mono tabular-nums text-cs-text-muted">{children}</span>
    </div>
  );
}

export function CliDetail({ item, nodeValue, roundTripLabel }: CliDetailProps) {
  const cmd = item.cmd;

  // Argument-mode value: label, description, and what it resolves to (its meta).
  if (!cmd) {
    return (
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[13px] text-cs-text">{item.label}</div>
        <p className="text-[12px] leading-snug text-cs-text-muted" style={{ textWrap: 'pretty' }}>
          {item.desc}
        </p>
        {item.meta ? (
          <div className="rounded border border-cs-border bg-cs-bg px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-cs-text-dim">Resolves to</div>
            <div className="mt-0.5 break-all font-mono text-[12px] text-cs-accent">{item.meta}</div>
          </div>
        ) : null}
      </div>
    );
  }

  const roundTrip = cmd.noReply ? '1↑ · no reply' : `1↑ 1↓ · ${roundTripLabel ?? '—'}`;

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="font-mono text-[13px] text-cs-text">
          {cmd.name}
          {cmd.spec ? <span className="text-cs-text-dim"> {cmd.spec}</span> : null}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-cs-text-muted" style={{ textWrap: 'pretty' }}>
          {cmd.desc}
        </p>
      </div>

      {cmd.args && cmd.args.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wider text-cs-text-dim">Parameters</div>
          {cmd.args.map((a) => (
            <div key={a.name} className="flex items-baseline gap-2 text-[11px]">
              <span className="shrink-0 font-mono text-cs-text">{a.name}</span>
              <span className="text-cs-text-dim" style={{ textWrap: 'pretty' }}>
                {a.enum ? a.enum.join(' | ') : (a.hint ?? (a.range ? `${a.range[0]}–${a.range[1]}` : ''))}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {cmd.def ? <Field label="Default">{cmd.def}</Field> : null}
      {nodeValue && nodeValue.length > 0 ? (
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">On node</span>
          <span className="truncate font-mono tabular-nums text-cs-text">{nodeValue}</span>
        </div>
      ) : null}
      <Field label="Round trip">{roundTrip}</Field>

      {cmd.note ? (
        <p
          className="border-t border-cs-border pt-2 text-[11px] leading-snug text-cs-text-dim"
          style={{ textWrap: 'pretty' }}
        >
          {cmd.note}
        </p>
      ) : null}
    </div>
  );
}
