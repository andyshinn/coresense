# Online Map Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop shipping large bundled map tiles; keep a tiny maxzoom-5 world basemap as an offline backdrop, download all higher-detail tiles online from Protomaps with a required API key, cache them on disk (user-configurable LRU cap), drop 3D terrain, and show a persistent map-screen banner when the key is missing or rejected.

**Architecture:** The Electron main process already runs a local Hono HTTP server that (a) serves the bundled basemap PMTiles via a `pmtiles://` protocol and (b) proxies higher-zoom tiles from the Protomaps hosted API so the key never leaves main. We keep both, shrink the bundled basemap to maxzoom 5, add a file-per-tile LRU disk cache in front of the proxy, add a `mapTileStatus` broadcast slice so the renderer knows when the key is missing/rejected, remove terrain, and add a self-gating banner component plus settings cache controls.

**Tech Stack:** Electron + Electron Forge (Vite), Hono, maplibre-gl + pmtiles + @protomaps/basemaps, React 19 + zustand + shadcn/Radix + Tailwind v4, vitest (unit/integration/dom projects), Biome, pnpm.

## Global Constraints

- **Provider is fixed:** Protomaps hosted API `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=…`; glyphs/sprites load keyless from `https://protomaps.github.io/basemaps-assets/…`. Do not add other providers.
- **Keep the main api/state/map module graph Electron-free.** Do NOT add `import … from 'electron'` to `src/main/api/tiles.ts`, `src/main/api/routes.ts`, `src/main/state/holder.ts`, or `src/main/map/tile-cache.ts` — the integration tests import these via `createRoutes` in a Node env with no Electron runtime. Electron APIs (e.g. `shell.openPath`) are reached only through injected seams wired in `src/main/index.ts` (mirroring `setUserDataDir` / `setSecretStore`).
- **`fetch` is the Node global** (undici) — it auto-decompresses gzip and strips `Content-Encoding`, so `res.arrayBuffer()` yields decompressed MVT bytes. Cache and serve those bytes as-is. In tests, mock with `vi.stubGlobal('fetch', vi.fn(...))` + `vi.unstubAllGlobals()`.
- **Cache cap:** default `512 MB`; user presets `256 / 512 / 1024 / 2048 / 5120 MB`; server clamps to `[64 MB, 5 GB]`. Bytes = MB × 1024 × 1024.
- **Test layout / runner:** unit → `tests/unit/**/*.test.ts` (env `node`); integration → `tests/integration/**/*.test.ts` (env `node`; `tests/integration/setup.ts` seeds a temp userData dir + in-memory secret store per test; drive the real app via `createRoutes(deps)` + `app.request(path, init)`); dom → `tests/component/**/*.test.tsx` (env `jsdom`; seed the real zustand store via `useStore.getState().<action>(...)`). No `globals: true` — every test imports `{ describe, it, expect, vi }` from `vitest`. Unit tests use relative `../../../…/src/…` imports (not the `@` alias).
- **Verification gates per task:** `pnpm typecheck` and the task's tests must pass. The full suite baseline is green (282 tests / 79 files). Lint scope: `pnpm lint` (Biome) — do not run repo-wide lint on build artifacts.
- **Commits:** end every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  (In this worktree, `git add`/`git commit` require the sandbox disabled; other commands run sandboxed.)

---

### Task 1: Tile disk cache module (pure, LRU, unit-tested)

A dependency-free file-per-tile disk cache with an in-memory LRU index. No wiring yet — this task delivers the module and its unit tests in isolation.

**Files:**
- Create: `src/main/map/tile-cache.ts`
- Create: `tests/unit/main/map/tile-cache.test.ts`
- Modify: `src/shared/types.ts` (add `TileCacheInfo` type)

**Interfaces:**
- Produces:
  - `class TileCache { constructor(dir: string, maxBytes: number); dirPath(): string; setMaxBytes(n: number): Promise<void>; ensureDir(): Promise<void>; get(key: string): Promise<Buffer | null>; put(key: string, bytes: Buffer): Promise<void>; size(): Promise<TileCacheInfo>; clear(): Promise<void>; }`
  - `getTileCache(): TileCache` (process singleton bound to `join(userDataDir(), 'tile-cache')`, rebinds if the dir changes)
  - `setTileCacheOpener(fn: (dir: string) => void): void` / `revealTileCache(): Promise<void>` (open-in-file-manager seam)
  - `DEFAULT_TILE_CACHE_MAX_BYTES`, `MIN_TILE_CACHE_MAX_BYTES`, `MAX_TILE_CACHE_MAX_BYTES`, `clampTileCacheMaxBytes(value: unknown): number`
  - `interface TileCacheInfo { bytes: number; count: number }` (in `src/shared/types.ts`)

- [ ] **Step 1: Add the `TileCacheInfo` type to shared types**

In `src/shared/types.ts`, immediately after the `TileManifest` interface (the block ending with the `}` after `terrain: TileManifestEntry | null;`), add:

```ts
export interface TileCacheInfo {
  /** Total bytes of cached online tiles on disk. */
  bytes: number;
  /** Number of cached tile files. */
  count: number;
}
```

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/main/map/tile-cache.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
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
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run --project unit tests/unit/main/map/tile-cache.test.ts`
Expected: FAIL — `Cannot find module '../../../../src/main/map/tile-cache'`.

- [ ] **Step 4: Implement `src/main/map/tile-cache.ts`**

Create `src/main/map/tile-cache.ts`:

```ts
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { TileCacheInfo } from '../../shared/types';
import { userDataDir } from '../runtime/userData';

/** Default on-disk cap for cached online tiles (512 MB). */
export const DEFAULT_TILE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
/** Clamp bounds for the user-configurable cap. */
export const MIN_TILE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const MAX_TILE_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Clamp an inbound cap (from renderer settings) into the allowed range. */
export function clampTileCacheMaxBytes(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TILE_CACHE_MAX_BYTES;
  return Math.min(MAX_TILE_CACHE_MAX_BYTES, Math.max(MIN_TILE_CACHE_MAX_BYTES, Math.floor(n)));
}

interface Entry {
  size: number;
  /** Monotonic access stamp for LRU ordering (higher = more recent). */
  atime: number;
}

/**
 * File-per-tile disk cache with an in-memory LRU index. Tiles live at
 * `<dir>/<key>.mvt` where key is `<source>/<z>/<x>/<y>`. The index is built
 * lazily by walking the dir; total bytes are tracked so a `put` past the cap
 * evicts least-recently-used files down to a 90% low-water mark.
 */
