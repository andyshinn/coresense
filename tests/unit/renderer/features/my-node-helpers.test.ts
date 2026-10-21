import { describe, expect, it } from 'vitest';
import { pickNodeEntry } from '../../../../src/renderer/features/my-node/currentNode';
import { snapshotLine } from '../../../../src/renderer/features/my-node/snapshotLine';
import { bytesToHex, decodeLpp, hexToBytes } from '../../../../src/shared/telemetry/lpp';
import type { SavedRequestDto } from '../../../../src/shared/telemetry/types';
import { emptyNodeCacheEntry, type NodeCache, type NodeCacheEntry } from '../../../../src/shared/types';

const key = (c: string) => c.repeat(64);

function entry(c: string, over: Partial<NodeCacheEntry> = {}): NodeCacheEntry {
  return { ...emptyNodeCacheEntry(key(c)), ...over };
}

function cacheOf(...entries: NodeCacheEntry[]): NodeCache {
  return { version: 1, entries: Object.fromEntries(entries.map((e) => [e.publicKeyHex, e])) };
}

describe('pickNodeEntry', () => {
  const a = entry('a', { bleId: 'ble-a', lastSeenAt: 100 });
  const b = entry('b', { bleId: 'ble-b', lastSeenAt: 300 });
  const c = entry('c', { lastSeenAt: 200 });
  const cache = cacheOf(a, b, c);

  it('connected: the connected radio’s entry, matched case-insensitively', () => {
    expect(pickNodeEntry(cache, key('A'), true, 'ble-b')).toBe(a);
  });

  it('connected to a radio the cache has never seen: nothing', () => {
    expect(pickNodeEntry(cache, key('d'), true, null)).toBeNull();
  });

  it('disconnected: the remembered radio, by BLE id', () => {
    expect(pickNodeEntry(cache, key('b'), false, 'ble-a')).toBe(a);
  });

  it('disconnected, remembered radio not cached: the most recently seen', () => {
    expect(pickNodeEntry(cache, null, false, 'ble-x')).toBe(b);
    expect(pickNodeEntry(cache, null, false, null)).toBe(b);
  });

  it('an empty cache gives nothing', () => {
    expect(pickNodeEntry(cacheOf(), null, false, 'ble-a')).toBeNull();
  });
});

describe('snapshotLine', () => {
  // 2026-10-21 09:12 local; "now" a few hours later the same day.
  const at = new Date(2026, 9, 21, 9, 12).getTime();
  const now = new Date(2026, 9, 21, 14, 0).getTime();

  function req(hex: string | null, over: Partial<SavedRequestDto> = {}): SavedRequestDto {
    const raw = hex ? hexToBytes(hex) : null;
    const decoded = raw ? decodeLpp(raw) : null;
    return {
      id: 'r1',
      nodeKey: key('a'),
      source: 'companion',
      requestedAt: at,
      repliedAt: at + 100,
      outcome: 'ok',
      roundTripMs: 100,
      hops: null,
      route: 'local',
      aclRole: null,
      permsGranted: null,
      rawHex: raw ? bytesToHex(raw) : null,
      readings: decoded?.readings ?? [],
      restHex: '',
      ...over,
    };
  }

  it('time, then battery with its charge, then other readings, three values at most', () => {
    // ch 1 battery 4.04 V; ch 2 27.8 °C, 46%.
    const line = snapshotLine(req('01 74 01 94 02 67 01 16 02 68 5C'), '24h', now);
    expect(line).toMatch(/^Today 09:12 · 4\.04 V · \d+% · 27\.8 °C$/);
  });

  it('leaves positions out', () => {
    const line = snapshotLine(req('01 74 01 94 01 88 04 9C 22 F1 15 2A 00 41 C8'), '24h', now);
    expect(line).not.toMatch(/°[NSEW]|,/);
    expect(line.startsWith('Today 09:12 · 4.04 V')).toBe(true);
  });

  it('a failed read says so', () => {
    expect(snapshotLine(req(null, { outcome: 'timeout' }), '24h', now)).toBe('Today 09:12 · no reply');
    expect(snapshotLine(req(null, { outcome: 'error' }), '24h', now)).toBe('Today 09:12 · failed');
  });
});
