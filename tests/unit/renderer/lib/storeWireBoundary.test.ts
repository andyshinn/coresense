import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import type { HydrateSnapshot } from '../../../../src/renderer/lib/store/hydrate';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_AUTO_ADD_CONFIG,
  DEFAULT_DEVICE_CAPABILITIES,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_GPS_CONFIG,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_MAP_TILE_STATUS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_SYNC_PROGRESS,
  DEFAULT_TELEMETRY_POLICY,
  DEFAULT_UI_STATE,
  type MapSettings,
  type UiStateUpdate,
} from '../../../../src/shared/types';

// The renderer tolerates exactly the gaps its wire types admit: snapshot
// fields an older main may predate (HydrateSnapshot), UiState fields a partial
// producer may omit from a broadcast (UiStateUpdate), and MapSettings fields
// an older main's broadcast may lack.

const initial = useStore.getState();

beforeEach(() => {
  useStore.setState(initial, true);
});

/** A snapshot carrying only the fields every main has always sent. */
function minimalSnapshot(): HydrateSnapshot {
  return {
    capabilities: {
      isElectron: true,
      version: '0.0.0-test',
      gitSha: 'unknown',
      electronVersion: '0',
      chromeVersion: '0',
      platform: 'darwin',
      httpPort: 0,
      configPath: '',
      logsFolder: '',
      logsCurrentFile: '',
    },
    bridge: {
      tcpPort: null,
      bindAddress: '0.0.0.0',
      lanAddress: null,
      tcpClients: 0,
      mdnsServiceName: null,
      radioConnected: false,
      portConflict: null,
    },
    transport: { state: 'idle' },
    owner: null,
    channels: [],
    contacts: [],
    messages: [],
    appSettings: DEFAULT_APP_SETTINGS,
    radioSettings: DEFAULT_RADIO_SETTINGS,
    mapSettings: DEFAULT_MAP_SETTINGS,
    mapManifest: { missing: true, basemap: null },
    uiState: structuredClone(DEFAULT_UI_STATE),
    blockRules: [],
  };
}

describe('hydrate from an older main', () => {
  it('falls back to defaults for every field such a main may predate', () => {
    useStore.getState().hydrate(minimalSnapshot());
    const s = useStore.getState();
    expect(s.syncProgress).toEqual(DEFAULT_SYNC_PROGRESS);
    expect(s.channelPresence).toEqual(new Set());
    expect(s.discovered).toEqual([]);
    expect(s.macros).toEqual([]);
    expect(s.deviceIdentity).toEqual(DEFAULT_DEVICE_IDENTITY);
    expect(s.autoAddConfig).toEqual(DEFAULT_AUTO_ADD_CONFIG);
    expect(s.telemetryPolicy).toEqual(DEFAULT_TELEMETRY_POLICY);
    expect(s.gpsConfig).toEqual(DEFAULT_GPS_CONFIG);
    expect(s.deviceInfo).toEqual(DEFAULT_DEVICE_INFO);
    expect(s.deviceCapabilities).toEqual(DEFAULT_DEVICE_CAPABILITIES);
    expect(s.mapTileStatus).toEqual(DEFAULT_MAP_TILE_STATUS);
    expect(s.drafts).toEqual({});
    expect(s.packets).toEqual([]);
    expect(s.searchSort).toBe(DEFAULT_APP_SETTINGS.search.defaultSort);
  });

  it('fills MapSettings fields the snapshot lacks from the defaults', () => {
    const { tileCacheMaxBytes: _dropped, ...older } = DEFAULT_MAP_SETTINGS;
    useStore.getState().hydrate({ ...minimalSnapshot(), mapSettings: older as MapSettings });
    expect(useStore.getState().mapSettings).toEqual(DEFAULT_MAP_SETTINGS);
  });
});

describe('applyMapSettings', () => {
  it('merges a broadcast over the defaults, as hydrate does', () => {
    const { tileCacheMaxBytes: _dropped, ...older } = { ...DEFAULT_MAP_SETTINGS, hasProtomapsApiKey: true };
    useStore.getState().applyMapSettings(older as MapSettings);
    expect(useStore.getState().mapSettings).toEqual({ ...DEFAULT_MAP_SETTINGS, hasProtomapsApiKey: true });
  });

  it('takes every field a complete broadcast carries', () => {
    const next: MapSettings = { ...DEFAULT_MAP_SETTINGS, tileCacheMaxBytes: 123 };
    useStore.getState().applyMapSettings(next);
    expect(useStore.getState().mapSettings).toEqual(next);
  });
});

describe('applyUiState from a partial producer', () => {
  it('keeps our read markers when the broadcast omits lastReadByKey', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, lastReadByKey: { 'ch:a': 5 } } });
    const partial: UiStateUpdate = { ...DEFAULT_UI_STATE, pinned: ['ch:a'] };
    delete partial.lastReadByKey;
    useStore.getState().applyUiState(partial);
    const ui = useStore.getState().ui;
    expect(ui.lastReadByKey).toEqual({ 'ch:a': 5 });
    expect(ui.pinned).toEqual(['ch:a']);
  });
});