export class TileCache {
  private index = new Map<string, Entry>();
  private total = 0;
  private clock = 0;
  private ready: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private maxBytes: number,
  ) {}

  dirPath(): string {
    return this.dir;
  }

  async setMaxBytes(next: number): Promise<void> {
    this.maxBytes = next;
    await this.ensureIndex();
    await this.evictIfNeeded();
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key}.mvt`);
  }

  private ensureIndex(): Promise<void> {
    if (!this.ready) this.ready = this.buildIndex();
    return this.ready;
  }

  private async buildIndex(): Promise<void> {
    this.index.clear();
    this.total = 0;
    let maxStamp = 0;
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(this.dir, { recursive: true, withFileTypes: true });
    } catch {
      return; // dir doesn't exist yet
    }
    for (const d of entries) {
      if (!d.isFile() || !d.name.endsWith('.mvt')) continue;
      const full = join(d.parentPath, d.name);
      const rel = full.slice(this.dir.length + 1);
      const key = rel.slice(0, -'.mvt'.length).split(sep).join('/');
      const st = await stat(full);
      this.index.set(key, { size: st.size, atime: st.mtimeMs });
      this.total += st.size;
      if (st.mtimeMs > maxStamp) maxStamp = st.mtimeMs;
    }
    this.clock = maxStamp;
  }

  async get(key: string): Promise<Buffer | null> {
    await this.ensureIndex();
    const entry = this.index.get(key);
    if (!entry) return null;
    try {
      const bytes = await readFile(this.pathFor(key));
      entry.atime = ++this.clock;
      return bytes;
    } catch {
      this.index.delete(key);
      this.total -= entry.size;
      return null;
    }
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    await this.ensureIndex();
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    const prev = this.index.get(key);
    if (prev) this.total -= prev.size;
    this.index.set(key, { size: bytes.length, atime: ++this.clock });
    this.total += bytes.length;
    await this.evictIfNeeded();
  }

  private async evictIfNeeded(): Promise<void> {
    if (this.total <= this.maxBytes) return;
    const low = Math.floor(this.maxBytes * 0.9);
    const ordered = [...this.index.entries()].sort((a, b) => a[1].atime - b[1].atime);
    for (const [key, entry] of ordered) {
      if (this.total <= low) break;
      await rm(this.pathFor(key), { force: true });
      this.index.delete(key);
      this.total -= entry.size;
    }
  }

  async size(): Promise<TileCacheInfo> {
    await this.ensureIndex();
    return { bytes: this.total, count: this.index.size };
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
    this.index.clear();
    this.total = 0;
    this.clock = 0;
    this.ready = null; // force a rebuild on next op
  }
}

let singleton: TileCache | null = null;

/** Process-wide cache bound to the current userData dir. Rebinds if the dir
 *  changes (e.g. between tests that inject a temp userData dir). */
export function getTileCache(): TileCache {
  const dir = join(userDataDir(), 'tile-cache');
  if (!singleton || singleton.dirPath() !== dir) {
    singleton = new TileCache(dir, DEFAULT_TILE_CACHE_MAX_BYTES);
  }
  return singleton;
}

// --- Open-in-file-manager seam (real impl injected from src/main/index.ts) ---
let opener: (dir: string) => void = () => {};

export function setTileCacheOpener(fn: (dir: string) => void): void {
  opener = fn;
}

export async function revealTileCache(): Promise<void> {
  const cache = getTileCache();
  await cache.ensureDir();
  opener(cache.dirPath());
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run --project unit tests/unit/main/map/tile-cache.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/map/tile-cache.ts tests/unit/main/map/tile-cache.test.ts src/shared/types.ts
git commit -m "feat(map): add LRU disk tile cache module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `mapTileStatus` broadcast slice (main → renderer)

Add a runtime status object `{ keyConfigured, keyRejected }` broadcast to the renderer, following the exact `mapSettings` / `mapManifest` plumbing. `keyConfigured` flips in the api-key routes here; `keyRejected` is flipped by the tile proxy in Task 3.

**Files:**
- Modify: `src/shared/types.ts` (add `MapTileStatus`, `DEFAULT_MAP_TILE_STATUS`, snapshot field, WS variant)
- Modify: `src/main/state/holder.ts` (field + getter/setter)
- Modify: `src/main/events/bus.ts` (`emit.mapTileStatus` + `BusEvents`)
- Modify: `src/main/server.ts` (WS bridge handler + subscribe/unsubscribe)
- Modify: `src/main/api/routes.ts` (snapshot payload + api-key handlers)
- Modify: `src/renderer/lib/store.ts` (state field, action, default, hydrate)
- Modify: `src/renderer/app/wsHandlers.ts` (WS case)
- Create: `tests/integration/api/map-tile-status.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `interface MapTileStatus { keyConfigured: boolean; keyRejected: boolean }` + `DEFAULT_MAP_TILE_STATUS`
  - holder `getMapTileStatus(): MapTileStatus` / `setMapTileStatus(next: MapTileStatus): void`
  - `emit.mapTileStatus(status: MapTileStatus): void`
  - store `mapTileStatus: MapTileStatus` + `applyMapTileStatus(status: MapTileStatus): void`

- [ ] **Step 1: Add shared types**

In `src/shared/types.ts`, immediately after `DEFAULT_MAP_SETTINGS` (the object literal ending `showMarkerLabels: false,\n};`) add:

```ts
/** Runtime status of online tile access — not a user setting, not persisted.
 *  `keyConfigured` mirrors the encrypted-blob presence; `keyRejected` flips
 *  when Protomaps rejects the key (401/403) and clears on the next success. */
export interface MapTileStatus {
  keyConfigured: boolean;
  keyRejected: boolean;
}

export const DEFAULT_MAP_TILE_STATUS: MapTileStatus = {
  keyConfigured: false,
  keyRejected: false,
};
```

In the `StateSnapshot` interface, immediately after the `mapManifest: TileManifest;` field, add:

```ts
  /** Runtime online-tile status (key configured / key rejected). */
  mapTileStatus: MapTileStatus;
```

In the `WsMessage` union, immediately after `| { type: 'mapManifest'; payload: TileManifest }`, add:

```ts
  | { type: 'mapTileStatus'; payload: MapTileStatus }
```

- [ ] **Step 2: Add the holder field + accessors**

In `src/main/state/holder.ts`:

- Add `MapTileStatus` to the shared-types import (the block that already imports `MapSettings`).
- Add a private field near the other private fields (e.g. next to `private mapSettings`):

```ts
  private mapTileStatus: MapTileStatus;
```

- In the constructor, immediately after the `this.mapSettings = { ...settingsStore.loadMapSettings(), hasProtomapsApiKey: hasApiKey() };` assignment, add:

```ts
    // Runtime-only status (never persisted). keyConfigured mirrors the blob.
    this.mapTileStatus = { keyConfigured: hasApiKey(), keyRejected: false };
```

- Add accessors next to `getMapSettings`/`setMapSettings`:

```ts
  getMapTileStatus(): MapTileStatus {
    return this.mapTileStatus;
  }

  setMapTileStatus(next: MapTileStatus): void {
    this.mapTileStatus = next; // in-memory only — not saved to disk
  }
```

- [ ] **Step 3: Add the emit method + bus event type**

In `src/main/events/bus.ts`:

- Add `MapTileStatus` to the shared-types import block.
- In the `emit` object, immediately after the `mapManifest:` line, add:

```ts
  mapTileStatus: (status: MapTileStatus) => bus.emit('mapTileStatus', status),
```

- In the `BusEvents` type, immediately after the `mapManifest:` line, add:

```ts
  mapTileStatus: (status: MapTileStatus) => void;
```

- [ ] **Step 4: Bridge the event to WebSocket clients**

In `src/main/server.ts`:

- Add `MapTileStatus` to the shared-types import block.
- Immediately after `const onMapManifest = (manifest: TileManifest) => broadcast({ type: 'mapManifest', payload: manifest });` add:

