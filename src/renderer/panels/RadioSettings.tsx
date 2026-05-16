import { useEffect, useMemo, useState } from 'react';
import type { RadioSettings as RadioSettingsType } from '../../shared/types';
import {
  NumberInput,
  PanelShell,
  Row,
  Section,
  Select,
  Toggle,
} from '../components/settings/Field';
import { type ApiClient, api } from '../lib/api';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';

// Region presets pulled from common MeshCore regional defaults. The actual
// allowed frequency depends on local regulations — these are starting points,
// users tune from there.
const REGION_PRESETS: Record<string, RadioSettingsType> = {
  'US-915': {
    frequencyHz: 910_525_000,
    bandwidthHz: 62_500,
    spreadingFactor: 7,
    codingRate: 5,
    txPowerDbm: 20,
    repeatMode: false,
    pathHashMode: 2,
  },
  'EU-868': {
    frequencyHz: 869_525_000,
    bandwidthHz: 62_500,
    spreadingFactor: 8,
    codingRate: 5,
    txPowerDbm: 14,
    repeatMode: false,
    pathHashMode: 2,
  },
  'AU-915': {
    frequencyHz: 915_700_000,
    bandwidthHz: 62_500,
    spreadingFactor: 7,
    codingRate: 5,
    txPowerDbm: 20,
    repeatMode: false,
    pathHashMode: 2,
  },
} as const;

type RegionId = keyof typeof REGION_PRESETS | 'custom';

const BANDWIDTH_OPTIONS = [
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
] as const;

const SPREADING_FACTOR_OPTIONS = [
  { value: '7', label: 'SF7 (fastest)' },
  { value: '8', label: 'SF8' },
  { value: '9', label: 'SF9' },
  { value: '10', label: 'SF10' },
  { value: '11', label: 'SF11' },
  { value: '12', label: 'SF12 (longest range)' },
] as const;

const CODING_RATE_OPTIONS = [
  { value: '5', label: '4/5' },
  { value: '6', label: '4/6' },
  { value: '7', label: '4/7' },
  { value: '8', label: '4/8' },
] as const;

interface Props {
  client: ApiClient | null;
}

