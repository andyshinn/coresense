import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADVERT_REFRESH_DELAY_MS,
  currentNodeKey,
  flushNodeCache,
  LIVE_READ_PERSIST_MS,
  nodeCacheSnapshot,
  noteTransportState,
  recordLiveRead,
  refreshAdvertLink,
  resetNodeCacheState,
} from '../../../src/main/node/nodeCache';
import { userDataDir } from '../../../src/main/runtime/userData';
import { commit } from '../../../src/main/state/commit';
import { stateHolder } from '../../../src/main/state/holder';
import { flushSettings, settingsStore } from '../../../src/main/storage/settings';
import { transportManager } from '../../../src/main/transport/manager';
import {
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_RADIO_SETTINGS,
  type DeviceIdentity,
  NODE_CACHE_MAX_ENTRIES,
  type NodeCache,
} from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';

const PK = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

function identityFor(pk: string, over: Partial<DeviceIdentity> = {}): DeviceIdentity {
  return { ...DEFAULT_DEVICE_IDENTITY, name: 'Base', publicKeyHex: pk, lat: 45.5, lon: -122.6, ...over };
}

/** What server.ts and the library do on a connect: transport up, then the
 *  handshake's DEVICE_INFO and SELF_INFO (owner, then identity). */
function connect(pk = PK, bleId = 'ble-1') {
  transportManager.setState('connected', bleId);
  noteTransportState('connected', bleId);
  commit.deviceInfo({ ...DEFAULT_DEVICE_INFO, deviceModel: 'Heltec T114', firmwareVersion: 'v1.17.1' });
  stateHolder().setDeviceIdentity(identityFor(pk));
  commit.owner({ name: 'Base', publicKeyHex: pk, publicKeyShort: pk.slice(0, 12) });
}

function disconnect() {
  transportManager.setState('idle');
  noteTransportState('idle');
}

function onDisk(): NodeCache {
  return JSON.parse(readFileSync(join(userDataDir(), 'node-cache.json'), 'utf8')) as NodeCache;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('node cache: the connected radio', () => {
  it('opens an entry when SELF_INFO arrives on a live link, seeded from the handshake', async () => {
    installSessionStub({ exportContact: vi.fn(async () => '11AA') });
    const broadcast = captureBus('nodeCache');

    connect();

    expect(currentNodeKey()).toBe(PK);
    const entry = nodeCacheSnapshot().entries[PK];
    expect(entry.identity).toEqual(identityFor(PK));
    expect(entry.deviceInfo.deviceModel).toBe('Heltec T114');
    expect(entry.bleId).toBe('ble-1');
    expect(entry.lastConnectedAt).not.toBeNull();
    expect(broadcast.values.length).toBeGreaterThan(0);
    await flushSettings();
    expect(onDisk().version).toBe(1);
    expect(onDisk().entries[PK].deviceInfo.deviceModel).toBe('Heltec T114');
  });

  it('records the radio slices while connected and ignores them while disconnected', () => {
    installSessionStub({ exportContact: vi.fn(async () => null) });
    connect();

    commit.radioSettings({ ...DEFAULT_RADIO_SETTINGS, txPowerDbm: 17 });
    commit.radioLimits({ minTxPowerDbm: -9, maxTxPowerDbm: 22 });
    expect(nodeCacheSnapshot().entries[PK].radioSettings.txPowerDbm).toBe(17);
    expect(nodeCacheSnapshot().entries[PK].radioLimits.maxTxPowerDbm).toBe(22);

    disconnect();
    // An app-side save while offline is not the radio's state.
    commit.radioSettings({ ...DEFAULT_RADIO_SETTINGS, txPowerDbm: 5 });
    commit.deviceIdentity(identityFor(PK, { name: 'Staged' }));
    expect(nodeCacheSnapshot().entries[PK].radioSettings.txPowerDbm).toBe(17);
    expect(nodeCacheSnapshot().entries[PK].identity.name).toBe('Base');
  });

  it('stamps lastSeenAt on disconnect and keeps the entry', () => {
    installSessionStub({ exportContact: vi.fn(async () => null) });
    connect();
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });

    disconnect();

    expect(currentNodeKey()).toBeNull();
    expect(nodeCacheSnapshot().entries[PK].lastSeenAt).toBe(1_000_000);
  });

  it('does not attach the previous radio from a stale owner when the link comes up', () => {
    installSessionStub({ exportContact: vi.fn(async () => null) });
    connect(PK);
    disconnect();
    const before = nodeCacheSnapshot().entries[PK];

    // The holder still has PK's owner; the next radio hasn't sent SELF_INFO.
    transportManager.setState('connected', 'ble-2');
    noteTransportState('connected', 'ble-2');

    expect(currentNodeKey()).toBeNull();
    expect(nodeCacheSnapshot().entries[PK]).toEqual(before);
  });

  it('starts a separate entry for a different radio', () => {
    installSessionStub({ exportContact: vi.fn(async () => null) });
    connect(PK);
    disconnect();
    connect(OTHER, 'ble-2');

    expect(Object.keys(nodeCacheSnapshot().entries).sort()).toEqual([PK, OTHER].sort());
    expect(nodeCacheSnapshot().entries[OTHER].bleId).toBe('ble-2');
  });
});

