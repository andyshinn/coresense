import type { Contact } from '../../../../shared/types';
import { ContactDetail } from './ContactDetail';

/** Contact card surfaced by clicking an @mention, with a Clear control. */
export function MentionedContactSection({ contact, onClear }: { contact: Contact; onClear: () => void }) {
  return (
    <div className="space-y-2">
      <ContactDetail publicKeyHex={contact.publicKeyHex} client={null} showPath={false} />
      <button
        type="button"
        onClick={onClear}
        className="text-[10px] uppercase tracking-wider text-cs-text-dim hover:text-cs-text"
      >
        Clear
      </button>
    </div>
  );
}
