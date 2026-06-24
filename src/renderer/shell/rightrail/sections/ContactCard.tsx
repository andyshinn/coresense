import type { LucideIcon } from 'lucide-react';

/** Compact icon+label button used inside the contact card action row. */
export function CardActionButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-cs-border bg-cs-bg-3 text-cs-text hover:bg-cs-border"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        borderRadius: 'var(--radius-2)',
        padding: '2px 8px',
        fontSize: 10,
        cursor: 'pointer',
      }}
    >
      <Icon size={11} aria-hidden />
      {label}
    </button>
  );
}
