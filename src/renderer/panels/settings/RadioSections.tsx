import {
  Bluetooth,
  Contact as ContactIcon,
  Info,
  KeyRound,
  MapPin,
  Radio as RadioIcon,
  Send,
  SlidersHorizontal,
  UserCircle,
} from 'lucide-react';
import { useMemo } from 'react';
import type {
  AutoAddConfig,
  DeviceIdentity,
  GpsConfig,
  RadioSettings,
  TelemetryPolicy,
} from '../../../shared/types';
import { NumberInput, Row, Select, TextInput, Toggle } from '../../components/settings/Field';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { findMatchingPreset, RADIO_PRESETS } from './presets';
import { useSettingsSection } from './useSectionDraft';

// The Radio-tab sections. Unlike the App tab, each editable section maps to its
// own store slice + API endpoint. Messages and Telemetry both edit disjoint
// fields of `telemetryPolicy`, so each compares only its own fields and merges
// onto the freshest store value on Save.

interface SectionProps {
  client: ApiClient | null;
}

// ─── Public Info (deviceIdentity) ────────────────────────────────────
interface PublicInfoDraft {
  name: string;
  latText: string;
  lonText: string;
  share: boolean;
}
const eqPublicInfo = (a: PublicInfoDraft, b: PublicInfoDraft) =>
  a.name === b.name && a.latText === b.latText && a.lonText === b.lonText && a.share === b.share;

export function PublicInfoSection({ client }: SectionProps) {
  const identity = useStore((s) => s.deviceIdentity);
  const owner = useStore((s) => s.owner);
  const connected = useStore((s) => s.transportState === 'connected');

  const saved = useMemo<PublicInfoDraft>(
    () => ({
      name: identity.name || owner?.name || '',
      latText: identity.lat?.toString() ?? '',
      lonText: identity.lon?.toString() ?? '',
      share: identity.sharePositionInAdvert,
    }),
    [identity.name, identity.lat, identity.lon, identity.sharePositionInAdvert, owner?.name],
  );

  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'radio-public-info',
    saved,
    eq: eqPublicInfo,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      const patch: Partial<DeviceIdentity> = { name: d.name, sharePositionInAdvert: d.share };
      if (d.latText.trim() || d.lonText.trim()) {
        const lat = Number(d.latText);
        const lon = Number(d.lonText);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          throw new Error('Latitude and longitude must be numbers');
        }
        patch.lat = lat;
        patch.lon = lon;
      }
      await api.putDeviceIdentity(client, patch);
      notify.success(connected ? 'Public info saved to radio' : 'Public info saved app-side');
    },
  });

  const pubKey =
    identity.publicKeyHex || owner?.publicKeyHex || '(connect a radio to see public key)';

  return (
    <SettingsSection
      id="radio-public-info"
      icon={UserCircle}
      title="Public Info"
      description="What the radio advertises about itself — name and position."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Name"
        description="Display name peers see in adverts and messages. ≤31 bytes UTF-8."
        changed={draft.name !== saved.name}
        control={
          <TextInput
            value={draft.name}
            disabled={!client}
            onChange={(name) => setDraft((s) => ({ ...s, name }))}
          />
        }
      />
      <Row
        label="Public key"
        description="Full Ed25519 public key. Share with peers to add you as a contact."
        control={
          <span className="font-mono text-[11px] text-cs-text-dim">
            {pubKey.length > 24 ? `${pubKey.slice(0, 12)}…${pubKey.slice(-12)}` : pubKey}
          </span>
        }
      />
      <Row
        label="Latitude"
        description="Decimal degrees, WGS84."
        changed={draft.latText !== saved.latText}
        control={
          <TextInput
            value={draft.latText}
            disabled={!client}
            onChange={(latText) => setDraft((s) => ({ ...s, latText }))}
          />
        }
      />
      <Row
        label="Longitude"
        description="Decimal degrees, WGS84."
        changed={draft.lonText !== saved.lonText}
        control={
          <TextInput
            value={draft.lonText}
            disabled={!client}
            onChange={(lonText) => setDraft((s) => ({ ...s, lonText }))}
          />
        }
      />
      <Row
        label="Share position in advert"
        description="Include lat/lon in self-adverts so other nodes can place you on the map."
        changed={draft.share !== saved.share}
        control={
          <Toggle
            checked={draft.share}
            disabled={!client}
            onChange={(share) => setDraft((s) => ({ ...s, share }))}
          />
        }
      />
    </SettingsSection>
  );
}

