import { CapacityMeter as Meter } from '../../components/CapacityMeter';
import { useStore } from '../../lib/store';

/** Contacts committed to the radio's store, against its limit. */
export function CapacityMeter() {
  const onRadio = useStore((s) => s.contacts.length);
  const max = useStore((s) => s.deviceInfo.maxContacts);
  return <Meter used={onRadio} max={max} title="Contacts committed to the radio's store" />;
}
