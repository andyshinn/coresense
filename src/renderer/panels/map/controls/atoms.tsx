import { cn } from '../../../lib/utils';

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-3 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
      {children}
    </div>
  );
}

export function ToggleRow({
  label,
  on,
  sub,
  onChange,
}: {
  label: string;
  on: boolean;
  sub?: string;
  onChange: (v: boolean) => void;
}) {
  // Whole row is clickable so the user doesn't have to hit the small toggle.
  // The switch is rendered as a non-interactive visual indicator — Radix
  // Switch is itself a <button> and nesting buttons is invalid DOM.
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className="flex w-full cursor-pointer items-center gap-2.5 px-1 py-1.5 text-left"
    >
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-cs-text">{label}</span>
        {sub && <span className="block font-mono text-[10px] text-cs-text-dim">{sub}</span>}
      </span>
      <SwitchVisual on={on} />
    </button>
  );
}

// Pure CSS pill that mirrors the radix Switch's checked/unchecked look. Used
// inside row-buttons where a real Switch (a <button>) would cause invalid DOM
// nesting.
export function SwitchVisual({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-state={on ? 'checked' : 'unchecked'}
      className={cn(
        'relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-primary' : 'bg-input dark:bg-input/80',
      )}
    >
      <span
        className={cn(
          'block size-3 rounded-full bg-background transition-transform dark:bg-foreground',
          on ? 'translate-x-[calc(100%-2px)]' : 'translate-x-0',
        )}
      />
    </span>
  );
}

export function NumberRow({
  label,
  sub,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  sub?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-1.5">
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-cs-text">{label}</span>
        {sub && <span className="block font-mono text-[10px] text-cs-text-dim">{sub}</span>}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
          }}
          className="h-6 w-14 rounded border border-cs-border bg-cs-bg-3 px-1.5 text-right font-mono text-[11px] text-cs-text outline-none focus:border-cs-accent"
        />
        {unit && <span className="font-mono text-[10px] text-cs-text-dim">{unit}</span>}
      </div>
    </div>
  );
}
