import { Send } from 'lucide-react';
import type { TelemetryPolicy } from '../../../../shared/types';
import { Row, Select, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { useSettingsSection } from '../useSectionDraft';
import type { SectionProps } from './shared';

const eqMessages = (a: TelemetryPolicy, b: TelemetryPolicy) => a.multiAcks === b.multiAcks;

export function MessageSection({ client }: SectionProps) {
  const saved = useStore((s) => s.telemetryPolicy);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
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
      id="radio-messages"
      icon={Send}
      title="Messages"
      description="Send/receive reliability behaviour."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Direct Message Acks"
        description="Number of duplicate acks the radio emits per inbound DM. Higher = more reliable delivery reports at the cost of airtime."
        changed={draft.multiAcks !== saved.multiAcks}
        control={
          <Select<string>
            value={String(draft.multiAcks)}
            options={[
              { value: '0', label: '0' },
              { value: '1', label: '1' },
              { value: '2', label: '2' },
            ]}
            onChange={(v) => setDraft((s) => ({ ...s, multiAcks: Number(v) }))}
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
