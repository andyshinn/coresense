import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';

const END_OF_DAY_MS = 86_399_999;

export function SortPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-6 rounded px-2 text-[11px] transition-colors',
        active ? 'bg-cs-accent-soft/40 text-cs-text' : 'text-cs-text-muted hover:text-cs-text',
      )}
    >
      {label}
    </button>
  );
}

export function DateInput({
  value,
  onChange,
  placeholder,
  endOfDay,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder: string;
  /** When true, parse the picked date as end-of-day so a "To: today" filter
   *  includes today's later messages instead of stopping at midnight. */
  endOfDay: boolean;
}) {
  // Round-trip: display the local date the timestamp falls in (not UTC),
  // emit local-midnight (+ end-of-day fudge for tsTo).
  const str = value
    ? (() => {
        const d = new Date(value);
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${mo}-${day}`;
      })()
    : '';
  return (
    <input
      type="date"
      value={str}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) {
          onChange(undefined);
          return;
        }
        const [y, mo, day] = v.split('-').map(Number);
        const ts = new Date(y, mo - 1, day).getTime();
        onChange(endOfDay ? ts + END_OF_DAY_MS : ts);
      }}
      aria-label={placeholder}
      title={placeholder}
      className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 text-cs-text outline-none focus:border-cs-accent"
    />
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-cs-text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Search className="size-5 text-cs-text-dim" aria-hidden="true" />
      <h2 className="font-mono text-[11px] uppercase tracking-wider text-cs-text-muted">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-cs-text-dim">{body}</p>
    </div>
  );
}
