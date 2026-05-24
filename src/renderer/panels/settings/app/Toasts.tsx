import { Bell } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { NumberInput, Row, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from './shared';

const eqToasts = (a: AppSettingsType, b: AppSettingsType) =>
  a.toasts.enabled === b.toasts.enabled && a.toasts.durationSec === b.toasts.durationSec;

export function ToastsSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-toasts',
    saved,
    eq: eqToasts,
    onSave: (d) => saveApp(client, { toasts: d.toasts }, 'Toast settings saved'),
  });

  return (
    <SettingsSection
      id="app-toasts"
      icon={Bell}
      title="Toasts"
      description="In-app status messages shown in the bottom-right."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Enabled"
        changed={draft.toasts.enabled !== saved.toasts.enabled}
        control={
          <Toggle
            checked={draft.toasts.enabled}
            onChange={(v) => setDraft((s) => ({ ...s, toasts: { ...s.toasts, enabled: v } }))}
          />
        }
      />
      <Row
        label="Duration (seconds)"
        description="How long each toast stays visible before auto-dismissing."
        changed={draft.toasts.durationSec !== saved.toasts.durationSec}
        control={
          <NumberInput
            value={draft.toasts.durationSec}
            min={1}
            max={60}
            disabled={!draft.toasts.enabled}
            onChange={(v) => setDraft((s) => ({ ...s, toasts: { ...s.toasts, durationSec: v } }))}
          />
        }
      />
    </SettingsSection>
  );
}
