import { cn } from '../lib/utils';

interface Props {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

// Underlined filter tab with a count pill — the Unreads filters and the
// Contacts manager's state tabs.
export function CountTab({ label, count, active, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-2 py-1 transition-colors',
        active ? 'border-cs-accent text-cs-text' : 'border-transparent text-cs-text-muted hover:text-cs-text',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-px font-mono text-[9px] tabular-nums',
          active ? 'bg-cs-accent-soft/30 text-cs-text' : 'bg-cs-bg-3 text-cs-text-dim',
        )}
      >
        {count}
      </span>
    </button>
  );
}
