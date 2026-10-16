import type { Contact } from '../../../../shared/types';
import { NoApiClient } from '../../../lib/apiClientContext';
import { ContactDetail } from './ContactDetail';

/** Contact card surfaced by clicking an @mention, with a Clear control. */
export function MentionedContactSection({ contact, onClear }: { contact: Contact; onClear: () => void }) {
  return (
    <div className="space-y-2">
      {/* Display-only: this card has always been rendered without a client, so
          its actions stay disabled and it never auto-measures hops. */}
      <NoApiClient>
        <ContactDetail publicKeyHex={contact.publicKeyHex} showPath={false} />
      </NoApiClient>
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
