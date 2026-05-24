import { Radio as RadioIcon } from 'lucide-react';
import type { RadioSettings } from '../../../../shared/types';
import { NumberInput, Row, Select, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { findMatchingPreset, RADIO_PRESETS } from '../presets';
import { useSettingsSection } from '../useSectionDraft';
import type { SectionProps } from './shared';

const eqRadio = (a: RadioSettings, b: RadioSettings) =>
  a.frequencyHz === b.frequencyHz &&
  a.bandwidthHz === b.bandwidthHz &&
  a.spreadingFactor === b.spreadingFactor &&
  a.codingRate === b.codingRate &&
  a.txPowerDbm === b.txPowerDbm &&
  a.repeatMode === b.repeatMode &&
  a.pathHashMode === b.pathHashMode;

export function RadioSection({ client }: SectionProps) {
  const saved = useStore((s) => s.radioSettings);
  const connected = useStore((s) => s.transportState === 'connected');
  const caps = useStore((s) => s.deviceCapabilities);

  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'radio-radio',
    saved,
    eq: eqRadio,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      await api.putRadioSettings(client, { ...d, pushToDevice: connected });
      notify.success(connected ? 'Radio params pushed to device' : 'Radio params saved app-side');
    },
  });

  const matchedPreset = findMatchingPreset(draft);
  const choosePreset = (id: string) => {
    const p = RADIO_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setDraft((d) => ({
      ...d,
      frequencyHz: p.frequencyHz,
      bandwidthHz: p.bandwidthHz,
      spreadingFactor: p.spreadingFactor,
      codingRate: p.codingRate,
      txPowerDbm: p.txPowerDbm,
    }));
  };

  return (
    <SettingsSection
      id="radio-radio"
      icon={RadioIcon}
      title="Radio"
      description="LoRa modulation parameters, TX power, and repeat mode. Must match peers on the same mesh."
      footnote="Changing modulation re-keys the radio; reachable peers may need to refresh."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Preset"
        description={matchedPreset ? matchedPreset.label : 'Custom (no matching preset)'}
        control={
          <Select<string>
            value={matchedPreset?.id ?? 'custom'}
            options={[
              { value: 'custom', label: 'Custom' },
              ...RADIO_PRESETS.map((p) => ({ value: p.id, label: p.label })),
            ]}
            onChange={choosePreset}
          />
        }
      />
      <Row
        label="Frequency"
        changed={draft.frequencyHz !== saved.frequencyHz}
        control={
          <NumberInput
            value={draft.frequencyHz}
            min={100_000_000}
            max={2_500_000_000}
            step={25_000}
            suffix="Hz"
            width="w-40"
            onChange={(v) => setDraft((d) => ({ ...d, frequencyHz: v }))}
          />
        }
      />
      <Row
        label="Bandwidth"
        changed={draft.bandwidthHz !== saved.bandwidthHz}
        control={
          <Select<string>
            value={String(draft.bandwidthHz)}
            options={[
              { value: '7800', label: '7.8 kHz' },
              { value: '10400', label: '10.4 kHz' },
              { value: '15600', label: '15.6 kHz' },
              { value: '20800', label: '20.8 kHz' },
              { value: '31250', label: '31.25 kHz' },
              { value: '41700', label: '41.7 kHz' },
              { value: '62500', label: '62.5 kHz' },
              { value: '125000', label: '125 kHz' },
              { value: '250000', label: '250 kHz' },
              { value: '500000', label: '500 kHz' },
            ]}
            onChange={(v) => setDraft((d) => ({ ...d, bandwidthHz: Number(v) }))}
          />
        }
      />
      <Row
        label="Spreading Factor"
        changed={draft.spreadingFactor !== saved.spreadingFactor}
        control={
          <Select<string>
            value={String(draft.spreadingFactor)}
            options={[
              { value: '7', label: 'SF7 (fastest)' },
              { value: '8', label: 'SF8' },
              { value: '9', label: 'SF9' },
              { value: '10', label: 'SF10' },
              { value: '11', label: 'SF11' },
              { value: '12', label: 'SF12 (longest range)' },
            ]}
            onChange={(v) => setDraft((d) => ({ ...d, spreadingFactor: Number(v) }))}
          />
        }
      />
      <Row
        label="Coding Rate"
        changed={draft.codingRate !== saved.codingRate}
        control={
          <Select<string>
            value={String(draft.codingRate)}
            options={[
              { value: '5', label: '4/5' },
              { value: '6', label: '4/6' },
              { value: '7', label: '4/7' },
              { value: '8', label: '4/8' },
            ]}
            onChange={(v) => setDraft((d) => ({ ...d, codingRate: Number(v) }))}
          />
        }
      />
      <Row
        label="Transmit Power (dBm)"
        description="Regulatory caps: 20 dBm US-915, 14 dBm EU-868."
        changed={draft.txPowerDbm !== saved.txPowerDbm}
        control={
          <NumberInput
            value={draft.txPowerDbm}
            min={-3}
            max={22}
            suffix="dBm"
            onChange={(v) => setDraft((d) => ({ ...d, txPowerDbm: v }))}
          />
        }
      />
      <Row
        label="Enable Repeat Mode"
        description={
          caps.repeatMode
            ? 'When on, the radio rebroadcasts floods it hears.'
            : 'Repeat mode requires firmware ver_code ≥ 9. Disabled.'
        }
        warning={
          draft.repeatMode
            ? 'Increases airtime and battery drain — only enable on a fixed power supply.'
            : undefined
        }
        changed={draft.repeatMode !== saved.repeatMode}
        control={
          <Toggle
            checked={draft.repeatMode}
            disabled={!caps.repeatMode}
            onChange={(v) => setDraft((d) => ({ ...d, repeatMode: v }))}
          />
        }
      />
    </SettingsSection>
  );
}
