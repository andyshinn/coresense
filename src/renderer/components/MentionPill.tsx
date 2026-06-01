import { useStore } from '../lib/store';

interface Props {
  name: string;
}

// Mentions render with neutral text (no per-name color) so a mention can't be
// mistaken for a colored sender label. A mention that resolves to a known
// contact gets a soft-accent background and, on click, opens that contact's
// conversation pane; an unresolved mention is a plain, dim chip.
export function MentionPill({ name }: Props) {
  const contact = useStore((s) => s.contacts.find((c) => c.name === name));
  const setActiveKey = useStore((s) => s.setActiveKey);

  if (!contact) {
    return <span className="rounded bg-cs-bg-3 px-1 py-0.5 text-cs-text-dim">@{name}</span>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // Don't let the click also select the surrounding message row; jump
        // straight to the mentioned contact's conversation pane.
        e.stopPropagation();
        setActiveKey(contact.key);
      }}
      className="rounded bg-cs-accent-soft/20 px-1 py-0.5 font-medium text-cs-text transition-opacity hover:opacity-80"
    >
      @{name}
    </button>
  );
}
