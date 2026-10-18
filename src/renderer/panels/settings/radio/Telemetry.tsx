import { SlidersHorizontal } from 'lucide-react';
import type { TelemetryMode, TelemetryPolicy } from '../../../../shared/types';
import { NumberSelect, Row } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { useSettingsSection } from '../useSectionDraft';

const TELEMETRY_MODE_OPTIONS = [
  { value: 0, label: 'Deny all' },
  { value: 1, label: 'Allow opt-in contacts' },
  { value: 2, label: 'Allow all' },
] satisfies { value: TelemetryMode; label: string }[];

const eqTelemetry = (a: TelemetryPolicy, b: TelemetryPolicy) => a.base === b.base && a.loc === b.loc && a.env === b.env;

export function TelemetrySection() {
  const client = useApiClient();
  const saved = useStore((s) => s.telemetryPolicy);
  const { draft, setDraft, sectionProps } = useSettingsSection({
    id: 'radio-telemetry',
    saved,
    eq: eqTelemetry,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      await api.putTelemetryPolicy(client, {
        ...useStore.getState().telemetryPolicy,
        base: d.base,
        loc: d.loc,
        env: d.env,
      });
      notify.success('Telemetry settings saved');
    },
  });

  return (
    <SettingsSection
      {...sectionProps}
      icon={SlidersHorizontal}
      title="Telemetry"
      description="Who can query telemetry from this radio."
      canSave={!!client}
    >
      <Row
        label="Base telemetry (battery, uptime)"
        changed={draft.base !== saved.base}
        control={
          <NumberSelect
            value={draft.base}
            options={TELEMETRY_MODE_OPTIONS}
            onChange={(base) => setDraft((s) => ({ ...s, base }))}
          />
        }
      />
      <Row
        label="Location telemetry"
        changed={draft.loc !== saved.loc}
        control={
          <NumberSelect
            value={draft.loc}
            options={TELEMETRY_MODE_OPTIONS}
            onChange={(loc) => setDraft((s) => ({ ...s, loc }))}
          />
        }
      />
      <Row
        label="Environmental sensors"
        changed={draft.env !== saved.env}
        control={
          <NumberSelect
            value={draft.env}
            options={TELEMETRY_MODE_OPTIONS}
            onChange={(env) => setDraft((s) => ({ ...s, env }))}
          />
        }
      />
    </SettingsSection>
  );
}