// ─── Radio (radioSettings) ───────────────────────────────────────────
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

// ─── Identity Key (read-only) ────────────────────────────────────────
export function IdentityKeySection() {
  const caps = useStore((s) => s.deviceCapabilities);
  return (
    <SettingsSection
      id="radio-identity-key"
      icon={KeyRound}
      title="Identity Key"
      description="Export/import the device's Ed25519 private key for migration."
      dirty={false}
    >
      <div className="mb-2 rounded border border-cs-warn/40 bg-cs-warn/10 px-3 py-2 text-[11px] text-cs-text">
        WARNING: Your private identity key should be kept secret. It's used to encrypt and decrypt
        the messages you send and receive.
      </div>
      <Row
        label="Export"
        description="Reveals and copies the device's private key to the clipboard."
        control={
          <button
            type="button"
            disabled
            title="Pending firmware ≥ 1.7.0 capability check + CLI plumbing"
            className="cursor-not-allowed rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text-dim opacity-60"
          >
            Export Private Key
          </button>
        }
      />
      <Row
        label="Import"
        description="Paste a 64-character hex private key to replace the device's identity."
        control={
          <button
            type="button"
            disabled
            title="Pending firmware ≥ 1.7.0 capability check + CLI plumbing"
            className="cursor-not-allowed rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text-dim opacity-60"
          >
            Import Private Key
          </button>
        }
      />
      {!caps.identityKeyIO && (
        <p className="px-2 pt-1 text-[11px] italic text-cs-text-dim">
          Companion firmware v1.7.0+ is required to import and export your identity key. This radio
          reports an older firmware.
        </p>
      )}
    </SettingsSection>
  );
}

// ─── Bluetooth (read-only) ───────────────────────────────────────────
export function BluetoothSection() {
  return (
    <SettingsSection
      id="radio-bluetooth"
      icon={Bluetooth}
      title="Bluetooth"
      description="BLE pairing behavior."
      dirty={false}
    >
      <div className="mb-2 rounded border border-cs-border bg-cs-bg-2 px-3 py-2 text-[11px] text-cs-text-dim">
        If you forget your bluetooth pin you will need to flash the USB firmware to reset it.
      </div>
      <Row
        label="Bluetooth PIN Type"
        description="Not yet supported over BLE — set this via the official mobile app or a USB CLI session."
        control={
          <Select<string>
            value="random"
            disabled
            options={[
              { value: 'random', label: 'Random (screen required)' },
              { value: 'fixed', label: 'Fixed' },
              { value: 'none', label: 'None' },
            ]}
            onChange={() => undefined}
          />
        }
      />
    </SettingsSection>
  );
}

