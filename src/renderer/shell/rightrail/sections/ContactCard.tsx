import type { LucideIcon } from 'lucide-react';

/** Compact icon+label button used inside the contact card action row. */
export function CardActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[10px] text-cs-text hover:bg-cs-border"
    >
      <Icon size={11} aria-hidden />
      {label}
    </button>
  );
}