```ts
  const onMapTileStatus = (status: MapTileStatus) => broadcast({ type: 'mapTileStatus', payload: status });
```

- Immediately after `bus.on('mapManifest', onMapManifest);` add:

```ts
  bus.on('mapTileStatus', onMapTileStatus);
```

- In `close()`, immediately after `bus.off('mapManifest', onMapManifest);` add:

```ts
  bus.off('mapTileStatus', onMapTileStatus);
```

- [ ] **Step 5: Seed the snapshot + flip keyConfigured in the api-key routes**

In `src/main/api/routes.ts`:

- In the `GET /api/state/snapshot` payload object, immediately after `mapManifest: await buildTileManifest(),` add:

```ts
      mapTileStatus: holder.getMapTileStatus(),
```

- In `POST /api/map/api-key`, immediately after `emit.mapSettings(next);` (the success path, before `return c.json({ ok: true, hasKey: true });`) add:

```ts
    holder.setMapTileStatus({ keyConfigured: true, keyRejected: false });
    emit.mapTileStatus(holder.getMapTileStatus());
```

- In `DELETE /api/map/api-key`, immediately after its `emit.mapSettings(next);` add:

```ts
    holder.setMapTileStatus({ keyConfigured: false, keyRejected: false });
    emit.mapTileStatus(holder.getMapTileStatus());
```

- [ ] **Step 6: Add the renderer store slice**

In `src/renderer/lib/store.ts`:

- Add `MapTileStatus` and `DEFAULT_MAP_TILE_STATUS` to the shared-types import.
- In the state interface, immediately after `mapManifest: TileManifest;`, add:

```ts
  mapTileStatus: MapTileStatus;
```

- In the actions interface, immediately after `applyMapManifest: (manifest: TileManifest) => void;`, add:

```ts
  applyMapTileStatus: (status: MapTileStatus) => void;
```

- In the action implementations, immediately after `applyMapManifest: (manifest) => set(() => ({ mapManifest: manifest })),`, add:

```ts
  applyMapTileStatus: (status) => set(() => ({ mapTileStatus: status })),
```

- In the initial state object, immediately after `mapManifest: DEFAULT_MAP_MANIFEST,`, add:

```ts
  mapTileStatus: DEFAULT_MAP_TILE_STATUS,
```

- In `hydrate(...)`, immediately after `mapManifest: snapshot.mapManifest,`, add:

```ts
      mapTileStatus: snapshot.mapTileStatus,
```

- [ ] **Step 7: Handle the WS message in the renderer**

In `src/renderer/app/wsHandlers.ts`, immediately after the `case 'mapManifest':` block (the one ending `break;`), add:

```ts
      case 'mapTileStatus':
        s.applyMapTileStatus(msg.payload);
        break;
```

- [ ] **Step 8: Write the integration test**

Create `tests/integration/api/map-tile-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import type { StateSnapshot } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

describe('mapTileStatus', () => {
  it('is present in the state snapshot', async () => {
    const res = await app().request('/api/state/snapshot');
    const snap = (await res.json()) as StateSnapshot;
    expect(snap.mapTileStatus).toEqual({ keyConfigured: expect.any(Boolean), keyRejected: false });
  });

  it('flips keyConfigured true after saving a key and false after clearing', async () => {
    const a = app();
    await a.request('/api/map/api-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'pm-secret' }),
    });
    let snap = (await (await a.request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snap.mapTileStatus.keyConfigured).toBe(true);

    await a.request('/api/map/api-key', { method: 'DELETE' });
    snap = (await (await a.request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snap.mapTileStatus.keyConfigured).toBe(false);
  });
});
```

- [ ] **Step 9: Run the test + typecheck**

Run: `pnpm vitest run --project integration tests/integration/api/map-tile-status.test.ts`
Expected: PASS (2 tests).
Run: `pnpm typecheck`
Expected: no errors. (If a `StateSnapshot` object literal elsewhere now errors on the missing `mapTileStatus` field, run `grep -rn "mapManifest:" src tests` and add `mapTileStatus` alongside it.)

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/main/state/holder.ts src/main/events/bus.ts src/main/server.ts src/main/api/routes.ts src/renderer/lib/store.ts src/renderer/app/wsHandlers.ts tests/integration/api/map-tile-status.test.ts
git commit -m "feat(map): broadcast mapTileStatus (keyConfigured/keyRejected)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Cache the online proxy + flip keyRejected + configurable cap

Wire the LRU cache and the `keyRejected` status into the existing online tile proxy, and add the user-configurable `tileCacheMaxBytes` cap (field + clamp + `setMaxBytes` wiring).

**Files:**
- Modify: `src/shared/types.ts` (`MapSettings.tileCacheMaxBytes` + default)
- Modify: `src/main/api/tiles.ts` (cache lookup/store + keyRejected flip)
- Modify: `src/main/api/routes.ts` (apply cap on boot + on PUT)
- Create: `tests/integration/api/tile-proxy.test.ts`

**Interfaces:**
- Consumes: `getTileCache`, `clampTileCacheMaxBytes` (Task 1); holder `getMapTileStatus`/`setMapTileStatus`, `emit.mapTileStatus` (Task 2).
- Produces: `MapSettings.tileCacheMaxBytes: number`.

- [ ] **Step 1: Add `tileCacheMaxBytes` to MapSettings + default**

In `src/shared/types.ts`, inside `interface MapSettings`, immediately after `showMarkerLabels: boolean;`, add:

```ts
  /** On-disk cap (bytes) for cached online tiles. Clamped server-side to
   *  [64 MB, 5 GB]. Default 512 MB. */
  tileCacheMaxBytes: number;
```

In `DEFAULT_MAP_SETTINGS`, immediately after `showMarkerLabels: false,`, add:

```ts
  tileCacheMaxBytes: 512 * 1024 * 1024,
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/api/tile-proxy.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import type { StateSnapshot } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

function fakeResponse(status: number, bytes = new Uint8Array([1, 2, 3, 4])) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/x-protobuf' },
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as unknown as Response;
}

async function setKey(a: ReturnType<typeof app>) {
  await a.request('/api/map/api-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'pm-secret' }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('online tile proxy', () => {
  it('returns 404 no_api_key when no key is set', async () => {
    const res = await app().request('/api/map/online-tile-proxy/basemap/6/10/20');
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'no_api_key' });
  });

  it('caches a fetched tile so the second request does not hit upstream', async () => {
    const a = app();
    await setKey(a);
    const fetchMock = vi.fn(async () => fakeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const first = await a.request('/api/map/online-tile-proxy/basemap/7/11/22');
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    const second = await a.request('/api/map/online-tile-proxy/basemap/7/11/22');
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // served from cache
  });

  it('maps upstream 401 to a rejected key + 401, then clears on success', async () => {
    const a = app();
    await setKey(a);

    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(401)));
    const rejected = await a.request('/api/map/online-tile-proxy/basemap/8/1/1');
    expect(rejected.status).toBe(401);
    let snap = (await (await a.request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snap.mapTileStatus.keyRejected).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200)));
    const ok = await a.request('/api/map/online-tile-proxy/basemap/8/2/2');
    expect(ok.status).toBe(200);
    snap = (await (await a.request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snap.mapTileStatus.keyRejected).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify the cache/keyRejected assertions fail**

Run: `pnpm vitest run --project integration tests/integration/api/tile-proxy.test.ts`
Expected: FAIL — the "caches a fetched tile" test fails (fetch called twice) and the 401 test fails (proxy currently returns 502, and `keyRejected` never flips).

- [ ] **Step 4: Rewrite the proxy handler in `src/main/api/tiles.ts`**

Add these imports at the top (with the other `../` imports):

```ts
import { emit } from '../events/bus';
import { getTileCache } from '../map/tile-cache';
import { stateHolder } from '../state/holder';
```

Add this helper just above `registerTileRoutes`:

```ts
function markKeyRejected(rejected: boolean): void {
  const holder = stateHolder();
  const current = holder.getMapTileStatus();
  if (current.keyRejected === rejected) return; // only broadcast on change
  const next = { ...current, keyRejected: rejected };
  holder.setMapTileStatus(next);
  emit.mapTileStatus(next);
}
```

Replace the entire `api.get('/api/map/online-tile-proxy/:source/:z/:x/:y', …)` handler body with:

```ts
  api.get('/api/map/online-tile-proxy/:source/:z/:x/:y', async (c) => {
    const source = c.req.param('source');
    if (!isTileSource(source)) {
      return c.json({ error: 'unknown source' }, 400);
    }
    const key = await getProtomapsApiKey();
    if (!key) return c.json({ error: 'no_api_key' }, 404);

    const z = c.req.param('z');
    const x = c.req.param('x');
    const y = c.req.param('y');
    const cache = getTileCache();
    const cacheKey = `${source}/${z}/${x}/${y}`;

    const cached = await cache.get(cacheKey);
    if (cached) {
      return c.body(toArrayBuffer(cached), 200, {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'private, max-age=300',
      });
    }

    const upstream = `${PROTOMAPS_TILE_BASE}/${z}/${x}/${y}.mvt?key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(upstream);
      if (res.status === 401 || res.status === 403) {
        // Bad/expired key — surface it so the renderer can prompt the user.
        markKeyRejected(true);
        return c.body(null, 401);
      }
      if (res.status === 404) {
        // Out-of-coverage tile — 204 so MapLibre stops retrying.
        return c.body(null, 204);
      }
      if (!res.ok) {
        log.warn(`upstream ${res.status} for ${z}/${x}/${y}`);
        return c.body(null, 502);
      }
      const buf = await res.arrayBuffer();
      markKeyRejected(false);
      await cache.put(cacheKey, Buffer.from(buf));
      return c.body(buf, 200, {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'private, max-age=300',
      });
    } catch (err) {
      log.warn(`fetch failed for ${z}/${x}/${y}: ${(err as Error).message}`);
      return c.body(null, 502);
    }
  });
```

- [ ] **Step 5: Apply the cap on boot and on settings change in `src/main/api/routes.ts`**

Add to the imports:

```ts
import { clampTileCacheMaxBytes, getTileCache } from '../map/tile-cache';
```

In `createRoutes`, immediately after `registerTileRoutes(api);`, add:

```ts
  // Apply the persisted cache cap on startup.
  void getTileCache().setMaxBytes(stateHolder().getMapSettings().tileCacheMaxBytes);
```

In the `PUT /api/settings/map` handler, replace the `sanitized` object + `setMapSettings` lines with:

```ts
    const sanitized: MapSettings = {
      ...body,
      hasProtomapsApiKey: current.hasProtomapsApiKey,
      tileCacheMaxBytes: clampTileCacheMaxBytes(body.tileCacheMaxBytes),
    };
    holder.setMapSettings(sanitized);
    void getTileCache().setMaxBytes(sanitized.tileCacheMaxBytes);
    emit.mapSettings(sanitized);
```

- [ ] **Step 6: Run the test + typecheck**

Run: `pnpm vitest run --project integration tests/integration/api/tile-proxy.test.ts`
Expected: PASS (3 tests).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Run the full suite (guards against regressions from the MapSettings field)**

Run: `pnpm test`
Expected: all pass (283+ tests). If a `MapSettings` literal in a test fixture now lacks `tileCacheMaxBytes`, add it (`tileCacheMaxBytes: 512 * 1024 * 1024`).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/api/tiles.ts src/main/api/routes.ts tests/integration/api/tile-proxy.test.ts
git commit -m "feat(map): cache online tiles + detect rejected key + configurable cap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cache management routes + settings UI (size, clear, open, cap)

Expose cache size/clear/open routes, add renderer API helpers, and add a cache block to the Map Tiles settings section with a size display, a cap `Select`, and Clear / Open-folder buttons.

**Files:**
- Modify: `src/main/api/tiles.ts` (GET/DELETE/POST tile-cache routes)
- Modify: `src/main/index.ts` (wire `setTileCacheOpener`)
- Modify: `src/renderer/lib/api.ts` (`getTileCacheInfo`, `clearTileCache`, `openTileCacheFolder`)
- Modify: `src/renderer/components/settings/MapKeySection.tsx` (cache block)
- Create: `tests/integration/api/tile-cache-routes.test.ts`
- Create: `tests/component/map-key-section-cache.test.tsx`

**Interfaces:**
- Consumes: `getTileCache`, `revealTileCache`, `setTileCacheOpener` (Task 1); `TileCacheInfo` (Task 1); `MapSettings.tileCacheMaxBytes` (Task 3); `api.putMapSettings`, store `applyMapSettings` (existing).
- Produces: `api.getTileCacheInfo(c)`, `api.clearTileCache(c)`, `api.openTileCacheFolder(c)`.

- [ ] **Step 1: Write the failing route integration test**

Create `tests/integration/api/tile-cache-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import type { TileCacheInfo } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

describe('tile cache routes', () => {
  it('reports cache size', async () => {
    const res = await app().request('/api/map/tile-cache');
    expect(res.status).toBe(200);
    const info = (await res.json()) as TileCacheInfo;
    expect(info).toEqual({ bytes: expect.any(Number), count: expect.any(Number) });
  });

  it('clears the cache and returns zeroed info', async () => {
    const res = await app().request('/api/map/tile-cache', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()) as TileCacheInfo).toEqual({ bytes: 0, count: 0 });
  });

  it('acknowledges an open-folder request', async () => {
    const res = await app().request('/api/map/tile-cache/open', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project integration tests/integration/api/tile-cache-routes.test.ts`
Expected: FAIL — all three routes 404 (not registered yet).

- [ ] **Step 3: Add the routes in `src/main/api/tiles.ts`**

Add `revealTileCache` to the tile-cache import (which already imports `getTileCache`):

```ts
import { getTileCache, revealTileCache } from '../map/tile-cache';
```

Inside `registerTileRoutes`, immediately before the closing `}` of the function (after the online-tile-proxy route), add:

```ts
  api.get('/api/map/tile-cache', async (c) => c.json(await getTileCache().size()));

  api.delete('/api/map/tile-cache', async (c) => {
    await getTileCache().clear();
    return c.json(await getTileCache().size());
  });

  api.post('/api/map/tile-cache/open', async (c) => {
    await revealTileCache();
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `pnpm vitest run --project integration tests/integration/api/tile-cache-routes.test.ts`
Expected: PASS (3 tests). (`revealTileCache`'s opener defaults to a no-op in tests.)

- [ ] **Step 5: Wire the real opener in `src/main/index.ts`**

Add to the seam imports (near `import { setUserDataDir } from './runtime/userData';`):

```ts
import { setTileCacheOpener } from './map/tile-cache';
```

In the seam-wiring block at the top of the file, immediately after the `setSecretStore({ … });` call, add:

```ts
setTileCacheOpener((dir) => {
  void shell.openPath(dir).catch((err) => console.error('openPath failed', err));
});
```

(`shell` is already imported from `'electron'` in this file.)

- [ ] **Step 6: Add renderer API helpers in `src/renderer/lib/api.ts`**

Add `TileCacheInfo` to the shared-types import used by this file (it already imports `MapSettings`). Then, in the `api` object immediately after `clearProtomapsApiKey: …`, add:

```ts
  getTileCacheInfo: (c: ApiClient) => request<TileCacheInfo>(c, '/api/map/tile-cache'),
  clearTileCache: (c: ApiClient) => request<TileCacheInfo>(c, '/api/map/tile-cache', { method: 'DELETE' }),
  openTileCacheFolder: (c: ApiClient) => request<{ ok: true }>(c, '/api/map/tile-cache/open', { method: 'POST' }),
```

- [ ] **Step 7: Write the failing settings DOM test**

Create `tests/component/map-key-section-cache.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: {
    setProtomapsApiKey: vi.fn(async () => ({ ok: true, hasKey: true })),
    clearProtomapsApiKey: vi.fn(async () => ({ ok: true, hasKey: false })),
    getTileCacheInfo: vi.fn(async () => ({ bytes: 25 * 1024 * 1024, count: 3 })),
    clearTileCache: vi.fn(async () => ({ bytes: 0, count: 0 })),
    openTileCacheFolder: vi.fn(async () => ({ ok: true })),
    putMapSettings: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { MapKeySection } from '../../src/renderer/components/settings/MapKeySection';
import { api } from '../../src/renderer/lib/api';

const client = { baseUrl: 'http://x', apiKey: 'k' };

afterEach(() => vi.clearAllMocks());

describe('MapKeySection cache controls', () => {
  it('shows the current cache size on mount', async () => {
    render(<MapKeySection client={client} />);
    expect(await screen.findByText(/25\.0 MB/)).toBeTruthy();
  });

  it('clears the cache and refreshes size', async () => {
    render(<MapKeySection client={client} />);
    await waitFor(() => expect(api.getTileCacheInfo).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /clear cache/i }));
    await waitFor(() => expect(api.clearTileCache).toHaveBeenCalledWith(client));
  });

  it('opens the cache folder', async () => {
    render(<MapKeySection client={client} />);
    fireEvent.click(screen.getByRole('button', { name: /open folder/i }));
    await waitFor(() => expect(api.openTileCacheFolder).toHaveBeenCalledWith(client));
  });

  it('persists a new cap when the select changes', async () => {
    render(<MapKeySection client={client} />);
    fireEvent.change(screen.getByLabelText(/cache size limit/i), {
      target: { value: String(1024 * 1024 * 1024) },
    });
    await waitFor(() => expect(api.putMapSettings).toHaveBeenCalled());
  });
});
```

- [ ] **Step 8: Run the DOM test to verify it fails**

Run: `pnpm vitest run --project dom tests/component/map-key-section-cache.test.tsx`
Expected: FAIL — no cache size text / buttons / select yet.

- [ ] **Step 9: Add the cache block to `src/renderer/components/settings/MapKeySection.tsx`**

Update the imports:

```tsx
import { Map as MapIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { Row, TextInput } from './Field';
import { SettingsSection } from './SettingsSection';
```

(The cap uses an inline labelled `<select>` — see below — so `Select` from `./Field` is not imported.)

Add cache constants above the component:

```tsx
const MB = 1024 * 1024;
const CACHE_CAP_OPTIONS = [256, 512, 1024, 2048, 5120].map((mb) => ({
  value: String(mb * MB),
  label: mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`,
}));

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
```

Inside the component, add store reads + cache state + effects + handlers after the existing `const [busy, setBusy] = useState(false);`:

```tsx
  const settings = useStore((s) => s.mapSettings);
  const applyMapSettings = useStore((s) => s.applyMapSettings);
  const [cacheInfo, setCacheInfo] = useState<{ bytes: number; count: number } | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    api
      .getTileCacheInfo(client)
      .then((info) => {
        if (!cancelled) setCacheInfo(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function clearCache() {
    if (!client) return;
    setBusy(true);
    try {
      const info = await api.clearTileCache(client);
      setCacheInfo(info);
      notify.success('Tile cache cleared');
    } catch (err) {
      notify.error(`Failed to clear cache: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  }

  function openCacheFolder() {
    if (!client) return;
    void api.openTileCacheFolder(client).catch((err) => notify.error(`Failed to open folder: ${(err as Error).message}`, err));
  }

  function setCacheCap(bytes: number) {
    const next = { ...settings, tileCacheMaxBytes: bytes };
    applyMapSettings(next);
    if (client) void api.putMapSettings(client, next);
  }
```

Then, inside the `<SettingsSection …>` element, immediately after the existing key `<Row … />`, add the cache rows. The cap uses an inline `<select>` with an explicit `aria-label` (so the DOM test's `getByLabelText(/cache size limit/i)` resolves it — the `Field` `Select` component has no `aria-label` support):

```tsx
      <Row
        label="Cache size limit"
        description="Downloaded tiles are cached on disk up to this size; oldest tiles are evicted first."
        control={
          <select
            aria-label="Cache size limit"
            value={String(settings.tileCacheMaxBytes)}
            disabled={!client}
            onChange={(e) => setCacheCap(Number(e.target.value))}
            className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {CACHE_CAP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        }
      />
      <Row
        label="Tile cache"
        description={cacheInfo ? `${formatBytes(cacheInfo.bytes)} · ${cacheInfo.count} tiles` : 'Loading…'}
        control={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCacheFolder}
              disabled={!client}
              className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open folder
            </button>
            <button
              type="button"
              onClick={clearCache}
              disabled={busy || !client}
              className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear cache
            </button>
          </div>
        }
      />
```

- [ ] **Step 10: Run the DOM test to verify it passes**

Run: `pnpm vitest run --project dom tests/component/map-key-section-cache.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 11: Typecheck + lint the touched files**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm lint`
Expected: no errors (fix any unused import Biome flags).

- [ ] **Step 12: Commit**

```bash
git add src/main/api/tiles.ts src/main/index.ts src/renderer/lib/api.ts src/renderer/components/settings/MapKeySection.tsx tests/integration/api/tile-cache-routes.test.ts tests/component/map-key-section-cache.test.tsx
git commit -m "feat(map): tile-cache management routes + settings controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Remove 3D terrain / hillshade end-to-end + build config + asset

Delete the terrain DEM feature across shared types, main, and renderer; shrink the bundled tiles config to basemap-only; and commit the maxzoom-5 world basemap the user already extracted.

**Files:**
- Modify: `src/shared/types.ts` (`TileSource`, `TileManifest`, `MapSettings`, defaults)
- Modify: `src/main/map/tile-paths.ts`, `src/main/api/tiles.ts` (basemap-only manifest/guard)
- Modify: `src/renderer/lib/map/style-builder.ts`, `flavors.ts`, `pmtiles-protocol.ts`
- Modify: `src/renderer/components/map/MapCanvas.tsx`, `src/renderer/panels/map/ControlsCard.tsx`
- Modify: `src/renderer/lib/store.ts` (`DEFAULT_MAP_MANIFEST`)
- Modify: `forge.config.ts`, `scripts/build-tiles.md`
- Create: `tests/unit/renderer/lib/map/style-builder.test.ts`
- Asset: commit `resources/tiles/basemap.pmtiles` (14 MB, maxzoom 5) + deletion of `resources/tiles/terrain.pmtiles`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TileSource = 'basemap'`; `TileManifest = { missing; basemap }`; `MapSettings` without `terrainHillshadeEnabled`/`terrain3DEnabled`.

- [ ] **Step 1: Write the failing style-builder unit test**

Create `tests/unit/renderer/lib/map/style-builder.test.ts` (mocks `pmtiles-protocol` so `maplibre-gl` is never imported in the node env):

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/map/pmtiles-protocol', () => ({
  pmtilesUrl: (baseUrl: string, source: string) => `pmtiles://${baseUrl}/api/tiles/${source}`,
}));

import { buildStyle, maxZoomForSettings, SOURCE_BASEMAP, SOURCE_ONLINE } from '../../../../../src/renderer/lib/map/style-builder';
import { DEFAULT_MAP_SETTINGS, type MapSettings, type TileManifest } from '../../../../../src/shared/types';

const manifest: TileManifest = {
  missing: false,
  basemap: {
    source: 'basemap',
    bytes: 14_000_000,
    minZoom: 0,
    maxZoom: 5,
    bounds: [-180, -85, 180, 85],
    center: { lng: 0, lat: 0, zoom: 2 },
    tileType: 1,
  },
};
const settings = (over: Partial<MapSettings> = {}): MapSettings => ({ ...DEFAULT_MAP_SETTINGS, ...over });

describe('buildStyle', () => {
  it('has no terrain source or hillshade layer', () => {
    const style = buildStyle({ baseUrl: 'http://x', manifest, settings: settings(), theme: 'light' });
    expect(style.sources['terrain-dem']).toBeUndefined();
    expect(style.layers.some((l) => l.type === 'hillshade')).toBe(false);
    expect(style.sources[SOURCE_BASEMAP]).toBeDefined();
  });

  it('adds the online source only when a key is configured', () => {
    const withoutKey = buildStyle({ baseUrl: 'http://x', manifest, settings: settings({ hasProtomapsApiKey: false }), theme: 'light' });
    expect(withoutKey.sources[SOURCE_ONLINE]).toBeUndefined();
    const withKey = buildStyle({ baseUrl: 'http://x', manifest, settings: settings({ hasProtomapsApiKey: true }), theme: 'light' });
    expect(withKey.sources[SOURCE_ONLINE]).toBeDefined();
  });

  it('caps the camera near the bundled maxzoom without a key and at 18 with one', () => {
    expect(maxZoomForSettings(manifest, settings({ hasProtomapsApiKey: false }))).toBe(5);
    expect(maxZoomForSettings(manifest, settings({ hasProtomapsApiKey: true }))).toBe(18);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project unit tests/unit/renderer/lib/map/style-builder.test.ts`
Expected: FAIL to compile/run — `TileManifest`/`MapSettings` still require `terrain`/terrain fields, and the manifest literal omits them.

- [ ] **Step 3: Trim the shared types**

In `src/shared/types.ts`:

- Change `export type TileSource = 'basemap' | 'terrain';` → `export type TileSource = 'basemap';`
- Replace the `TileManifest` interface with:

```ts
export interface TileManifest {
  /** True when the bundled basemap is not available on disk — the Map panel
   *  renders an empty-state with instructions instead of mounting MapLibre. */
  missing: boolean;
  basemap: TileManifestEntry | null;
}
```

- In `interface MapSettings`, delete the `terrainHillshadeEnabled` and `terrain3DEnabled` fields (and their doc comments).
- In `DEFAULT_MAP_SETTINGS`, delete the `terrainHillshadeEnabled: true,` and `terrain3DEnabled: false,` lines.

- [ ] **Step 4: Basemap-only manifest in main**

In `src/main/map/tile-paths.ts`:

- Change `const TILE_SOURCES: readonly TileSource[] = ['basemap', 'terrain'];` → `const TILE_SOURCES: readonly TileSource[] = ['basemap'];`
- Replace `listAvailableTiles` body's returned object with just `{ basemap: tilePathIfExists('basemap') }` (drop the `terrain:` line).

In `src/main/api/tiles.ts`:

- Change `isTileSource` to: `function isTileSource(value: string): value is TileSource { return value === 'basemap'; }`
- Replace `buildTileManifest` with:

```ts
export async function buildTileManifest(): Promise<TileManifest> {
  const path = tilePathIfExists('basemap');
  if (!path) return { missing: true, basemap: null };
  try {
    return { missing: false, basemap: await readManifestEntry('basemap', path) };
  } catch {
    return { missing: true, basemap: null };
  }
}
```

- The rewritten `buildTileManifest` no longer calls `allTileSources`, so change the tile-paths import in `tiles.ts` from `import { allTileSources, tilePathIfExists } from '../map/tile-paths';` to `import { tilePathIfExists } from '../map/tile-paths';` (Biome flags the unused import otherwise). Leave `allTileSources` exported from `tile-paths.ts`.

- [ ] **Step 5: Remove terrain from the renderer style layer**

In `src/renderer/lib/map/style-builder.ts`:

- Change the flavors import to `import { coresenseFlavor } from './flavors';` (drop `hillshadeColors`).
- Delete the exported constants `SOURCE_TERRAIN` and `LAYER_HILLSHADE` (they are only consumed by the terrain code being removed).
- Delete the entire `if (manifest.terrain) { … insertHillshade(style, …); }` block inside `buildStyle`.
- Delete the whole `insertHillshade(...)` function.
- Leave `SOURCE_BASEMAP`, `SOURCE_ONLINE`, `ONLINE_LAYER_SUFFIX`, `ONLINE_MAX_ZOOM`, `ONLINE_CAMERA_MAX_ZOOM`, `HIDDEN_LAYER_IDS`, the online-cutoff block, and `maxZoomForSettings` unchanged — the cutoff logic already keys off `manifest.basemap.maxZoom`, so a maxzoom-5 basemap makes online cover zoom > 5 automatically.

In `src/renderer/lib/map/flavors.ts`: delete the `hillshadeColors` function (keep `coresenseLight`, `coresenseDark`, `coresenseFlavor`).

In `src/renderer/lib/map/pmtiles-protocol.ts`:

- Change the loop `for (const source of ['basemap', 'terrain'] as const)` → `for (const source of ['basemap'] as const)`.
- Change `pmtilesUrl(baseUrl: string, source: 'basemap' | 'terrain')` → `pmtilesUrl(baseUrl: string, source: 'basemap')`.

- [ ] **Step 6: Remove terrain from MapCanvas**

In `src/renderer/components/map/MapCanvas.tsx`:

- Change the style-builder import to: `import { buildStyle, maxZoomForSettings } from '../../lib/map/style-builder';` (drop `LAYER_HILLSHADE`, `SOURCE_TERRAIN`).
- Delete the hillshade-visibility effect (the `useEffect` guarded by `if (!map || !manifest.terrain) return;` that toggles `LAYER_HILLSHADE` visibility).
- Delete the 3D `setTerrain` effect (the `useEffect` that calls `map.setTerrain({ source: SOURCE_TERRAIN, … })`) and its leading comment block.
- In the `setStyle` rebuild effect, delete the inner `map.once('style.load', () => { … hillshade/terrain reapply … })` block, leaving just `map.setStyle(buildStyle({ baseUrl: client.baseUrl, manifest, settings, theme }));` inside `apply`.

- [ ] **Step 7: Remove the terrain toggles from ControlsCard**

In `src/renderer/panels/map/ControlsCard.tsx`:

- Delete the `const manifest = useStore((s) => s.mapManifest);` selector (it becomes unused).
- Delete the entire `{manifest.terrain && ( <> <ToggleRow label="Hillshade" … /> <ToggleRow label="3D terrain" … /> </> )}` block, keeping the `Light basemap` `ToggleRow`.

- [ ] **Step 8: Update the store's default manifest**

In `src/renderer/lib/store.ts`, change:

```ts
const DEFAULT_MAP_MANIFEST: TileManifest = { missing: true, basemap: null, terrain: null };
```

to:

```ts
const DEFAULT_MAP_MANIFEST: TileManifest = { missing: true, basemap: null };
```

- [ ] **Step 9: Update the build config + docs**

In `forge.config.ts`, change:

```ts
const TILE_EXTRACTS = ['resources/tiles/basemap.pmtiles', 'resources/tiles/terrain.pmtiles'];
```

to:

```ts
const TILE_EXTRACTS = ['resources/tiles/basemap.pmtiles'];
```

Replace `scripts/build-tiles.md` with a basemap-only, maxzoom-5, world recipe:

````md
# Building the bundled basemap PMTiles for Coresense

The Map panel ships with ONE small bundled PMTiles file in `resources/tiles/`:

- `basemap.pmtiles` — a low-detail **world** Protomaps vector basemap at **maxzoom 5**.

It is tracked in **git-LFS** (a fresh clone needs `git lfs install && git lfs pull`).
It serves only as an offline backdrop: higher-detail tiles (zoom > 5) are
downloaded on demand from the Protomaps hosted API and require an API key. 3D
terrain / hillshade has been removed — there is no bundled terrain extract.

## Prerequisites

- `pmtiles` CLI: https://github.com/protomaps/go-pmtiles/releases (or `brew install pmtiles`)

## Basemap (Protomaps, world @ maxzoom 5)

```sh
pmtiles extract \
  https://build.protomaps.com/YYYYMMDD.pmtiles \
  resources/tiles/basemap.pmtiles \
  --maxzoom=5
```

- Pick a recent dated build from https://maps.protomaps.com/builds (replace `YYYYMMDD`).
- No `--bbox` — a whole-world extract keeps the backdrop global. At maxzoom 5 the
  file is small (~15 MB). Verify with `pmtiles show resources/tiles/basemap.pmtiles`.

## Committing

```sh
git add resources/tiles/basemap.pmtiles
git commit -m "tiles: refresh basemap extract (YYYY-MM-DD)"
```
````

- [ ] **Step 10: Run the style-builder test + typecheck + full suite**

Run: `pnpm vitest run --project unit tests/unit/renderer/lib/map/style-builder.test.ts`
Expected: PASS (3 tests).
Run: `pnpm typecheck`
Expected: no errors. Fix any straggler references the compiler flags (e.g. a test fixture with `terrain:` in a `TileManifest`, or `terrainHillshadeEnabled` in a `MapSettings` literal). Run `grep -rn "terrain" src tests | grep -vi terrainHillshade` if needed to find leftovers; remove terrain-only references.
Run: `pnpm test`
Expected: all pass.

- [ ] **Step 11: Commit the code changes**

```bash
git add src/shared/types.ts src/main/map/tile-paths.ts src/main/api/tiles.ts src/renderer/lib/map/style-builder.ts src/renderer/lib/map/flavors.ts src/renderer/lib/map/pmtiles-protocol.ts src/renderer/components/map/MapCanvas.tsx src/renderer/panels/map/ControlsCard.tsx src/renderer/lib/store.ts forge.config.ts scripts/build-tiles.md tests/unit/renderer/lib/map/style-builder.test.ts
git commit -m "feat(map): remove 3D terrain/hillshade; basemap-only bundling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 12: Commit the shrunk basemap asset + terrain deletion**

The maxzoom-5 `basemap.pmtiles` (14 MB) and the deleted `terrain.pmtiles` are already in the working tree (` M` / ` D`). Stage and commit them via git-LFS:

```bash
git add resources/tiles/basemap.pmtiles resources/tiles/terrain.pmtiles
git status --short resources/tiles   # expect: M basemap.pmtiles, D terrain.pmtiles
git commit -m "tiles: shrink basemap to maxzoom-5 world extract; drop terrain

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(The old 521 MB / 220 MB blobs remain in git-LFS **history**; purging history is an optional follow-up, out of scope.)

---

### Task 6: Persistent API-key banner + MapView backdrop integration

Add a self-gating banner over the map that appears when no key is set or the key is rejected, with a get-a-key link and an Open-settings button; always render the bundled backdrop underneath.

**Files:**
- Create: `src/renderer/components/map/MapApiKeyNotice.tsx`
- Modify: `src/renderer/panels/MapView.tsx`
- Create: `tests/component/map-api-key-notice.test.tsx`
- Create: `tests/component/map-view-gating.test.tsx`

**Interfaces:**
- Consumes: store `mapTileStatus` (Task 2), `setActiveKey`, `requestScrollToSection` (existing); `MapCanvas`, `MapView` props (existing).
- Produces: `MapApiKeyNotice` component.

- [ ] **Step 1: Write the failing banner DOM test**

Create `tests/component/map-api-key-notice.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MapApiKeyNotice } from '../../src/renderer/components/map/MapApiKeyNotice';
import { useStore } from '../../src/renderer/lib/store';

afterEach(() => {
  useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false });
});

describe('MapApiKeyNotice', () => {
  it('renders the no-key prompt with a get-a-key link when no key is configured', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false });
    render(<MapApiKeyNotice />);
    expect(screen.getByText(/API key/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /get a key/i }) as HTMLAnchorElement;
    expect(link.href).toContain('maps.protomaps.com/keys');
  });

  it('renders the rejected prompt when the key is rejected', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: true, keyRejected: true });
    render(<MapApiKeyNotice />);
    expect(screen.getByText(/rejected/i)).toBeTruthy();
  });

  it('renders nothing when a key is configured and accepted', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: true, keyRejected: false });
    const { container } = render(<MapApiKeyNotice />);
    expect(container.firstChild).toBeNull();
  });

  it('navigates to map settings when Open settings is clicked', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false });
    render(<MapApiKeyNotice />);
    fireEvent.click(screen.getByRole('button', { name: /open .*settings/i }));
    expect(useStore.getState().ui.activeKey).toBe('tool:settings:app');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project dom tests/component/map-api-key-notice.test.tsx`
Expected: FAIL — module `MapApiKeyNotice` does not exist.

- [ ] **Step 3: Implement `src/renderer/components/map/MapApiKeyNotice.tsx`**

```tsx
import { KeyRound } from 'lucide-react';
import { useStore } from '../../lib/store';

