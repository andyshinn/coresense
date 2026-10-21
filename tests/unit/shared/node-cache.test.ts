import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_INFO,
  emptyNodeCacheEntry,
  evictNodeCache,
  NODE_CACHE_VERSION,
  type NodeCache,
  parseNodeCache,
} from '../../../src/shared/types';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);
const C = 'cc'.repeat(32);

describe('parseNodeCache', () => {
  it('reads a well-formed file', () => {
    const entry = { ...emptyNodeCacheEntry(A), lastSeenAt: 5, advertLinkHex: '11ac' };
    const { cache, dropped, futureVersion } = parseNodeCache({ version: 1, entries: { [A]: entry } });
    expect(cache).toEqual({ version: NODE_CACHE_VERSION, entries: { [A]: entry } });
    expect(dropped).toBe(0);
    expect(futureVersion).toBe(false);
  });

  it('reads an unversioned file as version 1', () => {
    const { cache } = parseNodeCache({ entries: { [A]: { lastSeenAt: 7 } } });
    expect(cache.version).toBe(1);
    expect(cache.entries[A].lastSeenAt).toBe(7);
  });

  it('degrades a malformed root to an empty cache', () => {
    for (const raw of [undefined, null, 5, [], { entries: [] }, { version: 1 }]) {
      expect(parseNodeCache(raw).cache).toEqual({ version: 1, entries: {} });
    }
  });

  it('reads a newer version as empty instead of half-interpreting it', () => {
    const { cache, futureVersion } = parseNodeCache({ version: 2, entries: { [A]: {} } });
    expect(cache.entries).toEqual({});
    expect(futureVersion).toBe(true);
  });

  it('drops entries that are not keyed by a public key or not objects', () => {
    const { cache, dropped } = parseNodeCache({
      version: 1,
      entries: { [A]: {}, 'not-a-key': {}, [B]: 'oops', [C.toUpperCase()]: {} },
    });
    expect(Object.keys(cache.entries)).toEqual([A]);
    expect(dropped).toBe(3);
  });

  it('falls back field by field for wrong-typed values and ignores unknown fields', () => {
    const { cache } = parseNodeCache({
      version: 1,
      entries: {
        [A]: {
          deviceInfo: { batteryMv: 'lots', deviceModel: 'T114', bogus: 1 },
          identity: { lat: '45', lon: 12.5, publicKeyHex: B },
          radioLimits: { maxTxPowerDbm: 22 },
          lastSelfAdvert: { at: 'yesterday', flood: true },
          lastLive: { at: 9, rawHex: '0174' },
          bleId: 42,
          extra: true,
        },
      },
    });
    const e = cache.entries[A];
    expect(e.deviceInfo).toEqual({ ...DEFAULT_DEVICE_INFO, deviceModel: 'T114' });
    // The key, not the stored field, is the identity's public key.
    expect(e.identity.publicKeyHex).toBe(A);
    expect(e.identity.lat).toBeNull();
    expect(e.identity.lon).toBe(12.5);
    expect(e.radioLimits.maxTxPowerDbm).toBe(22);
    expect(e.lastSelfAdvert).toBeNull();
    expect(e.lastLive).toEqual({ at: 9, rawHex: '0174' });
    expect(e.bleId).toBeNull();
    expect('extra' in e).toBe(false);
  });
});

describe('evictNodeCache', () => {
  const cacheOf = (seen: Record<string, number | null>): NodeCache => ({
    version: 1,
    entries: Object.fromEntries(Object.entries(seen).map(([k, at]) => [k, { ...emptyNodeCacheEntry(k), lastSeenAt: at }])),
  });

  it('returns the cache unchanged when within the cap', () => {
    const c = cacheOf({ [A]: 1, [B]: 2 });
    expect(evictNodeCache(c, 2, null)).toBe(c);
  });

  it('keeps the most recently seen entries', () => {
    const c = cacheOf({ [A]: 1, [B]: 3, [C]: 2 });
    expect(Object.keys(evictNodeCache(c, 2, null).entries).sort()).toEqual([B, C].sort());
  });

  it('never evicts the connected radio, even if it was seen longest ago', () => {
    const c = cacheOf({ [A]: 1, [B]: 3, [C]: 2 });
    expect(Object.keys(evictNodeCache(c, 2, A).entries).sort()).toEqual([A, B].sort());
  });

  it('treats a never-seen entry as the oldest', () => {
    const c = cacheOf({ [A]: null, [B]: 3, [C]: 2 });
    expect(Object.keys(evictNodeCache(c, 2, null).entries).sort()).toEqual([B, C].sort());
  });
});
