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
  a.radioMaxHops === b.radioMaxHops &&
  a.autoRefreshContacts === b.autoRefreshContacts &&
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
        description="All adds every received advert; Selected only adds the kinds you tick below. To add nothing automatically, choose Selected and untick all four."
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
        description="The radio ignores adverts heard over more hops than this. Leave 0 for no limit."
        changed={draft.radioMaxHops !== saved.radioMaxHops}
        control={
          <NumberInput
            value={draft.radioMaxHops}
            min={0}
            max={63}
            onChange={(radioMaxHops) => setDraft((s) => ({ ...s, radioMaxHops }))}
          />
        }
      />
      <Row
        label="Auto-refresh contacts"
        description="Off by default. When on, re-reads the radio's whole contact list every 15 minutes while connected — tens of seconds of companion-link traffic each time. The Contacts panel's refresh button does it on demand instead."
        changed={draft.autoRefreshContacts !== saved.autoRefreshContacts}
        control={
          <Toggle
            checked={draft.autoRefreshContacts}
            onChange={(autoRefreshContacts) => setDraft((s) => ({ ...s, autoRefreshContacts }))}
          />
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
