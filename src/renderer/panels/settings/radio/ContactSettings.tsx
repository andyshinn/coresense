import { Contact as ContactIcon } from 'lucide-react';
import type { AutoAddConfig } from '../../../../shared/types';
import { NumberInput, Row, Select, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { useSettingsSection } from '../useSectionDraft';
import type { SectionProps } from './shared';

const eqAutoAdd = (a: AutoAddConfig, b: AutoAddConfig) =>
  a.mode === b.mode &&
  a.chat === b.chat &&
  a.repeater === b.repeater &&
  a.room === b.room &&
  a.sensor === b.sensor &&
  a.overwriteOldest === b.overwriteOldest &&
  a.maxHops === b.maxHops &&
  a.pullToRefresh === b.pullToRefresh &&
  a.showPublicKeys === b.showPublicKeys;

export function ContactSettingsSection({ client }: SectionProps) {
  const saved = useStore((s) => s.autoAddConfig);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'radio-contacts',
    saved,
    eq: eqAutoAdd,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      await api.putAutoAddConfig(client, d);
      notify.success('Contact settings saved');
    },
  });

  return (
    <SettingsSection
      id="radio-contacts"
      icon={ContactIcon}
      title="Contacts · Auto-add"
      description="Auto-add behaviour for incoming adverts."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Mode"
        description="All adds every received advert; Selected only adds the kinds you tick below."
        changed={draft.mode !== saved.mode}
        control={
          <Select<'all' | 'selected'>
            value={draft.mode}
            options={[
              { value: 'all', label: 'Auto Add All' },
              { value: 'selected', label: 'Auto Add Selected' },
            ]}
            onChange={(mode) => setDraft((s) => ({ ...s, mode }))}
          />
        }
      />
      <Row
        label="Chat users"
        changed={draft.chat !== saved.chat}
        control={
          <Toggle
            checked={draft.chat}
            disabled={draft.mode === 'all'}
            onChange={(chat) => setDraft((s) => ({ ...s, chat }))}
          />
        }
      />
      <Row
        label="Repeaters"
        changed={draft.repeater !== saved.repeater}
        control={
          <Toggle
            checked={draft.repeater}
            disabled={draft.mode === 'all'}
            onChange={(repeater) => setDraft((s) => ({ ...s, repeater }))}
          />
        }
      />
      <Row
        label="Room Servers"
        changed={draft.room !== saved.room}
        control={
          <Toggle
            checked={draft.room}
            disabled={draft.mode === 'all'}
            onChange={(room) => setDraft((s) => ({ ...s, room }))}
          />
        }
      />
      <Row
        label="Sensors"
        changed={draft.sensor !== saved.sensor}
        control={
          <Toggle
            checked={draft.sensor}
            disabled={draft.mode === 'all'}
            onChange={(sensor) => setDraft((s) => ({ ...s, sensor }))}
          />
        }
      />
      <Row
        label="Overwrite oldest"
        description="When the contacts list fills up, drop the oldest non-favourite to make room."
        changed={draft.overwriteOldest !== saved.overwriteOldest}
        control={
          <Toggle
            checked={draft.overwriteOldest}
            onChange={(overwriteOldest) => setDraft((s) => ({ ...s, overwriteOldest }))}
          />
        }
      />
      <Row
        label="Auto-add max hops (0-63)"
        description="Adverts with more hops than this are ignored. Leave 0 for no limit."
        changed={(draft.maxHops ?? 0) !== (saved.maxHops ?? 0)}
        control={
          <NumberInput
            value={draft.maxHops ?? 0}
            min={0}
            max={63}
            onChange={(v) => setDraft((s) => ({ ...s, maxHops: v === 0 ? null : v }))}
          />
        }
      />
      <Row
        label="Pull to refresh"
        changed={draft.pullToRefresh !== saved.pullToRefresh}
        control={
          <Toggle checked={draft.pullToRefresh} onChange={(pullToRefresh) => setDraft((s) => ({ ...s, pullToRefresh }))} />
        }
      />
      <Row
        label="Show public keys"
        description="When on, contact rows include a short pubkey prefix beside the name."
        changed={draft.showPublicKeys !== saved.showPublicKeys}
        control={
          <Toggle
            checked={draft.showPublicKeys}
            onChange={(showPublicKeys) => setDraft((s) => ({ ...s, showPublicKeys }))}
          />
        }
      />
    </SettingsSection>
  );
}
