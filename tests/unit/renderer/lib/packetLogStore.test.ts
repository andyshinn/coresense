import { beforeEach, describe, expect, it } from 'vitest';
import { type LivePacket, migratePacketLogFilter, useStore } from '../../../../src/renderer/lib/store';
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
  type RawPacket,
  type StateSnapshot,
  type UiState,
} from '../../../../src/shared/types';

const reset = () => useStore.setState({ packets: [], selectedPacketId: null, ui: structuredClone(DEFAULT_UI_STATE) });

beforeEach(reset);

describe('packet log store', () => {
  it('assigns a stable unique id to each applied packet', () => {
    const p: RawPacket = {
      timestamp: 1,
      transportType: 'ble',
      kind: 'mesh',
      hex: '88',
      bytes: [0x88],
      payloadHex: '15',
      payloadBytes: [0x15],
    };
    useStore.getState().applyPacket({ ...p });
    useStore.getState().applyPacket({ ...p });
    const ids = useStore.getState().packets.map((x) => x.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('caps the live buffer at liveBufferSize', () => {
    useStore.getState().setPacketLogSettings({ liveBufferSize: 3 });
    for (let i = 0; i < 6; i++)
      useStore.getState().applyPacket({
        timestamp: i,
        transportType: 'ble',
        kind: 'mesh',
        hex: '88',
        bytes: [],
        payloadHex: '',
        payloadBytes: [],
      });
    expect(useStore.getState().packets).toHaveLength(3);
  });

  it('trims the buffer immediately when liveBufferSize decreases', () => {
    for (let i = 0; i < 5; i++)
      useStore.getState().applyPacket({
        timestamp: i,
        transportType: 'ble',
        kind: 'mesh',
        hex: '88',
        bytes: [],
        payloadHex: '',
        payloadBytes: [],
      });
    useStore.getState().setPacketLogSettings({ liveBufferSize: 2 });
    expect(useStore.getState().packets).toHaveLength(2);
    expect(useStore.getState().packets.map((p) => p.timestamp)).toEqual([3, 4]);
  });

  it('migrates a legacy showCompanion filter to a source', () => {
    expect(migratePacketLogFilter({ showCompanion: true }).source).toBe('both');
    expect(migratePacketLogFilter({ showCompanion: false }).source).toBe('rf');
    expect(migratePacketLogFilter({ source: 'ble' }).source).toBe('ble');
    expect(migratePacketLogFilter({ source: 'both' }).source).toBe('both');
  });

  it('prefers a legacy showCompanion:false over a source injected by mergeDefaults', () => {
    // The real shape seen at hydrate: main's deep mergeDefaults has already
    // injected `source: 'both'` alongside the legacy key that was actually
    // persisted on disk. The user's real "hide BLE" preference must win.
    expect(migratePacketLogFilter({ source: 'both', showCompanion: false }).source).toBe('rf');
    expect(migratePacketLogFilter({ source: 'both', showCompanion: true }).source).toBe('both');
  });
});

describe('hydrate()', () => {
  it('assigns hydrated packets a pkt-* id and migrates the real merged legacy filter shape', () => {
    const packet: RawPacket = {
      timestamp: 1,
      transportType: 'ble',
      kind: 'mesh',
      hex: '88',
      bytes: [0x88],
      payloadHex: '15',
      payloadBytes: [0x15],
    };
    // The real wire shape at hydrate: main's mergeDefaults has already
    // injected `source: 'both'` alongside the legacy `showCompanion` that was
    // actually on disk (see the `migratePacketLogFilter` tests above).
    const uiState = {
      ...DEFAULT_UI_STATE,
      packetLogFilter: { source: 'both', showCompanion: false },
    } as unknown as UiState;
    const snapshot: StateSnapshot = {
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
      channelPresence: [],
      syncProgress: DEFAULT_SYNC_PROGRESS,
      contacts: [],
      discoveredContacts: [],
      messages: [],
      appSettings: DEFAULT_APP_SETTINGS,
      radioSettings: DEFAULT_RADIO_SETTINGS,
      mapSettings: DEFAULT_MAP_SETTINGS,
      mapManifest: { missing: true, basemap: null },
      mapTileStatus: DEFAULT_MAP_TILE_STATUS,
      uiState,
      drafts: {},
      deviceIdentity: DEFAULT_DEVICE_IDENTITY,
      autoAddConfig: DEFAULT_AUTO_ADD_CONFIG,
      telemetryPolicy: DEFAULT_TELEMETRY_POLICY,
      gpsConfig: DEFAULT_GPS_CONFIG,
      deviceInfo: DEFAULT_DEVICE_INFO,
      deviceCapabilities: DEFAULT_DEVICE_CAPABILITIES,
      blockRules: [],
      macros: [],
      packets: [packet],
    };

    useStore.getState().hydrate(snapshot);

    const state = useStore.getState();
    expect(state.packets).toHaveLength(1);
    expect(state.packets[0].id).toMatch(/^pkt-/);
    expect(state.ui.packetLogFilter.source).toBe('rf');
  });
});

describe('applyUiState syncs packetLog retention', () => {
  const live = (i: number): LivePacket => ({
    id: `pkt-x${i}`,
    timestamp: i,
    transportType: 'ble',
    kind: 'mesh',
    hex: '00',
    bytes: [0],
    payloadHex: '00',
    payloadBytes: [0],
  });

  beforeEach(() => {
    useStore.setState({ ui: structuredClone(DEFAULT_UI_STATE), packets: [] });
  });

  // Main sizes the packets-table prune from the last UiState it received, so a
  // client that ignored another client's retention change would revert it — and
  // prune stored history — on its next unrelated PUT.
  it("adopts another client's retention and trims the live buffer to it", () => {
    useStore.setState({ packets: Array.from({ length: 800 }, (_, i) => live(i)) });
    useStore.getState().applyUiState({
      ...DEFAULT_UI_STATE,
      packetLog: { liveBufferSize: 300, storedHistorySize: 90_000 },
    });

    const s = useStore.getState();
    expect(s.ui.packetLog).toEqual({ liveBufferSize: 300, storedHistorySize: 90_000 });
    expect(s.packets).toHaveLength(300);
    expect(s.packets[0].id).toBe('pkt-x500');
  });

  it('keeps ui identity on an equal-value echo so it cannot start a PUT loop', () => {
    const before = useStore.getState().ui;
    useStore.getState().applyUiState({ ...DEFAULT_UI_STATE, packetLog: { ...DEFAULT_UI_STATE.packetLog } });
    expect(useStore.getState().ui).toBe(before);
  });

  it('keeps its own retention when a legacy producer omits packetLog', () => {
    useStore.setState({ ui: { ...structuredClone(DEFAULT_UI_STATE), pinned: ['ch:a'] } });
    const legacy: UiState = { ...DEFAULT_UI_STATE };
    delete (legacy as { packetLog?: unknown }).packetLog;
    expect(() => useStore.getState().applyUiState(legacy)).not.toThrow();
    expect(useStore.getState().ui.packetLog).toEqual(DEFAULT_UI_STATE.packetLog);
  });
});