describe('node cache: self-advert and live reads', () => {
  it('records the last self-advert sent through the advert route', async () => {
    installSessionStub({
      exportContact: vi.fn(async () => null),
      sendSelfAdvert: vi.fn(async () => ({ ok: true })),
    });
    connect();

    const res = await testRoutes().request('/api/transport/advert', json('POST', { flood: false }));

    expect(res.status).toBe(200);
    expect(nodeCacheSnapshot().entries[PK].lastSelfAdvert).toEqual({ at: expect.any(Number), flood: false });
  });

  it('does not record a self-advert the radio refused', async () => {
    installSessionStub({
      exportContact: vi.fn(async () => null),
      sendSelfAdvert: vi.fn(async () => ({ ok: false, error: 'table full' })),
    });
    connect();

    await testRoutes().request('/api/transport/advert', json('POST', {}));

    expect(nodeCacheSnapshot().entries[PK].lastSelfAdvert).toBeNull();
  });

  it('persists a live read at most once a minute, and flushes the held-back one', async () => {
    installSessionStub({ exportContact: vi.fn(async () => null) });
    connect();
    const broadcast = captureBus('nodeCache');

    recordLiveRead(1_000_000, '0174');
    recordLiveRead(1_010_000, '0175');
    await flushSettings();

    // The first read went out; the second is held in memory.
    expect(broadcast.values).toHaveLength(1);
    expect(onDisk().entries[PK].lastLive).toEqual({ at: 1_000_000, rawHex: '0174' });
    expect(nodeCacheSnapshot().entries[PK].lastLive).toEqual({ at: 1_010_000, rawHex: '0175' });

    recordLiveRead(1_000_000 + LIVE_READ_PERSIST_MS, '0176');
    await flushSettings();
    expect(onDisk().entries[PK].lastLive?.rawHex).toBe('0176');

    recordLiveRead(1_000_000 + LIVE_READ_PERSIST_MS + 10_000, '0177');
    flushNodeCache();
    await flushSettings();
    expect(onDisk().entries[PK].lastLive?.rawHex).toBe('0177');
  });

  it('writes a held-back live read on disconnect', async () => {
    installSessionStub({ exportContact: vi.fn(async () => null) });
    connect();
    recordLiveRead(1_000_000, '0174');
    recordLiveRead(1_010_000, '0175');

    disconnect();
    await flushSettings();

    expect(onDisk().entries[PK].lastLive?.rawHex).toBe('0175');
  });
});

