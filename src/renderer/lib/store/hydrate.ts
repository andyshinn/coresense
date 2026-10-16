import {
  DEFAULT_AUTO_ADD_CONFIG,
  DEFAULT_DEVICE_CAPABILITIES,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_GPS_CONFIG,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_MAP_TILE_STATUS,
  DEFAULT_SYNC_PROGRESS,
  DEFAULT_TELEMETRY_POLICY,
  type StateSnapshot,
} from '../../../shared/types';
import { setRendererLogLevel } from '../logger';
import { groupMessagesByKey } from './conversations';
import type { SliceCreator } from './coreState';
import { mergeHydratedPackets, migratePacketLogFilter } from './packets';

/** Loading the boot snapshot. The one action that writes every slice. */
export interface HydrateSlice {
  // Hydration helpers
  hydrate: (snapshot: StateSnapshot) => void;
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
      // Merge snapshot over defaults so any fields added to MapSettings in
      // newer builds get sensible values when reading older persisted state.
      mapSettings: { ...DEFAULT_MAP_SETTINGS, ...snapshot.mapSettings },
      mapManifest: snapshot.mapManifest,
      mapTileStatus: snapshot.mapTileStatus ?? DEFAULT_MAP_TILE_STATUS,
      ui: { ...snapshot.uiState, packetLogFilter: migratePacketLogFilter(snapshot.uiState.packetLogFilter) },
      // `??` for the same reason the fields above use it: an older main
      // serving a newer renderer during dev has no drafts in its snapshot.
      drafts: snapshot.drafts ?? {},
      packets: mergeHydratedPackets(snapshot.packets ?? [], s.packets, snapshot.uiState.packetLog.liveBufferSize),
      // Seed in-session sort from the persisted default so an existing user
      // preference takes effect immediately on launch.
      searchSort: snapshot.appSettings.search?.defaultSort ?? 'recency',
    }));
  },
});
