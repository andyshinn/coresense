import { MapPin } from 'lucide-react';
import type { GpsConfig } from '../../../../shared/types';
import { NumberInput, Row, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { useSettingsSection } from '../useSectionDraft';
import type { SectionProps } from './shared';

const eqGps = (a: GpsConfig, b: GpsConfig) =>
  a.enabled === b.enabled && a.intervalSec === b.intervalSec;

export function PositionSection({ client }: SectionProps) {
  const saved = useStore((s) => s.gpsConfig);
  const connected = useStore((s) => s.transportState === 'connected');
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'radio-position',
    saved,
    eq: eqGps,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      await api.putGpsConfig(client, d);
      notify.success('Position settings saved');
    },
  });

  return (
    <SettingsSection
      id="radio-position"
      icon={MapPin}
      title="Position"
      description="On-device GPS module configuration."
      dirty={dirty}
      saving={saving}
      canSave={!!client && connected}
      onSave={save}
    >
      <Row
        label="GPS enabled"
        description="Power on the GPS receiver. Only relevant if your board has one."
        changed={draft.enabled !== saved.enabled}
        control={
          <Toggle
            checked={draft.enabled}
            disabled={!connected}
            onChange={(enabled) => setDraft((s) => ({ ...s, enabled }))}
          />
        }
      />
      <Row
        label="Update interval"
        description="Seconds between fixes. Allowed range 60..86399."
        changed={draft.intervalSec !== saved.intervalSec}
        control={
          <NumberInput
            value={draft.intervalSec}
            min={60}
            max={86399}
            step={60}
            suffix="s"
            disabled={!connected}
            onChange={(intervalSec) => setDraft((s) => ({ ...s, intervalSec }))}
          />
        }
      />
    </SettingsSection>
  );
}
