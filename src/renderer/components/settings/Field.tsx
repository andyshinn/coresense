import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface RowProps {
  label: string;
  description?: string;
  control: ReactNode;
  warning?: string;
  /** When true, marks the row as having an unsaved edit (accent dot + border). */
  changed?: boolean;
}

export function Row({ label, description, control, warning, changed }: RowProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded border-l-2 px-2 py-1 hover:bg-cs-bg-2',
        changed ? 'border-cs-accent' : 'border-transparent',
      )}
    >
      <div className="flex-1">
        <div className="flex items-center gap-1.5 text-[12px] text-cs-text">
          {changed && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-cs-accent" />}
          <span>{label}</span>
        </div>
        {description && <div className="text-[11px] text-cs-text-dim">{description}</div>}
        {warning && <div className="mt-0.5 text-[11px] text-cs-warn">{warning}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer accent-cs-accent disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

const SELECT_CLASS =
  'rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text disabled:cursor-not-allowed disabled:opacity-50';

interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
}

export function Select<T extends string>({ value, options, onChange, disabled }: SelectProps<T>) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} className={SELECT_CLASS}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface NumberSelectProps<T extends number> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
}

// Select for a numeric setting. <option> values are strings, so the pick is
// mapped back to its option's number — a typo'd option can't become NaN.
export function NumberSelect<T extends number>({ value, options, onChange, disabled }: NumberSelectProps<T>) {
  return (
    <select
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const picked = options.find((opt) => String(opt.value) === e.target.value);
        if (picked) onChange(picked.value);
      }}
      className={SELECT_CLASS}
    >
      {options.map((opt) => (
        <option key={opt.value} value={String(opt.value)}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface NumberInputProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  width?: string;
  suffix?: string;
}

export function NumberInput({ value, onChange, min, max, step, disabled, width = 'w-24', suffix }: NumberInputProps) {
  return (
    <span className="flex items-baseline gap-1">
      <input
        type="number"
        value={value}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isNaN(next)) onChange(next);
        }}
        className={`rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-right font-mono text-[12px] text-cs-text disabled:cursor-not-allowed disabled:opacity-50 ${width}`}
      />
      {suffix && <span className="text-[11px] text-cs-text-dim">{suffix}</span>}
    </span>
  );
}

interface TextInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  width?: string;
}

export function TextInput({ value, onChange, disabled, placeholder, width = 'w-48' }: TextInputProps) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text disabled:cursor-not-allowed disabled:opacity-50 ${width}`}
    />
  );
}
