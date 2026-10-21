import { canonicalActiveKey, canonicalActiveKeys } from '../../../shared/keys';
import {
  DEFAULT_AUTO_ADD_CONFIG,
  DEFAULT_DEVICE_CAPABILITIES,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_GPS_CONFIG,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_MAP_TILE_STATUS,
  DEFAULT_RADIO_LIMITS,
  DEFAULT_SYNC_PROGRESS,
  DEFAULT_TELEMETRY_POLICY,
  EMPTY_NODE_CACHE,
  type StateSnapshot,
} from '../../../shared/types';
import { setRendererLogLevel } from '../logger';
import { groupMessagesByKey } from './conversations';
import type { SliceCreator } from './coreState';
import { mergeHydratedPackets, migratePacketLogFilter } from './packets';

/** Snapshot fields hydrate falls back to a default for. The current main
 *  always sends them, which is why StateSnapshot keeps them required (main's
 *  route is type-checked to include them). But during development a newer
 *  renderer can load against an older main that predates some of them, and
 *  hydrate tolerates that rather than crashing on boot. */
type DevSkewField =
  | 'syncProgress'
  | 'channelPresence'
  | 'discoveredContacts'
  | 'macros'
  | 'deviceIdentity'
  | 'autoAddConfig'
  | 'telemetryPolicy'
  | 'gpsConfig'
  | 'deviceInfo'
  | 'deviceCapabilities'
  | 'mapTileStatus'
  | 'drafts'
  | 'packets';

/** The snapshot as hydrate accepts it: a StateSnapshot whose DevSkewField
 *  members may be absent. Only those top-level fields — nested objects are
 *  taken as typed (mapSettings is merged over its defaults regardless). */
export type HydrateSnapshot = Omit<StateSnapshot, DevSkewField> & Partial<Pick<StateSnapshot, DevSkewField>>;

/** Loading the boot snapshot. The one action that writes every slice. */
export interface HydrateSlice {
  // Hydration helpers
  hydrate: (snapshot: HydrateSnapshot) => void;
}

export const createHydrateSlice: SliceCreator<HydrateSlice> = (set) => ({
  hydrate: (snapshot) => {
    setRendererLogLevel(snapshot.appSettings.logging.level);
    set((s) => ({
      transportState: snapshot.transport.state,
      connectedDeviceId: snapshot.transport.deviceId,
      syncProgress: snapshot.syncProgress ?? DEFAULT_SYNC_PROGRESS,
      bridge: snapshot.bridge,
      owner: snapshot.owner,
      channels: snapshot.channels,
      channelPresence: new Set(snapshot.channelPresence ?? []),
      contacts: snapshot.contacts,
      discovered: snapshot.discoveredContacts ?? [],
      macros: snapshot.macros ?? [],
      messagesByKey: groupMessagesByKey(snapshot.messages),
      capabilities: snapshot.capabilities,
      appSettings: snapshot.appSettings,
      blockRules: snapshot.blockRules,
      radioSettings: snapshot.radioSettings,
      deviceIdentity: snapshot.deviceIdentity ?? DEFAULT_DEVICE_IDENTITY,
      autoAddConfig: snapshot.autoAddConfig ?? DEFAULT_AUTO_ADD_CONFIG,
      telemetryPolicy: snapshot.telemetryPolicy ?? DEFAULT_TELEMETRY_POLICY,
      gpsConfig: snapshot.gpsConfig ?? DEFAULT_GPS_CONFIG,
      deviceInfo: snapshot.deviceInfo ?? DEFAULT_DEVICE_INFO,
      deviceCapabilities: snapshot.deviceCapabilities ?? DEFAULT_DEVICE_CAPABILITIES,
      radioLimits: snapshot.radioLimits ?? DEFAULT_RADIO_LIMITS,
      nodeCache: snapshot.nodeCache ?? EMPTY_NODE_CACHE,
      // Merge snapshot over defaults so any fields added to MapSettings in
      // newer builds get sensible values when reading older persisted state.
      mapSettings: { ...DEFAULT_MAP_SETTINGS, ...snapshot.mapSettings },
      mapManifest: snapshot.mapManifest,
      mapTileStatus: snapshot.mapTileStatus ?? DEFAULT_MAP_TILE_STATUS,
      ui: {
        ...snapshot.uiState,
        // Retired tool keys (shared/keys.ts) land where they moved.
        activeKey: canonicalActiveKey(snapshot.uiState.activeKey),
        recentKeys: canonicalActiveKeys(snapshot.uiState.recentKeys),
        pinned: canonicalActiveKeys(snapshot.uiState.pinned),
        packetLogFilter: migratePacketLogFilter(snapshot.uiState.packetLogFilter),
      },
      // `??` for the same reason the fields above use it (see DevSkewField):
      // an older main serving a newer renderer during dev has no drafts in its
      // snapshot.
      drafts: snapshot.drafts ?? {},
      packets: mergeHydratedPackets(snapshot.packets ?? [], s.packets, snapshot.uiState.packetLog.liveBufferSize),
      // Seed in-session sort from the persisted default so an existing user
      // preference takes effect immediately on launch.
      searchSort: snapshot.appSettings.search.defaultSort,
      telemetryInFlight: snapshot.telemetryInFlight ?? [],
      // Saves pushed while we weren't listening are missing from the lists we
      // hold, so let mounted panels refetch. The lists stay to avoid a flash.
      telemetryLoaded: {},
    }));
  },
});