// Radio params editor with stage-and-apply (no auto-save — these are
// expensive to apply and the user should commit deliberately).
export function RadioSettings({ client }: Props) {
  const settings = useStore((s) => s.radioSettings);
  const applyRadioSettings = useStore((s) => s.applyRadioSettings);
  const [draft, setDraft] = useState<RadioSettingsType>(settings);

  // Sync the draft when the canonical state moves AND the user isn't currently
  // diverging from it; otherwise stomping over their in-progress edits.
  useEffect(() => {
    setDraft((prev) => (sameAs(prev, settings) ? prev : prev === settings ? settings : prev));
  }, [settings]);

  const dirty = useMemo(() => !sameAs(draft, settings), [draft, settings]);

  // Detect which preset matches the draft (if any), so the Region dropdown
  // shows the right label when the user opens the panel.
  const matchedRegion = useMemo<RegionId>(() => {
    for (const [id, preset] of Object.entries(REGION_PRESETS)) {
      if (sameAs(preset, draft)) return id as RegionId;
    }
    return 'custom';
  }, [draft]);

  const apply = async () => {
    if (!client) return;
    try {
      await api.putRadioSettings(client, draft);
      applyRadioSettings(draft);
      notify.success('Radio settings saved (app-side)');
    } catch (err) {
      notify.error(`Save failed: ${(err as Error).message}`, err);
    }
  };

  const revert = () => setDraft(settings);

  const usePreset = (id: RegionId) => {
    if (id === 'custom') return;
    setDraft({ ...REGION_PRESETS[id] });
  };

  return (
    <PanelShell
      title="Radio Settings"
      description="LoRa modulation params and TX power."
      actions={
        <>
          <button
            type="button"
            onClick={revert}
            disabled={!dirty}
            className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text-muted hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Revert
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!dirty || !client}
            className="rounded border border-cs-accent bg-cs-accent px-2 py-0.5 text-[12px] font-medium text-cs-bg-1 hover:bg-cs-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply
          </button>
        </>
      }
    >
      <div className="rounded border border-cs-border bg-cs-bg-2 px-3 py-2 text-[11px] text-cs-text-dim my-3">
        Saved app-side only — pushing these to the radio over the wire (CMD_SET_RADIO_PARAMS) is not
        yet implemented. Changes take effect on devices that read settings via the proxy.
      </div>

      <Section title="Region preset">
        <Row
          label="Region"
          description="Choosing a preset overwrites the four modulation fields below; 'Custom' leaves them alone."
          control={
            <Select<RegionId>
              value={matchedRegion}
              options={[
                { value: 'US-915', label: 'US-915 (FCC)' },
                { value: 'EU-868', label: 'EU-868 (ETSI)' },
                { value: 'AU-915', label: 'AU-915 (ACMA)' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={usePreset}
            />
          }
        />
      </Section>

      <Section title="Modulation">
        <Row
          label="Frequency"
          description="Hz, on-channel center frequency."
          control={
            <NumberInput
              value={draft.frequencyHz}
              min={100_000_000}
              max={2_500_000_000}
              step={25_000}
              suffix="Hz"
              width="w-36"
              onChange={(v) => setDraft((d) => ({ ...d, frequencyHz: v }))}
            />
          }
        />
        <Row
          label="Bandwidth"
          description="Wider = faster but less sensitive. 62.5 kHz is the MeshCore default."
          control={
            <Select<string>
              value={String(draft.bandwidthHz)}
              options={BANDWIDTH_OPTIONS}
              onChange={(v) => setDraft((d) => ({ ...d, bandwidthHz: Number(v) }))}
            />
          }
        />
        <Row
          label="Spreading factor"
          description="Higher = more range but slower and more airtime."
          control={
            <Select<string>
              value={String(draft.spreadingFactor)}
              options={SPREADING_FACTOR_OPTIONS}
              onChange={(v) => setDraft((d) => ({ ...d, spreadingFactor: Number(v) }))}
            />
          }
        />
        <Row
          label="Coding rate"
          description="4/5 is the typical MeshCore setting; higher denominators add FEC overhead."
          control={
            <Select<string>
              value={String(draft.codingRate)}
              options={CODING_RATE_OPTIONS}
              onChange={(v) => setDraft((d) => ({ ...d, codingRate: Number(v) }))}
            />
          }
        />
      </Section>

      <Section title="Transmit">
        <Row
          label="TX power"
          description="dBm. Regional regulations cap the legal max (typically 20 dBm in US-915, 14 dBm in EU-868)."
          control={
            <NumberInput
              value={draft.txPowerDbm}
              min={-3}
              max={22}
              step={1}
              suffix="dBm"
              onChange={(v) => setDraft((d) => ({ ...d, txPowerDbm: v }))}
            />
          }
        />
        <Row
          label="Repeat mode"
          description="When on, this radio rebroadcasts floods it hears — turning it into a repeater."
          warning={
            draft.repeatMode
              ? 'Drains battery and increases airtime; only enable on a fixed power supply.'
              : undefined
          }
          control={
            <Toggle
              checked={draft.repeatMode}
              onChange={(v) => setDraft((d) => ({ ...d, repeatMode: v }))}
            />
          }
        />
      </Section>
    </PanelShell>
  );
}

function sameAs(a: RadioSettingsType, b: RadioSettingsType): boolean {
  return (
    a.frequencyHz === b.frequencyHz &&
    a.bandwidthHz === b.bandwidthHz &&
    a.spreadingFactor === b.spreadingFactor &&
    a.codingRate === b.codingRate &&
    a.txPowerDbm === b.txPowerDbm &&
    a.repeatMode === b.repeatMode
  );
}