describe('node cache: advert link', () => {
  it('exports the self-advert after connecting and caches it lowercased', async () => {
    vi.useFakeTimers();
    const exportContact = vi.fn(async () => 'AB12');
    installSessionStub({ exportContact });

    connect();
    await vi.advanceTimersByTimeAsync(ADVERT_REFRESH_DELAY_MS);

    expect(exportContact).toHaveBeenCalledWith();
    expect(nodeCacheSnapshot().entries[PK].advertLinkHex).toBe('ab12');
  });

  it('drops the link when the name, position or share flag changes, then re-exports once', async () => {
    vi.useFakeTimers();
    const exportContact = vi.fn(async () => 'ab12');
    installSessionStub({ exportContact });
    connect();
    await vi.advanceTimersByTimeAsync(ADVERT_REFRESH_DELAY_MS);
    exportContact.mockResolvedValue('cd34');

    commit.deviceIdentity(identityFor(PK, { name: 'Renamed' }));
    commit.deviceIdentity(identityFor(PK, { name: 'Renamed', lat: 10 }));

    expect(nodeCacheSnapshot().entries[PK].advertLinkHex).toBeNull();
    await vi.advanceTimersByTimeAsync(ADVERT_REFRESH_DELAY_MS);
    // A burst of identity writes re-exports once.
    expect(exportContact).toHaveBeenCalledTimes(2);
    expect(nodeCacheSnapshot().entries[PK].advertLinkHex).toBe('cd34');
  });

  it('keeps the link when an identity write changes nothing the advert carries', async () => {
    vi.useFakeTimers();
    const exportContact = vi.fn(async () => 'ab12');
    installSessionStub({ exportContact });
    connect();
    await vi.advanceTimersByTimeAsync(ADVERT_REFRESH_DELAY_MS);

    commit.deviceIdentity(identityFor(PK));
    await vi.advanceTimersByTimeAsync(ADVERT_REFRESH_DELAY_MS);

    expect(nodeCacheSnapshot().entries[PK].advertLinkHex).toBe('ab12');
    expect(exportContact).toHaveBeenCalledTimes(1);
  });

  it('answers null without a radio, and when the radio refuses', async () => {
    installSessionStub({ exportContact: vi.fn(async () => null) });
    expect(await refreshAdvertLink()).toBeNull();
    connect();
    expect(await refreshAdvertLink()).toBeNull();
  });
});

describe('node cache: eviction and loading', () => {
  it(`keeps at most ${NODE_CACHE_MAX_ENTRIES} radios, dropping the least recently seen`, () => {
    installSessionStub({ exportContact: vi.fn(async () => null) });
    vi.useFakeTimers({ now: 1_000, toFake: ['Date'] });
    const keys = Array.from({ length: NODE_CACHE_MAX_ENTRIES + 1 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32));
    for (const k of keys) {
      connect(k, `ble-${k.slice(0, 2)}`);
      vi.setSystemTime(Date.now() + 1_000);
      disconnect();
      vi.setSystemTime(Date.now() + 1_000);
    }

    const kept = Object.keys(nodeCacheSnapshot().entries);
    expect(kept).toHaveLength(NODE_CACHE_MAX_ENTRIES);
    expect(kept).not.toContain(keys[0]);
  });

  it('loads a damaged file without throwing, keeping the readable entries', () => {
    writeFileSync(
      join(userDataDir(), 'node-cache.json'),
      JSON.stringify({ version: 1, entries: { [PK]: { lastSeenAt: 3 }, junk: 1 } }),
    );
    resetNodeCacheState();

    expect(Object.keys(nodeCacheSnapshot().entries)).toEqual([PK]);
    expect(settingsStore.loadNodeCache().entries[PK].lastSeenAt).toBe(3);
  });

  it('loads invalid JSON as an empty cache', () => {
    writeFileSync(join(userDataDir(), 'node-cache.json'), '{nope');
    resetNodeCacheState();

    expect(nodeCacheSnapshot()).toEqual({ version: 1, entries: {} });
  });

  it('serves the cache in the snapshot', async () => {
    installSessionStub({
      exportContact: vi.fn(async () => null),
      getDevicePresence: () => [],
      getSyncProgress: () => ({ phase: 'idle', channels: { done: 0, total: 0 }, contacts: { done: 0, total: 0 } }),
    });
    connect();

    const res = await testRoutes().request('/api/state/snapshot');

    expect(((await res.json()) as { nodeCache: NodeCache }).nodeCache.entries[PK].bleId).toBe('ble-1');
  });
});
