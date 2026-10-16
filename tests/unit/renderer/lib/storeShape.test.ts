import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_AUTO_ADD_CONFIG,
  DEFAULT_DEVICE_CAPABILITIES,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_GPS_CONFIG,
  DEFAULT_LOGS_SEARCH,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_MAP_TILE_STATUS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_SYNC_PROGRESS,
  DEFAULT_TELEMETRY_POLICY,
  DEFAULT_UI_STATE,
  type Message,
} from '../../../../src/shared/types';

// The store is composed from per-concern slices, but every caller sees one
// flat state object. These tests pin that object down — its members, their
// initial values, and the actions that deliberately write across concerns —
// so a slice that drops, renames or re-homes something is caught here rather
// than at some distant selector.

const initial = useStore.getState();

beforeEach(() => {
  useStore.setState(initial, true);
});

const msg = (id: string, key = 'ch:a'): Message => ({ id, key, body: id, ts: 1, state: 'received' });

describe('store shape', () => {
  it('exposes exactly the expected members', () => {
    expect(Object.keys(useStore.getState()).sort()).toEqual(
      [
        'addChannelOpen',
        'appSettings',
        'appendLog',
        'appendMessagePath',
        'appendRendererLog',
        'applyAppSettings',
        'applyAutoAddConfig',
        'applyBlockRules',
        'applyBridge',
        'applyChannelPresence',
        'applyChannels',
        'applyContacts',
        'applyDeviceCapabilities',
        'applyDeviceIdentity',
        'applyDeviceInfo',
        'applyDevices',
        'applyDiscovered',
        'applyGpsConfig',
        'applyMacros',
        'applyMapManifest',
        'applyMapSettings',
        'applyMapTileStatus',
        'applyMessageState',
        'applyMessages',
        'applyOwner',
        'applyPacket',
        'applyPathLearned',
        'applyRadioSettings',
        'applyRepeaterStatus',
        'applyRepeaterTelemetry',
        'applySyncProgress',
        'applyTelemetryPolicy',
        'applyTransportState',
        'applyUiState',
        'applyUpdateState',
        'applyWindowFocus',
        'autoAddConfig',
        'blockRules',
        'bridge',
        'busy',
        'capabilities',
        'channelPresence',
        'channels',
        'clearCmSelected',
        'clearLogs',
        'clearPackets',
        'clearPendingTarget',
        'clearScrollRequest',
        'clearSearch',
        'clearSettingsUi',
        'closeHelp',
        'closePalette',
        'commitPendingTarget',
        'connectedDeviceId',
        'contactManager',
        'contacts',
        'decoderOpen',
        'deviceCapabilities',
        'deviceIdentity',
        'deviceInfo',
        'devices',
        'discovered',
        'dismissPathLearned',
        'drafts',
        'goBack',
        'goForward',
        'gpsConfig',
        'helpOpen',
        'hydrate',
        'logs',
        'logsSearch',
        'macroStudioBridge',
        'macroStudioPreviewMode',
        'macros',
        'mapManifest',
        'mapSettings',
        'mapTileStatus',
        'markAllRead',
        'markAllReadGlobal',
        'markRead',
        'messagesByKey',
        'navFuture',
        'navPast',
        'neighbours',
        'openHelp',
        'openPalette',
        'owner',
        'packetLogColumns',
        'packetLogView',
        'packets',
        'paletteOpen',
        'pendingDeleteMessageId',
        'pendingJumpMid',
        'pendingPathLearn',
        'peopleQuery',
        'radioSettings',
        'recordEmojiUse',
        'recordMacroUse',
        'registerSettingsSections',
        'removeMessages',
        'rendererLogs',
        'repeaterAdminActiveTab',
        'repeaterAdminTab',
        'repeaterStatusByKey',
        'repeaterTelemetryByKey',
        'replaceLogs',
        'requestScrollToSection',
        'requestSearchFocus',
        'searchFilters',
        'searchFocusNonce',
        'searchQuery',
        'searchSort',
        'selectedMessageId',
        'selectedPacketId',
        'setActiveKey',
        'setActiveSettingsSection',
        'setAddChannelOpen',
        'setBusy',
        'setChannelActivityWindow',
        'setCmFilter',
        'setCmFocus',
        'setCmSelected',
        'setCmSort',
        'setDecoderOpen',
        'setDraft',
        'setLeftNavGroup',
        'setLogsFilter',
        'setLogsSearch',
        'setMacroStudioBridge',
        'setMacroStudioPreviewMode',
        'setNeighbourHovered',
        'setNeighbourSelected',
        'setNeighboursBusy',
        'setNeighboursCount',
        'setNeighboursFor',
        'setNeighboursPage',
        'setNeighboursShowNames',
        'setNeighboursSort',
        'setPacketLogColumnWidth',
        'setPacketLogFilter',
        'setPacketLogSettings',
        'setPacketLogView',
        'setPendingDeleteMessageId',
        'setPendingJump',
        'setPendingTarget',
        'setPeopleQuery',
        'setPeopleRail',
        'setRailSection',
        'setRepeaterAdminActiveTab',
        'setRepeaterAdminTab',
        'setRightWidth',
        'setSearchFilters',
        'setSearchQuery',
        'setSearchSort',
        'setSectionDirty',
        'setSelectedContact',
        'setSelectedMessage',
        'setSelectedPacket',
        'setSelectedSite',
        'setSettingsTab',
        'setSystemDark',
        'setThemePref',
        'setWsClients',
        'settingsUi',
        'syncProgress',
        'systemDark',
        'telemetryPolicy',
        'toggleCmSelected',
        'toggleLeftNav',
        'togglePin',
        'toggleRightRail',
        'transportState',
        'ui',
        'updateState',
        'windowFocused',
        'wsClients',
      ].sort(),
    );
  });

  it('starts from the expected initial state', () => {
    const data = Object.fromEntries(Object.entries(useStore.getState()).filter(([, v]) => typeof v !== 'function'));
    expect(data).toEqual({
      systemDark: false,
      windowFocused: true,
      transportState: 'idle',
      connectedDeviceId: undefined,
      syncProgress: DEFAULT_SYNC_PROGRESS,
      devices: [],
      bridge: null,
      wsClients: 0,
      packets: [],
      logs: [],
      rendererLogs: [],
      owner: null,
      channels: [],
      channelPresence: new Set<string>(),
      contacts: [],
      discovered: [],
      peopleQuery: '',
      drafts: {},
      logsSearch: DEFAULT_LOGS_SEARCH,
      contactManager: {
        search: '',
        stateTab: 'all',
        types: [],
        heard: 'any',
        favOnly: false,
        sortField: 'lastHeard',
        sortDir: 'asc',
        layout: 'table',
        compact: true,
        showKeys: true,
        selected: [],
        focusKey: null,
      },
      messagesByKey: {},
      pendingDeleteMessageId: null,
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
      mapManifest: { missing: true, basemap: null },
      mapTileStatus: DEFAULT_MAP_TILE_STATUS,
      repeaterStatusByKey: {},
      repeaterTelemetryByKey: {},
      repeaterAdminTab: null,
      repeaterAdminActiveTab: null,
      macroStudioBridge: null,
      macroStudioPreviewMode: 'send',
      neighbours: {
        forKey: null,
        page: null,
        sortKey: 'snr-desc',
        count: 16,
        busy: false,
        selectedId: null,
        hoveredId: null,
        showNames: true,
      },
      ui: DEFAULT_UI_STATE,
      settingsUi: {
        activeTab: 'app',
        sections: [],
        dirtyById: {},
        activeSectionId: null,
        pendingTarget: null,
        pendingScrollSectionId: null,
      },
      navPast: [],
      navFuture: [],
      busy: false,
      selectedMessageId: null,
      selectedPacketId: null,
      packetLogView: null,
      packetLogColumns: {},
      paletteOpen: false,
      helpOpen: false,
      decoderOpen: false,
      addChannelOpen: false,
      searchQuery: '',
      searchFilters: { categories: ['channel', 'dm', 'contact'] },
      searchSort: 'recency',
      searchFocusNonce: 0,
      pendingJumpMid: null,
      pendingPathLearn: null,
    });
  });
});

