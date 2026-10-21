// The last-known state of each companion radio CoreSense has connected to
// (shared/types/node.ts), so My Node can show it while disconnected.
//
// Fed from the places that already apply state, rather than from bus
// listeners: commit.* for the radio's settings slices, and server.ts for
// transport state. Every write while a radio is connected lands in the entry
// for that radio's public key. The entry is created when the owner (SELF_INFO)
// arrives on a live link, and seeded from the holder at that moment: the
// library applies SELF_INFO's owner, radio settings and identity in one
// synchronous pass, and the device info that DEVICE_QUERY returned earlier in
// the handshake is already this radio's.
//
// Entries are only removed by eviction (NODE_CACHE_MAX_ENTRIES, least recently
// seen first): the cache keeps plaintext positions and signed adverts, so it
// remembers only radios used recently.

import { errorMessage } from '../../shared/errors';
import {
  type DeviceIdentity,
  type DeviceInfo,
  emptyNodeCacheEntry,
  evictNodeCache,
  type GpsConfig,
  NODE_CACHE_MAX_ENTRIES,
  type NodeCache,
  type NodeCacheEntry,
  type Owner,
  type RadioLimits,
  type RadioSettings,
  type TransportState,
} from '../../shared/types';
import { emit } from '../events/bus';
import { child } from '../log';
import { stateHolder } from '../state/holder';
import { settingsStore } from '../storage/settings';
import { transportManager } from '../transport/manager';

const log = child('node-cache');

/** A live read is persisted at most this often; the poller reads every 10 s,
 *  and the file needn't be rewritten that often. A disconnect flushes. */
export const LIVE_READ_PERSIST_MS = 60_000;
/** Identity changes come in bursts (a save writes name, position and share
 *  separately); the advert is re-exported once they settle. */
export const ADVERT_REFRESH_DELAY_MS = 1_500;

let cache: NodeCache | null = null;
/** The connected radio's key, once its SELF_INFO has arrived on a live link. */
let currentKey: string | null = null;
/** The BLE id the transport reported at connect, attached with the owner. */
let pendingBleId: string | null = null;
let lastLivePersistedAt = 0;
let liveDirty = false;
let advertTimer: ReturnType<typeof setTimeout> | null = null;
let advertFetch: Promise<string | null> | null = null;

/** The slice of SessionAdapter this module calls. */
interface NodeCacheSession {
  exportContact(destPublicKeyHex?: string): Promise<string | null>;
}

// Injected by protocol/index.ts: importing it here would close a cycle
// (protocol → adapterEvents → commit → here), as with state/advertPath.ts.
let protocolSession: (() => NodeCacheSession) | null = null;

export function wireNodeCacheSession(get: () => NodeCacheSession): void {
  protocolSession = get;
}

function load(): NodeCache {
  if (!cache) cache = settingsStore.loadNodeCache();
  return cache;
}

/** The whole cache, as served in the snapshot and broadcast on change. */
export function nodeCacheSnapshot(): NodeCache {
  return load();
}

/** The connected radio's key, or null. */
export function currentNodeKey(): string | null {
  return currentKey;
}

/** The connected radio's entry, or null. */
export function currentNodeEntry(): NodeCacheEntry | null {
  return currentKey ? (load().entries[currentKey] ?? null) : null;
}

function persistAndPublish(): void {
  const c = load();
  settingsStore.saveNodeCache(c);
  emit.nodeCache(c);
}

/** Apply `fn` to the connected radio's entry. No-op while none is connected. */
function updateCurrent(fn: (e: NodeCacheEntry) => NodeCacheEntry, opts: { persist?: boolean } = {}): void {
  if (!currentKey) return;
  const c = load();
  const entry = c.entries[currentKey];
  if (!entry) return;
  c.entries = { ...c.entries, [currentKey]: fn(entry) };
  if (opts.persist !== false) persistAndPublish();
}

function attach(key: string): void {
  const holder = stateHolder();
  const c = load();
  const now = Date.now();
  const existing = c.entries[key] ?? emptyNodeCacheEntry(key);
  currentKey = key;
  const identity = holder.getDeviceIdentity();
  c.entries = {
    ...c.entries,
    [key]: {
      ...existing,
      // The holder was just written by this radio's SELF_INFO (see header).
      identity: identity.publicKeyHex.toLowerCase() === key ? identity : existing.identity,
      deviceInfo: holder.getDeviceInfo(),
      radioSettings: holder.getRadioSettings(),
      radioLimits: holder.getRadioLimits(),
      gpsConfig: holder.getGpsConfig(),
      bleId: pendingBleId ?? existing.bleId,
      lastConnectedAt: now,
      lastSeenAt: now,
    },
  };
  cache = evictNodeCache(c, NODE_CACHE_MAX_ENTRIES, key);
  persistAndPublish();
  if (cache.entries[key].advertLinkHex === null) scheduleAdvertRefresh();
}

