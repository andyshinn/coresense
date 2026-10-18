interface Props {
  title: string;
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** A repeater-admin tab's header row: the section title and its one fetch
 *  button, which reads `busyLabel` and stays disabled while the fetch runs. */
export function TabToolbar({ title, label, busyLabel, busy, disabled, onClick }: Props) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">{title}</h3>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text-muted hover:bg-cs-accent-soft/30 hover:text-cs-text disabled:opacity-50"
      >
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}
