import { Radio as RadioIcon } from 'lucide-react';
import type { RadioSettings } from '../../../../shared/types';
import { NumberInput, NumberSelect, Row, Select, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import {
  BANDWIDTH_OPTIONS,
  CODING_RATE_OPTIONS,
  findMatchingPreset,
  RADIO_PRESETS,
  SPREADING_FACTOR_OPTIONS,
} from '../presets';
import { useSettingsSection } from '../useSectionDraft';

// pathHashMode is owned by the Experimental section — exclude it here so a
// concurrent edit there isn't reverted when this panel saves.
const eqRadio = (a: RadioSettings, b: RadioSettings) =>
  a.frequencyHz === b.frequencyHz &&
  a.bandwidthHz === b.bandwidthHz &&
  a.spreadingFactor === b.spreadingFactor &&
  a.codingRate === b.codingRate &&
  a.txPowerDbm === b.txPowerDbm &&
  a.repeatMode === b.repeatMode;

const PRESET_OPTIONS = [
  { value: 'custom', label: 'Custom' },
  ...RADIO_PRESETS.map((p) => ({ value: p.id, label: p.label })),
];

export function RadioSection() {
  const client = useApiClient();
  const saved = useStore((s) => s.radioSettings);
  const connected = useStore((s) => s.transportState === 'connected');
  const caps = useStore((s) => s.deviceCapabilities);

  const { draft, setDraft, sectionProps } = useSettingsSection({
    id: 'radio-radio',
    saved,
    eq: eqRadio,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      // Take pathHashMode from latest store (Experimental panel owns it) so a
      // stale draft here can't revert a recent Experimental save.
      const latestHash = useStore.getState().radioSettings.pathHashMode;
      await api.putRadioSettings(client, {
        ...d,
        pathHashMode: latestHash,
        pushToDevice: connected,
      });
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
      {...sectionProps}
      icon={RadioIcon}
      title="Radio"
      description="LoRa modulation parameters, TX power, and repeat mode. Must match peers on the same mesh."
      footnote="Changing modulation re-keys the radio; reachable peers may need to refresh."
      canSave={!!client}
    >
      <Row
        label="Preset"
        description={matchedPreset ? matchedPreset.label : 'Custom (no matching preset)'}
        control={<Select<string> value={matchedPreset?.id ?? 'custom'} options={PRESET_OPTIONS} onChange={choosePreset} />}
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
          <NumberSelect
            value={draft.bandwidthHz}
            options={BANDWIDTH_OPTIONS}
            onChange={(bandwidthHz) => setDraft((d) => ({ ...d, bandwidthHz }))}
          />
        }
      />
      <Row
        label="Spreading Factor"
        changed={draft.spreadingFactor !== saved.spreadingFactor}
        control={
          <NumberSelect
            value={draft.spreadingFactor}
            options={SPREADING_FACTOR_OPTIONS}
            onChange={(spreadingFactor) => setDraft((d) => ({ ...d, spreadingFactor }))}
          />
        }
      />
      <Row
        label="Coding Rate"
        changed={draft.codingRate !== saved.codingRate}
        control={
          <NumberSelect
            value={draft.codingRate}
            options={CODING_RATE_OPTIONS}
            onChange={(codingRate) => setDraft((d) => ({ ...d, codingRate }))}
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
        warning={draft.repeatMode ? 'Increases airtime and battery drain — only enable on a fixed power supply.' : undefined}
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