/**
 * Persistent, self-gating banner overlaid on the map. Renders nothing when a
 * key is configured and accepted; otherwise prompts the user to add or fix
 * their Protomaps API key. The bundled low-detail basemap renders underneath.
 */
export function MapApiKeyNotice() {
  const status = useStore((s) => s.mapTileStatus);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const requestScrollToSection = useStore((s) => s.requestScrollToSection);

  if (status.keyConfigured && !status.keyRejected) return null;
  const rejected = status.keyConfigured && status.keyRejected;

  const openSettings = () => {
    setActiveKey('tool:settings:app');
    requestScrollToSection('app-map');
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
      <div className="pointer-events-auto flex max-w-2xl items-start gap-3 rounded border border-cs-border bg-cs-bg-2/95 px-3 py-2 shadow-lg backdrop-blur">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-cs-accent" aria-hidden />
        <div className="text-[12px] text-cs-text">
          {rejected ? (
            <p>Your Protomaps API key was rejected. Check the key in settings to load detailed map tiles.</p>
          ) : (
            <p>
              Add a Protomaps API key to load detailed map tiles.{' '}
              <a
                href="https://maps.protomaps.com/keys"
                target="_blank"
                rel="noreferrer noopener"
                className="text-cs-accent underline underline-offset-2 hover:opacity-80"
              >
                Get a key
              </a>{' '}
              (free tier available).
            </p>
          )}
          <button
            type="button"
            onClick={openSettings}
            className="mt-1.5 rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-2"
          >
            Open map settings
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the banner test to verify it passes**

Run: `pnpm vitest run --project dom tests/component/map-api-key-notice.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing MapView gating test**

Create `tests/component/map-view-gating.test.tsx` (mocks `MapCanvas` so no WebGL/maplibre is needed):

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/components/map/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}));

import { MapView } from '../../src/renderer/panels/MapView';
import { useStore } from '../../src/renderer/lib/store';
import type { TileManifest } from '../../src/shared/types';

const presentManifest: TileManifest = {
  missing: false,
  basemap: {
    source: 'basemap',
    bytes: 14_000_000,
    minZoom: 0,
    maxZoom: 5,
    bounds: [-180, -85, 180, 85],
    center: { lng: 0, lat: 0, zoom: 2 },
    tileType: 1,
  },
};
const client = { baseUrl: 'http://x', apiKey: 'k' };

beforeEach(() => useStore.getState().applyMapManifest(presentManifest));
afterEach(() => useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false }));

describe('MapView gating', () => {
  it('shows the empty-state when tiles are missing', () => {
    useStore.getState().applyMapManifest({ missing: true, basemap: null });
    render(<MapView client={client} />);
    expect(screen.getByText(/Map tiles not installed/i)).toBeTruthy();
  });

  it('renders the backdrop + banner when no key is set', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false });
    render(<MapView client={client} />);
    expect(screen.getByTestId('map-canvas')).toBeTruthy();
    expect(screen.getByText(/Add a Protomaps API key/i)).toBeTruthy();
  });

  it('renders the map with no banner when the key is accepted', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: true, keyRejected: false });
    render(<MapView client={client} />);
    expect(screen.getByTestId('map-canvas')).toBeTruthy();
    expect(screen.queryByText(/Add a Protomaps API key/i)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run --project dom tests/component/map-view-gating.test.tsx`
Expected: FAIL — MapView doesn't render the banner yet (and may still have the terrain-referencing empty-state copy).

- [ ] **Step 7: Update `src/renderer/panels/MapView.tsx`**

Add the banner import and restructure the success return so the banner overlays the always-mounted backdrop. Also delete the now-impossible `!manifest.basemap` ("only terrain is loaded") branch and refresh the empty-state copy (terrain no longer bundled):

```tsx
import { MapIcon } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { logError, MapErrorFallback } from '../components/errors/ErrorFallback';
import { MapApiKeyNotice } from '../components/map/MapApiKeyNotice';
import { MapCanvas } from '../components/map/MapCanvas';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';

interface MapViewProps {
  client: ApiClient | null;
}

export function MapView({ client }: MapViewProps) {
  const manifest = useStore((s) => s.mapManifest);
  const settings = useStore((s) => s.mapSettings);

  if (manifest.missing || !manifest.basemap) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="max-w-lg space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <MapIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Map tiles not installed</h2>
          <p className="text-sm text-muted-foreground">
            The bundled basemap extract isn't present in this build. Drop{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">basemap.pmtiles</code> into{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">resources/tiles/</code> and relaunch — or run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">git lfs pull</code> if you cloned without LFS.
          </p>
          <p className="text-xs text-muted-foreground">
            See <code className="rounded bg-muted px-1 py-0.5 text-xs">scripts/build-tiles.md</code> for how to generate
            the extract with <code className="rounded bg-muted px-1 py-0.5 text-xs">pmtiles extract</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Waiting for API client…</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <ErrorBoundary FallbackComponent={MapErrorFallback} onError={logError}>
        <MapCanvas client={client} manifest={manifest} settings={settings} />
      </ErrorBoundary>
      <MapApiKeyNotice />
    </div>
  );
}
```

- [ ] **Step 8: Run the gating test to verify it passes**

Run: `pnpm vitest run --project dom tests/component/map-view-gating.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Full suite + typecheck + lint**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm test`
Expected: all pass.
Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/components/map/MapApiKeyNotice.tsx src/renderer/panels/MapView.tsx tests/component/map-api-key-notice.test.tsx tests/component/map-view-gating.test.tsx
git commit -m "feat(map): persistent no-key / rejected-key banner over the backdrop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full gates once more: `pnpm typecheck && pnpm test && pnpm lint`. All green.
- [ ] Manual smoke (optional, via the `run`/`verify` skills): launch the app, open the Map panel with no key → low-detail world backdrop + banner; add a key in Settings → Map Tiles → detail loads and banner disappears; enter a bad key → "rejected" banner; toggle the cache size limit, view the size, clear it, open the folder.

## Spec coverage map

- Remove bundled/large tiles + terrain → Task 5 (types/main/renderer/build/asset).
- Keep small maxzoom-5 world basemap backdrop → Task 5 asset + existing bundled-serving path (unchanged); backdrop always mounts in Task 6.
- Online tiles via Protomaps proxy, key required for detail → existing proxy + Task 3 (cache) + camera cap via `maxZoomForSettings` (Task 5 test asserts z5 without key).
- LRU disk cache, user-configurable cap → Task 1 (module) + Task 3 (wiring + `tileCacheMaxBytes`) + Task 4 (Select).
- Persistent no-key / rejected-key banner with Open-settings + get-a-key link → Task 6; `keyRejected` detection Task 3; `keyConfigured` Task 2.
- Settings cache controls: size, clear, open folder, size cap → Task 4.
- `mapTileStatus` broadcast → Task 2.
