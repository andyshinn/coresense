import { Bell } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { NumberInput, Row, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useApiClient } from '../../../lib/apiClientContext';
import { useStore } from '../../../lib/store';
import { saveApp } from '../save';
import { useSettingsSection } from '../useSectionDraft';

const eqToasts = (a: AppSettingsType, b: AppSettingsType) =>
  a.toasts.enabled === b.toasts.enabled && a.toasts.durationSec === b.toasts.durationSec;

export function ToastsSection() {
  const client = useApiClient();
  const saved = useStore((s) => s.appSettings);
  const { draft, setGroup, sectionProps } = useSettingsSection({
    id: 'app-toasts',
    saved,
    eq: eqToasts,
    onSave: (d) => saveApp(client, { toasts: d.toasts }, 'Toast settings saved'),
  });

  return (
    <SettingsSection
      {...sectionProps}
      icon={Bell}
      title="Toasts"
      description="In-app status messages shown in the bottom-right."
      canSave={!!client}
    >
      <Row
        label="Enabled"
        changed={draft.toasts.enabled !== saved.toasts.enabled}
        control={<Toggle checked={draft.toasts.enabled} onChange={(v) => setGroup('toasts', { enabled: v })} />}
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
            onChange={(v) => setGroup('toasts', { durationSec: v })}
          />
        }
      />
    </SettingsSection>
  );
}
