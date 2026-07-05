import type { Dirent } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TileCache } from '../../../../src/main/map/tile-cache';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-tc-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const buf = (n: number) => Buffer.alloc(n, 1);

describe('TileCache', () => {
  it('round-trips a tile and reports size', async () => {
    const cache = new TileCache(dir, 1_000);
    expect(await cache.get('basemap/1/2/3')).toBeNull();
    await cache.put('basemap/1/2/3', buf(100));
    const got = await cache.get('basemap/1/2/3');
    expect(got?.length).toBe(100);
    expect(await cache.size()).toEqual({ bytes: 100, count: 1 });
  });

  it('evicts least-recently-used tiles when the cap is exceeded', async () => {
    const cache = new TileCache(dir, 300); // low-water = 270
    await cache.put('a/0/0/0', buf(100));
    await cache.put('a/0/0/1', buf(100));
    await cache.put('a/0/0/2', buf(100)); // total 300, no eviction yet
    await cache.put('a/0/0/3', buf(100)); // total 400 > 300 -> evict oldest to <= 270
    expect(await cache.get('a/0/0/0')).toBeNull(); // oldest evicted
    expect(await cache.get('a/0/0/1')).toBeNull(); // second-oldest evicted
    expect((await cache.get('a/0/0/2'))?.length).toBe(100);
    expect((await cache.get('a/0/0/3'))?.length).toBe(100);
  });

  it('treats a get() as a recency bump so accessed tiles survive eviction', async () => {
    const cache = new TileCache(dir, 300);
    await cache.put('a/0/0/0', buf(100));
    await cache.put('a/0/0/1', buf(100));
    await cache.put('a/0/0/2', buf(100));
    await cache.get('a/0/0/0'); // bump 0 to most-recent
    await cache.put('a/0/0/3', buf(100)); // evict oldest -> now 1
    expect((await cache.get('a/0/0/0'))?.length).toBe(100);
    expect(await cache.get('a/0/0/1')).toBeNull();
  });

  it('lowering the cap via setMaxBytes evicts down to the low-water mark', async () => {
    const cache = new TileCache(dir, 1_000);
    await cache.put('a/0/0/0', buf(300));
    await cache.put('a/0/0/1', buf(300));
    await cache.setMaxBytes(300); // low-water 270 -> must drop to <= 270
    const info = await cache.size();
    expect(info.bytes).toBeLessThanOrEqual(270);
  });

  it('rebuilds its index from an existing directory', async () => {
    const first = new TileCache(dir, 1_000);
    await first.put('a/0/0/0', buf(100));
    await first.put('a/0/0/1', buf(150));
    const second = new TileCache(dir, 1_000); // fresh index, same dir
    expect(await second.size()).toEqual({ bytes: 250, count: 2 });
    expect((await second.get('a/0/0/1'))?.length).toBe(150);
  });

  it('clear() empties the cache', async () => {
    const cache = new TileCache(dir, 1_000);
    await cache.put('a/0/0/0', buf(100));
    await cache.clear();
    expect(await cache.size()).toEqual({ bytes: 0, count: 0 });
    expect(await cache.get('a/0/0/0')).toBeNull();
  });

  it('reconciles total/count when a cached file vanishes from disk (ENOENT)', async () => {
    const cache = new TileCache(dir, 1_000);
    await cache.put('a/0/0/0', buf(100));
    await cache.put('a/0/0/1', buf(150));
    // Something outside the cache deletes one tile file.
    rmSync(join(dir, 'a/0/0/0.mvt'));
    expect(await cache.get('a/0/0/0')).toBeNull();
    // The missing entry is dropped and its bytes removed from the running total.
    expect(await cache.size()).toEqual({ bytes: 150, count: 1 });
  });

  it('keeps total/count consistent with disk under concurrent puts over the cap', async () => {
    // maxBytes = 1000, low-water = 900. 40 puts of 100 bytes each = 4000 bytes
    // of writes, well over the cap, so many puts trip evictIfNeeded and race.
    const cache = new TileCache(dir, 1_000);
    await Promise.all(Array.from({ length: 40 }, (_, i) => cache.put(`a/0/0/${i}`, buf(100))));

    // Read the actual on-disk state and assert the in-memory index matches it.
    const onDisk = await readDiskStats(dir);
    const info = await cache.size();
    expect(info.bytes).toBe(onDisk.bytes);
    expect(info.count).toBe(onDisk.count);
    expect(info.bytes).toBeLessThanOrEqual(1_000);
  });
});

async function readDiskStats(root: string): Promise<{ bytes: number; count: number }> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    return { bytes: 0, count: 0 };
  }
  let bytes = 0;
  let count = 0;
  for (const d of entries) {
    if (!d.isFile() || !d.name.endsWith('.mvt')) continue;
    const st = await stat(join(d.parentPath, d.name));
    bytes += st.size;
    count += 1;
  }
  return { bytes, count };
}
