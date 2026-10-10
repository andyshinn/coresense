import { Send } from 'lucide-react';
import type { TelemetryPolicy } from '../../../../shared/types';
import { NumberSelect, Row, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../types';
import { useSettingsSection } from '../useSectionDraft';

const eqMessages = (a: TelemetryPolicy, b: TelemetryPolicy) => a.multiAcks === b.multiAcks;

const MULTI_ACK_OPTIONS = [
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
] satisfies { value: number; label: string }[];

export function MessageSection({ client }: SectionProps) {
  const saved = useStore((s) => s.telemetryPolicy);
  const { draft, setDraft, sectionProps } = useSettingsSection({
    id: 'radio-messages',
    saved,
    eq: eqMessages,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      await api.putTelemetryPolicy(client, {
        ...useStore.getState().telemetryPolicy,
        multiAcks: d.multiAcks,
      });
      notify.success('Message settings saved');
    },
  });

  return (
    <SettingsSection
      {...sectionProps}
      icon={Send}
      title="Messages"
      description="Send/receive reliability behaviour."
      canSave={!!client}
    >
      <Row
        label="Direct Message Acks"
        description="Number of duplicate acks the radio emits per inbound DM. Higher = more reliable delivery reports at the cost of airtime."
        changed={draft.multiAcks !== saved.multiAcks}
        control={
          <NumberSelect
            value={draft.multiAcks}
            options={MULTI_ACK_OPTIONS}
            onChange={(multiAcks) => setDraft((s) => ({ ...s, multiAcks }))}
          />
        }
      />
      <Row
        label="Auto Retry"
        description="Direct messages retry up to 5 times with the known path, then 3 more as floods."
        control={<Toggle checked disabled onChange={() => undefined} />}
      />
      <Row
        label="Auto Reset Path"
        description="If retry keeps failing, drop the known path and try as a flood. Built into our retry pipeline."
        control={<Toggle checked disabled onChange={() => undefined} />}
      />
    </SettingsSection>
  );
}
