import { Button, Flex } from '@radix-ui/themes';
import type { Contact } from '../../../../shared/types';
import { ContactDetail } from './ContactDetail';

/** Contact card surfaced by clicking an @mention, with a Clear control. */
export function MentionedContactSection({ contact, onClear }: { contact: Contact; onClear: () => void }) {
  return (
    <Flex direction="column" gap="2">
      <ContactDetail publicKeyHex={contact.publicKeyHex} client={null} showPath={false} />
      <Button
        variant="ghost"
        color="gray"
        size="1"
        onClick={onClear}
        style={{ alignSelf: 'flex-start', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}
      >
        Clear
      </Button>
    </Flex>
  );
}