describe('actions that write across concerns', () => {
  it('removeMessages clears a selection or pending jump that pointed at a removed row', () => {
    useStore.setState({ messagesByKey: { 'ch:a': [msg('m1'), msg('m2')] }, selectedMessageId: 'm1', pendingJumpMid: 'm1' });
    useStore.getState().removeMessages('ch:a', ['m1']);
    const s = useStore.getState();
    expect(s.messagesByKey['ch:a'].map((m) => m.id)).toEqual(['m2']);
    expect(s.selectedMessageId).toBeNull();
    expect(s.pendingJumpMid).toBeNull();
  });

  it('removeMessages leaves an unrelated selection alone', () => {
    useStore.setState({ messagesByKey: { 'ch:a': [msg('m1'), msg('m2')] }, selectedMessageId: 'm2', pendingJumpMid: 'm2' });
    useStore.getState().removeMessages('ch:a', ['m1']);
    expect(useStore.getState().selectedMessageId).toBe('m2');
    expect(useStore.getState().pendingJumpMid).toBe('m2');
  });

  it('applyBlockRules trims every held history back to one server window', () => {
    const long = Array.from({ length: 250 }, (_, i) => msg(`m${i}`));
    useStore.setState({ messagesByKey: { 'ch:a': long, 'ch:b': [msg('x', 'ch:b')] } });
    useStore.getState().applyBlockRules([]);
    const s = useStore.getState();
    expect(s.messagesByKey['ch:a']).toHaveLength(200);
    expect(s.messagesByKey['ch:a'][0].id).toBe('m50');
    expect(s.messagesByKey['ch:b']).toHaveLength(1);
    expect(s.blockRules).toEqual([]);
  });

  it('opening the Neighbours tab or a macro studio opens the right rail, and never closes it', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, rightOpen: false } });
    useStore.getState().setRepeaterAdminActiveTab('neighbours');
    expect(useStore.getState().ui.rightOpen).toBe(true);

    useStore.setState({ ui: { ...DEFAULT_UI_STATE, rightOpen: false } });
    useStore.getState().setRepeaterAdminActiveTab('status');
    expect(useStore.getState().ui.rightOpen).toBe(false);

    useStore.getState().setMacroStudioBridge({ insertVar: () => {}, insertText: () => {} });
    expect(useStore.getState().ui.rightOpen).toBe(true);
    useStore.getState().setMacroStudioBridge(null);
    expect(useStore.getState().ui.rightOpen).toBe(true);
  });

  it('markAllReadGlobal marks every channel and contact read', () => {
    useStore.setState({
      channels: [{ key: 'ch:a' } as never],
      contacts: [{ key: 'c:b' } as never],
      ui: { ...DEFAULT_UI_STATE, lastReadByKey: { 'ch:old': 5 } },
    });
    useStore.getState().markAllReadGlobal();
    const read = useStore.getState().ui.lastReadByKey;
    expect(Object.keys(read).sort()).toEqual(['c:b', 'ch:a', 'ch:old']);
    expect(read['ch:a']).toBeGreaterThan(5);
    expect(read['ch:old']).toBe(5);
  });

  it('selecting a contact or a site opens the rail and keeps the two mutually exclusive', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, rightOpen: false } });
    useStore.getState().setSelectedSite('site:1');
    expect(useStore.getState().ui).toMatchObject({ selectedSiteKey: 'site:1', rightOpen: true });
    useStore.getState().setSelectedContact('c:a', { keepSite: true });
    expect(useStore.getState().ui).toMatchObject({ selectedContactKey: 'c:a', selectedSiteKey: 'site:1' });
    useStore.getState().setSelectedContact('c:b');
    expect(useStore.getState().ui).toMatchObject({ selectedContactKey: 'c:b', selectedSiteKey: null });
    useStore.getState().setSelectedSite('site:2');
    expect(useStore.getState().ui).toMatchObject({ selectedContactKey: null, selectedSiteKey: 'site:2' });
  });
});
