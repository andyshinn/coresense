import { SlidersHorizontal } from 'lucide-react';
import type { TelemetryPolicy } from '../../../../shared/types';
import { Row, Select } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { useSettingsSection } from '../useSectionDraft';
import type { SectionProps } from './shared';

const TELEMETRY_MODE_OPTIONS = [
  { value: '0', label: 'Deny all' },
  { value: '1', label: 'Allow opt-in contacts' },
  { value: '2', label: 'Allow all' },
] as const;

const eqTelemetry = (a: TelemetryPolicy, b: TelemetryPolicy) => a.base === b.base && a.loc === b.loc && a.env === b.env;

export function TelemetrySection({ client }: SectionProps) {
  const saved = useStore((s) => s.telemetryPolicy);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
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
      id="radio-telemetry"
      icon={SlidersHorizontal}
      title="Telemetry"
      description="Who can query telemetry from this radio."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Base telemetry (battery, uptime)"
        changed={draft.base !== saved.base}
        control={
          <Select<string>
            value={String(draft.base)}
            options={TELEMETRY_MODE_OPTIONS}
            onChange={(v) => setDraft((s) => ({ ...s, base: Number(v) as TelemetryPolicy['base'] }))}
          />
        }
      />
      <Row
        label="Location telemetry"
        changed={draft.loc !== saved.loc}
        control={
          <Select<string>
            value={String(draft.loc)}
            options={TELEMETRY_MODE_OPTIONS}
            onChange={(v) => setDraft((s) => ({ ...s, loc: Number(v) as TelemetryPolicy['loc'] }))}
          />
        }
      />
      <Row
        label="Environmental sensors"
        changed={draft.env !== saved.env}
        control={
          <Select<string>
            value={String(draft.env)}
            options={TELEMETRY_MODE_OPTIONS}
            onChange={(v) => setDraft((s) => ({ ...s, env: Number(v) as TelemetryPolicy['env'] }))}
          />
        }
      />
    </SettingsSection>
  );
}
