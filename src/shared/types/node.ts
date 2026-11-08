// The last-known state of each companion radio CoreSense has connected to,
// kept app-side so My Node can show it while disconnected. Main is the only
// writer (main/node/nodeCache.ts); the renderer receives the whole cache in the
// snapshot and on every change.

import {
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_GPS_CONFIG,
  DEFAULT_RADIO_LIMITS,
  DEFAULT_RADIO_SETTINGS,
  type DeviceIdentity,
  type DeviceInfo,
  type GpsConfig,
  type RadioLimits,
  type RadioSettings,
} from './settings';

export const NODE_CACHE_VERSION = 1;

/** How many radios the cache remembers. The least recently seen beyond this
 *  are evicted, so plaintext positions and adverts are only kept for radios
 *  used recently. */
export const NODE_CACHE_MAX_ENTRIES = 5;

export interface SelfAdvertRecord {
  /** Epoch ms when the radio accepted the self-advert. */
  at: number;
  flood: boolean;
}

export interface LiveReadRecord {
  /** Epoch ms of the read. */
  at: number;
  /** The LPP payload as the radio sent it. */
  rawHex: string;
}

export interface NodeCacheEntry {
  /** Bare lowercase 64-hex public key: the entry's own key. */
  publicKeyHex: string;
  identity: DeviceIdentity;
  deviceInfo: DeviceInfo;
  radioSettings: RadioSettings;
  radioLimits: RadioLimits;
  gpsConfig: GpsConfig;
  /** The BLE peripheral id it was last connected through, for matching the
   *  renderer's remembered radio. Null when unknown. */
  bleId: string | null;
  /** The signed self-advert the radio exported (CMD_EXPORT_CONTACT), as hex.
   *  Null when never fetched, or after an identity change made it stale. */
  advertLinkHex: string | null;
  /** The last self-advert CoreSense sent; the radio doesn't expose its own. */
  lastSelfAdvert: SelfAdvertRecord | null;
  /** The last live self-telemetry read, whether or not it was saved. */
  lastLive: LiveReadRecord | null;
  /** Epoch ms of the latest connect. */
  lastConnectedAt: number | null;
  /** Epoch ms the radio was last seen connected: its disconnect, or now while
   *  connected. Drives eviction. */
  lastSeenAt: number | null;
}

export interface NodeCache {
  version: typeof NODE_CACHE_VERSION;
  entries: Record<string, NodeCacheEntry>;
}

export const EMPTY_NODE_CACHE: NodeCache = { version: NODE_CACHE_VERSION, entries: {} };

