import type { MacroTemplate } from '../../../shared/macros/types';
import {
  type AppSettings,
  type AutoAddConfig,
  type BlockRule,
  type Capabilities,
  DEFAULT_APP_SETTINGS,
  DEFAULT_AUTO_ADD_CONFIG,
  DEFAULT_DEVICE_CAPABILITIES,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_GPS_CONFIG,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_MAP_TILE_STATUS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_TELEMETRY_POLICY,
  type DeviceCapabilities,
  type DeviceIdentity,
  type DeviceInfo,
  type GpsConfig,
  type MapSettings,
  type MapTileStatus,
  type Message,
  type RadioSettings,
  type TelemetryPolicy,
  type TileManifest,
  type UpdateState,
} from '../../../shared/types';
import { setRendererLogLevel } from '../logger';
import { telemetryRetentionOf } from '../telemetryRetention';
import type { SliceCreator } from './coreState';
import { pruneTelemetry } from './telemetry';

/** Rows main returns per history window (`byKey`'s default limit). The renderer
 *  holds more than this by design; a few places need to know the server's unit. */
const SERVER_WINDOW = 200;

const DEFAULT_MAP_MANIFEST: TileManifest = { missing: true, basemap: null };

/** Server capabilities and every settings record mirrored from main. Each is
 *  replaced wholesale by its WS broadcast. */
export interface SettingsSlice {
  // Server capabilities (version, platform, httpPort, config.json path).
  // Null until the first snapshot hydrates it.
  capabilities: Capabilities | null;

  // Settings
  appSettings: AppSettings;
  updateState: UpdateState | null;
  blockRules: BlockRule[];
  macros: MacroTemplate[];
  radioSettings: RadioSettings;
  deviceIdentity: DeviceIdentity;
  autoAddConfig: AutoAddConfig;
  telemetryPolicy: TelemetryPolicy;
  gpsConfig: GpsConfig;
  deviceInfo: DeviceInfo;
  deviceCapabilities: DeviceCapabilities;
  mapSettings: MapSettings;
  /** Snapshot of which bundled PMTiles extracts are available on disk.
   *  Pushed by the snapshot endpoint; the Map panel uses it to gate mounting
   *  MapLibre vs. showing a "missing tiles" empty-state. */
  mapManifest: TileManifest;
  mapTileStatus: MapTileStatus;

  applyAppSettings: (settings: AppSettings) => void;
  applyUpdateState: (state: UpdateState | null) => void;
  applyBlockRules: (rules: BlockRule[]) => void;
  applyMacros: (macros: MacroTemplate[]) => void;
  applyRadioSettings: (settings: RadioSettings) => void;
  applyDeviceIdentity: (identity: DeviceIdentity) => void;
  applyAutoAddConfig: (cfg: AutoAddConfig) => void;
  applyTelemetryPolicy: (policy: TelemetryPolicy) => void;
  applyGpsConfig: (cfg: GpsConfig) => void;
  applyDeviceInfo: (info: DeviceInfo) => void;
  applyDeviceCapabilities: (caps: DeviceCapabilities) => void;
  applyMapSettings: (settings: MapSettings) => void;
  applyMapManifest: (manifest: TileManifest) => void;
  applyMapTileStatus: (status: MapTileStatus) => void;
}

export const createSettingsSlice: SliceCreator<SettingsSlice> = (set) => ({
  capabilities: null,
  appSettings: DEFAULT_APP_SETTINGS,
  updateState: null,
  blockRules: [],
  macros: [],
  radioSettings: DEFAULT_RADIO_SETTINGS,
  deviceIdentity: DEFAULT_DEVICE_IDENTITY,
  autoAddConfig: DEFAULT_AUTO_ADD_CONFIG,
  telemetryPolicy: DEFAULT_TELEMETRY_POLICY,
  gpsConfig: DEFAULT_GPS_CONFIG,
  deviceInfo: DEFAULT_DEVICE_INFO,
  deviceCapabilities: DEFAULT_DEVICE_CAPABILITIES,
  mapSettings: DEFAULT_MAP_SETTINGS,
  mapManifest: DEFAULT_MAP_MANIFEST,
  mapTileStatus: DEFAULT_MAP_TILE_STATUS,

  // Also trims the telemetry slice's lists when retention shrinks.
  applyAppSettings: (settings) => {
    setRendererLogLevel(settings.logging.level);
    set((s) => {
      // Main prunes every node at once when retention shrinks and pushes a
      // telemetryDeleted per node; trimming here too keeps the lists we hold
      // from showing the extra rows in the gap before those pushes land.
      const keep = telemetryRetentionOf(settings);
      if (keep >= telemetryRetentionOf(s.appSettings)) return { appSettings: settings };
      return { appSettings: settings, ...pruneTelemetry(s, keep) };
    });
  },
  applyUpdateState: (state) => set(() => ({ updateState: state })),
  // `meta.blocked` is not stored — main computes it per read and stamps it onto
  // the history window it is about to send. That made "the next broadcast
  // repairs every row the renderer holds" true only while the renderer held
  // exactly one window. Now that applyMessages merges, rows that have scrolled
  // out of the window would keep whatever annotation they last carried: a new
  // rule would leave old messages from that sender visible (and still counting
  // toward unread badges), and deleting a rule would leave them hidden.
  //
  // Dropping back to a single window's worth restores the invariant, at the
  // cost of re-fetching history the user may have backfilled. Block-rule
  // changes are rare and deliberate; a wrong block state is not acceptable.
  // (So this writes the conversations slice's messagesByKey as well.)
  applyBlockRules: (rules) =>
    set((s) => {
      const trimmed: Record<string, Message[]> = {};
      for (const [key, list] of Object.entries(s.messagesByKey)) {
        trimmed[key] = list.length > SERVER_WINDOW ? list.slice(-SERVER_WINDOW) : list;
      }
      return { blockRules: rules, messagesByKey: trimmed };
    }),
  applyMacros: (macros) => set(() => ({ macros })),
  applyRadioSettings: (settings) => set(() => ({ radioSettings: settings })),
  applyDeviceIdentity: (identity) => set(() => ({ deviceIdentity: identity })),
  applyAutoAddConfig: (cfg) => set(() => ({ autoAddConfig: cfg })),
  applyTelemetryPolicy: (policy) => set(() => ({ telemetryPolicy: policy })),
  applyGpsConfig: (cfg) => set(() => ({ gpsConfig: cfg })),
  applyDeviceInfo: (info) => set(() => ({ deviceInfo: info })),
  applyDeviceCapabilities: (caps) => set(() => ({ deviceCapabilities: caps })),
  // Over the defaults, as hydrate does, so a broadcast from a main that
  // predates a MapSettings field still leaves that field with a usable value.
  applyMapSettings: (settings) => set(() => ({ mapSettings: { ...DEFAULT_MAP_SETTINGS, ...settings } })),
  applyMapManifest: (manifest) => set(() => ({ mapManifest: manifest })),
  applyMapTileStatus: (status) => set(() => ({ mapTileStatus: status })),
});
