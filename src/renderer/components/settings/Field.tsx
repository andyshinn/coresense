import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="border-b border-cs-border py-4 last:border-b-0">
      <header className="mb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[11px] text-cs-text-dim">{description}</p>}
      </header>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

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

interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
}

export function Select<T extends string>({ value, options, onChange, disabled }: SelectProps<T>) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
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

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  width = 'w-24',
  suffix,
}: NumberInputProps) {
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

export function TextInput({
  value,
  onChange,
  disabled,
  placeholder,
  width = 'w-48',
}: TextInputProps) {
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

interface PanelShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PanelShell({ title, description, actions, children }: PanelShellProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-cs-border bg-cs-bg-2 px-4 py-2.5">
        <div className="flex flex-col">
          <h1 className="font-medium leading-tight text-cs-text">{title}</h1>
          {description && (
            <span className="font-mono text-[10px] text-cs-text-dim">{description}</span>
          )}
        </div>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>
      <div className="flex-1 overflow-y-auto px-4">{children}</div>
    </div>
  );
}
