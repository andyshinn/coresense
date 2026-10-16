import type { Contact } from '../../../shared/types';
import { SetPathEditor } from '../../components/path/SetPathEditor';

interface Props {
  contact: Contact;
}

export function PathTab({ contact }: Props) {
  return (
    <div className="h-full overflow-auto">
      <SetPathEditor contact={contact} />
    </div>
  );
}
