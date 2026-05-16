import { getNameColor } from '../lib/contactColor';
import { useStore } from '../lib/store';

interface Props {
  name: string;
}

export function MentionPill({ name }: Props) {
  const contact = useStore((s) => s.contacts.find((c) => c.name === name));
  const setSelectedContact = useStore((s) => s.setSelectedContact);
  const setSelectedMessage = useStore((s) => s.setSelectedMessage);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const rightOpen = useStore((s) => s.ui.rightOpen);

  const { fg, pillBg } = getNameColor(name);

  if (!contact) {
    return (
      <span
        className="rounded px-1 py-0.5 text-cs-text-dim"
        style={{ backgroundColor: 'rgb(var(--cs-bg-3))' }}
      >
        @{name}
      </span>
    );
  }

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedMessage(null);
    setSelectedContact(contact.key);
    if (!rightOpen) toggleRightRail();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-1 py-0.5 font-medium transition-opacity hover:opacity-80"
      style={{ backgroundColor: pillBg, color: fg }}
    >
      @{name}
    </button>
  );
}
