import type { Contact } from '../../../shared/types';
import { SetPathEditor } from '../../components/path/SetPathEditor';
import type { ApiClient } from '../../lib/api';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

export function PathTab({ contact, client }: Props) {
  return (
    <div className="h-full overflow-auto">
      <SetPathEditor contact={contact} client={client} />
    </div>
  );
}
