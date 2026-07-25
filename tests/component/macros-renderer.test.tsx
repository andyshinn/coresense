import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { MacroTemplate } from '../../src/shared/macros/types';
import {
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
  DEFAULT_SYNC_PROGRESS,
  DEFAULT_TELEMETRY_POLICY,
  DEFAULT_UI_STATE,
  type StateSnapshot,
} from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' } as Parameters<typeof api.getMacros>[0];

/** A complete-enough snapshot for hydrate(); all fields hydrate dereferences
 *  are real defaults, the rest are empty/null. */
function makeSnapshot(macros: MacroTemplate[]): StateSnapshot {
  return {
    capabilities: {} as Capabilities,
    bridge: {} as StateSnapshot['bridge'],
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
    uiState: DEFAULT_UI_STATE,
    deviceIdentity: DEFAULT_DEVICE_IDENTITY,
    autoAddConfig: DEFAULT_AUTO_ADD_CONFIG,
    telemetryPolicy: DEFAULT_TELEMETRY_POLICY,
    gpsConfig: DEFAULT_GPS_CONFIG,
    deviceInfo: DEFAULT_DEVICE_INFO,
    deviceCapabilities: DEFAULT_DEVICE_CAPABILITIES,
    blockRules: [],
    macros,
  };
}

beforeEach(() => useStore.setState({ macros: [] }));
afterEach(() => vi.unstubAllGlobals());

describe('renderer macro plumbing', () => {
  it('getMacros calls GET /api/macros', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    await api.getMacros(client);
    expect(fetchMock).toHaveBeenCalledWith('http://x/api/macros', expect.objectContaining({}));
  });

  it('applyMacros updates the store slice', () => {
    const macros: MacroTemplate[] = [{ id: '1', name: 'a', template: 'x', scope: 'global', createdAt: 0, updatedAt: 0 }];
    useStore.getState().applyMacros(macros);
    expect(useStore.getState().macros).toEqual(macros);
  });

  it('hydrate loads persisted macros from the snapshot', () => {
    const macros: MacroTemplate[] = [
      { id: 'm', name: 'sig', template: '{{ snr }}', scope: 'global', createdAt: 0, updatedAt: 0 },
    ];
    useStore.getState().hydrate(makeSnapshot(macros));
    expect(useStore.getState().macros).toEqual(macros);
  });
});