/** A fresh entry for `publicKeyHex`, every field at its default. */
export function emptyNodeCacheEntry(publicKeyHex: string): NodeCacheEntry {
  return {
    publicKeyHex,
    identity: { ...DEFAULT_DEVICE_IDENTITY, publicKeyHex },
    deviceInfo: { ...DEFAULT_DEVICE_INFO },
    radioSettings: { ...DEFAULT_RADIO_SETTINGS },
    radioLimits: { ...DEFAULT_RADIO_LIMITS },
    gpsConfig: { ...DEFAULT_GPS_CONFIG },
    bleId: null,
    advertLinkHex: null,
    lastSelfAdvert: null,
    lastLive: null,
    lastConnectedAt: null,
    lastSeenAt: null,
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Shallow-merge a stored object over its defaults, keeping only keys whose
 *  stored value has the default's type. Tolerant: a wrong-typed field falls
 *  back rather than poisoning the entry. */
function mergeTyped<T extends object>(stored: unknown, defaults: T): T {
  const out = { ...defaults } as Record<string, unknown>;
  if (!isRecord(stored)) return out as T;
  for (const [key, def] of Object.entries(defaults)) {
    const v = stored[key];
    if (v === undefined) continue;
    // A null default (lat/lon, maxTxPowerDbm) is a number-or-null field.
    if (def === null ? v === null || typeof v === 'number' : typeof v === typeof def) {
      out[key] = v;
    }
  }
  return out as T;
}

function parseSelfAdvert(v: unknown): SelfAdvertRecord | null {
  if (!isRecord(v)) return null;
  const at = numberOrNull(v.at);
  return at !== null && typeof v.flood === 'boolean' ? { at, flood: v.flood } : null;
}

function parseLiveRead(v: unknown): LiveReadRecord | null {
  if (!isRecord(v)) return null;
  const at = numberOrNull(v.at);
  return at !== null && typeof v.rawHex === 'string' ? { at, rawHex: v.rawHex } : null;
}

/** One stored entry, or null when it isn't recognisably one. */
export function parseNodeCacheEntry(key: string, v: unknown): NodeCacheEntry | null {
  if (!HEX64.test(key) || !isRecord(v)) return null;
  const base = emptyNodeCacheEntry(key);
  return {
    publicKeyHex: key,
    identity: { ...mergeTyped(v.identity, base.identity), publicKeyHex: key },
    deviceInfo: mergeTyped(v.deviceInfo, base.deviceInfo),
    radioSettings: mergeTyped(v.radioSettings, base.radioSettings),
    radioLimits: mergeTyped(v.radioLimits, base.radioLimits),
    gpsConfig: mergeTyped(v.gpsConfig, base.gpsConfig),
    bleId: stringOrNull(v.bleId),
    advertLinkHex: stringOrNull(v.advertLinkHex),
    lastSelfAdvert: parseSelfAdvert(v.lastSelfAdvert),
    lastLive: parseLiveRead(v.lastLive),
    lastConnectedAt: numberOrNull(v.lastConnectedAt),
    lastSeenAt: numberOrNull(v.lastSeenAt),
  };
}

/** Parse a stored cache file. Never throws: a missing or unknown version, a
 *  malformed root or entry, or unknown fields all degrade to what can be
 *  read, an empty cache at worst. A file from a newer CoreSense (a higher
 *  version) is not understood, so it reads as empty rather than being
 *  half-interpreted. */
export function parseNodeCache(raw: unknown): { cache: NodeCache; dropped: number; futureVersion: boolean } {
  if (!isRecord(raw) || !isRecord(raw.entries))
    return { cache: structuredClone(EMPTY_NODE_CACHE), dropped: 0, futureVersion: false };
  if (typeof raw.version === 'number' && raw.version > NODE_CACHE_VERSION) {
    return { cache: structuredClone(EMPTY_NODE_CACHE), dropped: 0, futureVersion: true };
  }
  const entries: Record<string, NodeCacheEntry> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(raw.entries)) {
    const entry = parseNodeCacheEntry(key, value);
    if (entry) entries[key] = entry;
    else dropped++;
  }
  return { cache: { version: NODE_CACHE_VERSION, entries }, dropped, futureVersion: false };
}

/** Keep the `max` most recently seen entries. `keep` is never evicted (the
 *  connected radio). Returns the cache unchanged when nothing is over. */
export function evictNodeCache(cache: NodeCache, max: number, keep: string | null): NodeCache {
  const keys = Object.keys(cache.entries);
  if (keys.length <= max) return cache;
  const seen = (k: string) => (k === keep ? Number.POSITIVE_INFINITY : (cache.entries[k].lastSeenAt ?? 0));
  const kept = [...keys].sort((a, b) => seen(b) - seen(a)).slice(0, max);
  const entries: Record<string, NodeCacheEntry> = {};
  for (const k of kept) entries[k] = cache.entries[k];
  return { ...cache, entries };
}

// ---- Local stats (CMD_GET_STATS) ------------------------------------------

/** CMD_GET_STATS core subtype (firmware v8+, companion_radio MyMesh.cpp). */
export interface LocalStatsCore {
  kind: 'core';
  battMv: number;
  /** Since boot: millis() / 1000. */
  uptimeSecs: number;
  errFlags: number;
  queueLen: number;
}

/** CMD_GET_STATS radio subtype. Airtimes are cumulative seconds since boot. */
export interface LocalStatsRadio {
  kind: 'radio';
  noiseFloor: number;
  lastRssi: number;
  /** Already divided by 4 (firmware sends 0.25 dB steps). */
  lastSnrDb: number;
  txAirSecs: number;
  rxAirSecs: number;
}

/** CMD_GET_STATS packets subtype. Counters since boot. */
export interface LocalStatsPackets {
  kind: 'packets';
  recv: number;
  sent: number;
  nSentFlood: number;
  nSentDirect: number;
  nRecvFlood: number;
  nRecvDirect: number;
  nRecvErrors: number;
}

export type LocalStats = LocalStatsCore | LocalStatsRadio | LocalStatsPackets;

/** POST /api/device/stats: all three subtypes, read one after another. */
export interface DeviceStats {
  core: LocalStatsCore;
  radio: LocalStatsRadio;
  packets: LocalStatsPackets;
  /** Epoch ms when the last subtype arrived. */
  at: number;
}

/** CMD_GET_STATS needs companion firmware ver_code 8 or later. */
export const LOCAL_STATS_MIN_VER_CODE = 8;