function detach(): void {
  if (advertTimer) clearTimeout(advertTimer);
  advertTimer = null;
  if (!currentKey) return;
  updateCurrent((e) => ({ ...e, lastSeenAt: Date.now() }));
  liveDirty = false;
  currentKey = null;
}

// ---- Hooks ------------------------------------------------------------------

/** server.ts: the single place transport state is applied. */
export function noteTransportState(state: TransportState, deviceId?: string): void {
  if (state === 'connected') {
    // Not attached yet: the owner the holder still has may be the PREVIOUS
    // radio. The library emits `owner` on every SELF_INFO, so commit.owner
    // attaches the right one moments later.
    pendingBleId = deviceId ?? null;
    return;
  }
  pendingBleId = null;
  detach();
}

/** commit.owner: SELF_INFO arrived. */
export function noteOwner(owner: Owner | null): void {
  if (!owner || !transportManager.isConnected()) return;
  const key = owner.publicKeyHex.toLowerCase();
  if (key === currentKey) return;
  if (currentKey) detach();
  attach(key);
}

function identityChanged(a: DeviceIdentity, b: DeviceIdentity): boolean {
  return a.name !== b.name || a.lat !== b.lat || a.lon !== b.lon || a.sharePositionInAdvert !== b.sharePositionInAdvert;
}

/** commit.deviceIdentity. A change to anything the advert embeds (name,
 *  position, whether the position is shared) makes the cached advert stale. */
export function noteIdentity(next: DeviceIdentity): void {
  if (!currentKey || !transportManager.isConnected()) return;
  const entry = load().entries[currentKey];
  if (!entry) return;
  const stale = identityChanged(entry.identity, next);
  updateCurrent((e) => ({ ...e, identity: next, advertLinkHex: stale ? null : e.advertLinkHex }));
  if (stale) scheduleAdvertRefresh();
}

/** commit.radioSettings / deviceInfo / gpsConfig / radioLimits. */
export function noteRadioSlice(
  patch: Partial<{ radioSettings: RadioSettings; deviceInfo: DeviceInfo; gpsConfig: GpsConfig; radioLimits: RadioLimits }>,
): void {
  if (!transportManager.isConnected()) return;
  updateCurrent((e) => ({ ...e, ...patch }));
}

/** routes/transport.ts: the radio accepted a self-advert. */
export function recordSelfAdvert(flood: boolean, at = Date.now()): void {
  updateCurrent((e) => ({ ...e, lastSelfAdvert: { at, flood } }));
}

/** A live self-telemetry read. Kept in memory every time, persisted and
 *  broadcast at most every LIVE_READ_PERSIST_MS; a disconnect flushes. */
export function recordLiveRead(at: number, rawHex: string): void {
  const persist = at - lastLivePersistedAt >= LIVE_READ_PERSIST_MS;
  updateCurrent((e) => ({ ...e, lastLive: { at, rawHex } }), { persist });
  if (persist) {
    lastLivePersistedAt = at;
    liveDirty = false;
  } else {
    liveDirty = true;
  }
}

/** Write a held-back live read now (disconnect, quit). */
export function flushNodeCache(): void {
  if (!liveDirty || !cache) return;
  liveDirty = false;
  persistAndPublish();
}

// ---- Advert link --------------------------------------------------------------

function scheduleAdvertRefresh(): void {
  if (advertTimer) clearTimeout(advertTimer);
  advertTimer = setTimeout(() => {
    advertTimer = null;
    void refreshAdvertLink();
  }, ADVERT_REFRESH_DELAY_MS);
  advertTimer.unref?.();
}

/** Export the connected radio's own signed advert (CMD_EXPORT_CONTACT with no
 *  key) and cache it. Concurrent callers share one export. Null when no radio
 *  is connected or the radio refused. */
export function refreshAdvertLink(): Promise<string | null> {
  if (advertFetch) return advertFetch;
  const key = currentKey;
  const getSession = protocolSession;
  if (!key || !getSession || !transportManager.isConnected()) return Promise.resolve(null);
  advertFetch = (async () => {
    try {
      const hex = await getSession().exportContact();
      // Dropped if the radio changed mid-export.
      if (!hex || currentKey !== key) return null;
      updateCurrent((e) => ({ ...e, advertLinkHex: hex.toLowerCase() }));
      return hex.toLowerCase();
    } catch (err) {
      log.warn(`self advert export failed: ${errorMessage(err)}`);
      return null;
    } finally {
      advertFetch = null;
    }
  })();
  return advertFetch;
}

/** Test seam: forget everything held in memory. */
export function resetNodeCacheState(): void {
  if (advertTimer) clearTimeout(advertTimer);
  cache = null;
  currentKey = null;
  pendingBleId = null;
  lastLivePersistedAt = 0;
  liveDirty = false;
  advertTimer = null;
  advertFetch = null;
}
