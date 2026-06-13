import { Send } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { Row, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from './shared';

const eqComposer = (a: AppSettingsType, b: AppSettingsType) =>
  a.composer.returnToSend === b.composer.returnToSend && a.composer.autoFocus === b.composer.autoFocus;

export function ComposerSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-composer',
    saved,
    eq: eqComposer,
    onSave: (d) => saveApp(client, { composer: d.composer }, 'Composer settings saved'),
  });

  return (
    <SettingsSection
      id="app-composer"
      icon={Send}
      title="Composer"
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Return sends, Shift-Return inserts newline"
        description="Off makes Return insert a newline and Cmd-Return send."
        changed={draft.composer.returnToSend !== saved.composer.returnToSend}
        control={
          <Toggle
            checked={draft.composer.returnToSend}
            onChange={(v) => setDraft((s) => ({ ...s, composer: { ...s.composer, returnToSend: v } }))}
          />
        }
      />
      <Row
        label="Focus message field on navigate"
        description="Place the cursor in the message field when you open a channel or DM, so you can start typing right away."
        changed={draft.composer.autoFocus !== saved.composer.autoFocus}
        control={
          <Toggle
            checked={draft.composer.autoFocus}
            onChange={(v) => setDraft((s) => ({ ...s, composer: { ...s.composer, autoFocus: v } }))}
          />
        }
      />
    </SettingsSection>
  );
}