// ─── Contacts · Auto-add (autoAddConfig) ─────────────────────────────
const eqAutoAdd = (a: AutoAddConfig, b: AutoAddConfig) =>
  a.mode === b.mode &&
  a.chat === b.chat &&
  a.repeater === b.repeater &&
  a.room === b.room &&
  a.sensor === b.sensor &&
  a.overwriteOldest === b.overwriteOldest &&
  a.maxHops === b.maxHops &&
  a.pullToRefresh === b.pullToRefresh &&
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
        description="All adds every received advert; Selected only adds the kinds you tick below."
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
        description="Adverts with more hops than this are ignored. Leave 0 for no limit."
        changed={(draft.maxHops ?? 0) !== (saved.maxHops ?? 0)}
        control={
          <NumberInput
            value={draft.maxHops ?? 0}
            min={0}
            max={63}
            onChange={(v) => setDraft((s) => ({ ...s, maxHops: v === 0 ? null : v }))}
          />
        }
      />
      <Row
        label="Pull to refresh"
        changed={draft.pullToRefresh !== saved.pullToRefresh}
        control={
          <Toggle
            checked={draft.pullToRefresh}
            onChange={(pullToRefresh) => setDraft((s) => ({ ...s, pullToRefresh }))}
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

// ─── Messages (telemetryPolicy.multiAcks) ────────────────────────────
const eqMessages = (a: TelemetryPolicy, b: TelemetryPolicy) => a.multiAcks === b.multiAcks;

export function MessageSection({ client }: SectionProps) {
  const saved = useStore((s) => s.telemetryPolicy);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'radio-messages',
    saved,
    eq: eqMessages,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      await api.putTelemetryPolicy(client, {
        ...useStore.getState().telemetryPolicy,
        multiAcks: d.multiAcks,
      });
      notify.success('Message settings saved');
    },
  });

  return (
    <SettingsSection
      id="radio-messages"
      icon={Send}
      title="Messages"
      description="Send/receive reliability behaviour."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Direct Message Acks"
        description="Number of duplicate acks the radio emits per inbound DM. Higher = more reliable delivery reports at the cost of airtime."
        changed={draft.multiAcks !== saved.multiAcks}
        control={
          <Select<string>
            value={String(draft.multiAcks)}
            options={[
              { value: '0', label: '0' },
              { value: '1', label: '1' },
              { value: '2', label: '2' },
            ]}
            onChange={(v) => setDraft((s) => ({ ...s, multiAcks: Number(v) }))}
          />
        }
      />
      <Row
        label="Auto Retry"
        description="Direct messages retry up to 5 times with the known path, then 3 more as floods."
        control={<Toggle checked disabled onChange={() => undefined} />}
      />
      <Row
        label="Auto Reset Path"
        description="If retry keeps failing, drop the known path and try as a flood. Built into our retry pipeline."
        control={<Toggle checked disabled onChange={() => undefined} />}
      />
    </SettingsSection>
  );
}

// ─── Position (gpsConfig) ────────────────────────────────────────────
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

// ─── Telemetry (telemetryPolicy.base/loc/env) ────────────────────────
const TELEMETRY_MODE_OPTIONS = [
  { value: '0', label: 'Deny all' },
  { value: '1', label: 'Allow opt-in contacts' },
  { value: '2', label: 'Allow all' },
] as const;

const eqTelemetry = (a: TelemetryPolicy, b: TelemetryPolicy) =>
  a.base === b.base && a.loc === b.loc && a.env === b.env;

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
            onChange={(v) =>
              setDraft((s) => ({ ...s, base: Number(v) as TelemetryPolicy['base'] }))
            }
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

// ─── Device Info (read-only + Refresh) ───────────────────────────────
export function DeviceInfoSection({ client }: SectionProps) {
  const info = useStore((s) => s.deviceInfo);
  const channels = useStore((s) => s.channels.length);
  const contacts = useStore((s) => s.contacts.length);
  const connected = useStore((s) => s.transportState === 'connected');

  const storagePct =
    info.storageTotalKb > 0 ? Math.round((info.storageUsedKb / info.storageTotalKb) * 100) : 0;

  const refresh = async () => {
    if (!client) return;
    try {
      await api.refreshDevice(client);
      notify.success('Device refresh requested');
    } catch (err) {
      notify.error(`Refresh failed: ${(err as Error).message}`, err);
    }
  };

  return (
    <SettingsSection
      id="radio-device-info"
      icon={Info}
      title="Device Info"
      description="Read-only snapshot of the connected radio."
      dirty={false}
    >
      <Row
        label="Device model"
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {info.deviceModel || '(unknown)'}
          </span>
        }
      />
      <Row
        label="Firmware version code"
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {info.firmwareVerCode || '(unknown)'}
          </span>
        }
      />
      <Row
        label="Channels"
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {channels}/{info.maxChannels || '?'}
          </span>
        }
      />
      <Row
        label="Contacts"
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {contacts}/{info.maxContacts || '?'}
          </span>
        }
      />
      <Row
        label="Storage"
        description={`${storagePct}% used`}
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {info.storageUsedKb}kb / {info.storageTotalKb || '?'}kb
          </span>
        }
      />
      <Row
        label="Battery"
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {info.batteryMv > 0 ? `${(info.batteryMv / 1000).toFixed(2)} V` : '—'}
          </span>
        }
      />
      <Row
        label="Refresh snapshot"
        description="Re-issues DEVICE_QUERY + GET_BATT_AND_STORAGE + GET_AUTO_ADD_CONFIG + GPS custom vars."
        control={
          <button
            type="button"
            onClick={refresh}
            disabled={!client || !connected}
            className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />
    </SettingsSection>
  );
}
