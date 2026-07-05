# Online Map Tiles — Design

- **Date:** 2026-07-04
- **Branch/worktree:** `worktree-feat+online-map-tiles`
- **Status:** Approved shape, pending spec review

## Summary

Today the app bakes two large PMTiles archives into the package at build time
(`resources/tiles/basemap.pmtiles` ≈ 521 MB, `resources/tiles/terrain.pmtiles`
≈ 220 MB, tracked via git-LFS and shipped outside `app.asar`). A Protomaps
hosted-API key is *optional* and only unlocks a higher-zoom online fallback.

This change **inverts the model**: no tiles are bundled; all basemap tiles are
downloaded on demand from the Protomaps hosted API and cached on disk so they
are not re-downloaded. A Protomaps API key becomes **required** to render any
map. When no key is set — or a configured key is rejected by Protomaps — the map
screen shows a **persistent banner** explaining the situation with a button to
jump straight to settings, and (for the no-key case) how to obtain a key.

The 3D terrain / hillshade feature (the `terrain.pmtiles` DEM) is **removed**
entirely, because the Protomaps hosted API serves only vector basemap tiles and
we are not adding a second DEM provider.

## Goals

- Remove build-time / bundled map tiles and the git-LFS tile assets from the tree.
- Fetch all basemap tiles online from Protomaps, proxied through the main process
  (so the API key never reaches the renderer).
- Cache downloaded tiles on disk with a bounded, size-capped LRU so repeat views
  do not re-download.
- Require an API key to load tiles; show a **persistent** banner on the map screen
  when the key is missing or rejected, with a button to open settings.
- Provide cache controls in settings: show current cache size, clear the cache,
  and open the cache folder in the OS file manager.

## Non-goals

- Offline-first operation. After this change an area is only usable offline once
  it has been viewed and cached, and the map requires a key at all. This is an
  accepted, intended tradeoff (see "Accepted tradeoffs"). The LRU cache is the
  mitigation.
- Keeping 3D terrain / hillshade, or adding an alternative DEM tile provider.
- A configurable cache-size limit or configurable tile provider (fixed constants
  for now; can be lifted to settings later — YAGNI).
- Purging the 741 MB of tile blobs from git/LFS *history* (optional follow-up,
  see "Migration & cleanup").

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Terrain / hillshade / 3D | **Removed entirely** |
| Behavior with no key | **Blank map + persistent banner** (no keyless fallback source) |
| Cache backend | **Main-process proxy + file-per-tile disk cache with in-memory LRU index** (no new dependency) |
| Cache bound | **Size-capped LRU**, default ~500 MB |
| Invalid-key UX | **"Key rejected" banner state** (detect Protomaps 401/403) |
| Settings cache controls | Show size, **Clear cache**, **Open cache folder** |
| Navigate-to-settings | Button in both banner states → `tool:settings:app` (section `app-map`) |

## Current architecture (for reference)

- Build: `forge.config.ts` bundles `resources/tiles/*.pmtiles` as `extraResource`
  (outside asar). `.gitattributes` marks them git-LFS. `scripts/build-tiles.md`
  documents manual generation.
- Main: a Hono HTTP server on `127.0.0.1` serves tiles.
  `src/main/map/tile-paths.ts` resolves bundled file paths;
  `src/main/api/tiles.ts` provides `FileSource`, `serveRange` (ranged file
  server), `buildTileManifest`, routes `/api/tiles/:source`,
  `/api/tiles/manifest`, and the online fallback proxy
  `/api/map/online-tile-proxy/:source/:z/:x/:y` (fetches
  `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=...`).
- API key: `src/main/map/api-key.ts` stores it OS-encrypted (`safeStorage`); only
  a boolean `hasProtomapsApiKey` is exposed to the renderer. Routes in
  `src/main/api/routes.ts` (`POST/GET/DELETE /api/map/api-key`).
- Renderer: `src/renderer/lib/map/pmtiles-protocol.ts` registers a `pmtiles://`
  protocol pointing at the local server; `src/renderer/lib/map/style-builder.ts`
  composes the MapLibre style (bundled vector source + terrain raster-dem +
  online fallback + Protomaps-CDN glyphs/sprites);
  `src/renderer/components/map/MapCanvas.tsx` owns the MapLibre instance;
  `src/renderer/panels/MapView.tsx` gates on a `mapManifest` snapshot and shows a
  "Map tiles not installed" empty-state.
- UI: shadcn/ui + Radix primitives + Tailwind v4 + lucide-react; toasts via
  `sonner` (`src/renderer/lib/notify.ts`). No persistent-banner primitive exists
  (ad-hoc `cs-*`-token styled divs). No database dependency exists.

## Design

### 1. Remove baked-in tiles (build + repo)

- Delete `resources/tiles/basemap.pmtiles`, `resources/tiles/terrain.pmtiles`,
  and `scripts/build-tiles.md`.
- Remove the git-LFS rule from `.gitattributes` (delete the file if that is its
  only line).
- `forge.config.ts`: remove `TILE_EXTRACTS`, `bundledTiles`, and the tile entries
  from `extraResource` (keep the mac icon catalog). Remove any now-dead
  `existsSync` tile checks.
- Delete `src/main/map/tile-paths.ts`.
- Remove the now-unused `pmtiles` npm dependency (no longer used in main or
  renderer). Keep `@protomaps/basemaps` (used for `layers()` + flavor).

### 2. Main — online tile proxy (key required) + LRU disk cache

**New module `src/main/map/tile-cache.ts`** — pure, unit-testable disk cache:

- Cache dir: `join(userDataDir(), 'tile-cache')`. Files laid out by tile pyramid:
  `tile-cache/{z}/{x}/{y}.mvt` (human-inspectable; good for "open folder").
- Store the **raw response bytes** from Protomaps (already gzip-encoded) so we can
  replay them verbatim; record content-type/encoding to serve identical headers.
- In-memory LRU index `Map<key, { size, atime }>` where `key = "z/x/y"`. Built at
  startup by walking the cache dir (summing file sizes; seed `atime` from file
  mtime). Node is single-threaded so index mutations are atomic.
- Constants: `TILE_CACHE_MAX_BYTES = 500 * 1024 * 1024`; evict down to a
  low-water mark (`0.9 * max`) when a `put` pushes total over the cap. Eviction
  deletes least-recently-used files and their index entries.
- API: `get(key) → Buffer | null` (updates atime), `put(key, bytes)`,
  `size() → { bytes, count }`, `clear()`, `dir()`.
- Nice-to-have (note in plan, implement if cheap): de-dupe concurrent in-flight
  fetches for the same key so a burst doesn't fetch the same tile N times.

**`src/main/api/tiles.ts`** — strip the bundled-file machinery (`FileSource`,
`serveRange`, `readManifestEntry`, `buildTileManifest`, routes `/api/tiles/:source`
and `/api/tiles/manifest`). Replace the fallback proxy with the **primary** tile
route (basemap only):

- Route `GET /api/map/tiles/:z/:x/:y` (renamed from `online-tile-proxy`; single
  basemap source, so `:source` is dropped):
  1. `getApiKey()`; if none → `404 { error: 'no_api_key' }`.
  2. Cache hit (`tileCache.get`) → serve bytes with stored headers
     (`Content-Type: application/x-protobuf`, `Content-Encoding: gzip`,
     `Cache-Control` as today). A cache hit does **not** touch `keyRejected` —
     serving cached bytes does not re-validate the key; only a fresh upstream
     `200` clears the rejected status.
  3. Miss → `net.fetch` `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=…`:
     - `200` → `tileCache.put`, serve, set status `ok`.
     - `401`/`403` → set status `key_rejected` (broadcast on change), return
       `401` so the renderer can react; do **not** cache.
     - `404`/`204` → `204` (empty tile; stop retrying), do not cache.
     - other/network error → `502`, do not cache.
- The Protomaps key is only ever appended to the upstream URL inside main; the
  renderer only sees the local route (authenticated with the app's own bearer
  token via `transformRequest`, unchanged).

### 3. Main — tile status broadcast (no_key / ok / key_rejected)

- Add a runtime status object `mapTileStatus: { keyConfigured: boolean;
  keyRejected: boolean }` to the state snapshot broadcast to the renderer (same
  mechanism as `mapSettings` / the existing snapshot in `state/holder.ts` +
  `emit`). This is **runtime status**, kept separate from persisted `MapSettings`.
  - `keyConfigured` mirrors `hasApiKey()`.
  - `keyRejected` starts `false`; set `true` on a Protomaps `401/403`; set `false`
    on any subsequent `200`, and reset on `setApiKey`/`clearApiKey`.
  - Only broadcast when the value **changes** (avoid per-tile spam).
- `hasProtomapsApiKey` on `MapSettings` remains as-is (drives whether the map
  attempts to load at all).

### 4. Main — cache management routes

- `GET /api/map/tile-cache` → `{ bytes, count }` from `tileCache.size()`.
- `DELETE /api/map/tile-cache` → `tileCache.clear()`, return `{ bytes: 0, count: 0 }`.
- `POST /api/map/tile-cache/open` → `shell.openPath(tileCache.dir())` (mirrors the
  existing `shell.openPath(folderPath())` pattern in `src/main/index.ts:92`).

### 5. Renderer — style, map canvas, protocol, terrain removal

- **`src/renderer/lib/map/style-builder.ts`**: replace the bundled `pmtiles://`
  vector source and the `terrain-dem` raster-dem source with a single online
  vector source:
  `tiles: ['${baseUrl}/api/map/tiles/{z}/{x}/{y}']`, `minzoom 0`, `maxzoom 15`,
  camera max zoom 18 (overzoom). Remove hillshade layers and the terrain source.
  Keep the `coresense` flavor, Protomaps-CDN glyphs/sprites (keyless), and
  attribution. Replace `mapManifest`-derived zoom values with constants
  (`BASEMAP_MINZOOM=0`, `BASEMAP_MAXZOOM=15`, `CAMERA_MAXZOOM=18`).
- **`src/renderer/components/map/MapCanvas.tsx`**: remove `ensurePmtilesProtocol`
  usage, the hillshade-visibility effect, and the 3D `setTerrain` effect. Keep
  `transformRequest` (still injects the app bearer token on same-origin/localhost
  tile + resource requests). Rebuild style on `hasProtomapsApiKey`/theme change as
  today (minus terrain/manifest inputs).
- **Delete** `src/renderer/lib/map/pmtiles-protocol.ts`. Remove
  `hillshadeColors` from `flavors.ts`.
- **Store/snapshot**: remove the `mapManifest` field (derived from reading local
  pmtiles); consumers switch to the constants above and to `mapTileStatus` /
  `hasProtomapsApiKey`.
- **Terrain settings**: drop the hillshade + 3D-terrain toggles from
  `ControlsCard.tsx` and the corresponding `MapSettings` fields. Keep the
  light-basemap (theme override) toggle. Old persisted settings carrying the
  removed fields are harmless (ignored).

### 6. Renderer — persistent banner + MapView gating

- **New component `src/renderer/components/map/MapApiKeyNotice.tsx`** — a
  persistent, non-dismissible banner styled with `cs-*` tokens + a lucide icon
  (e.g. `KeyRound`). Two states, driven by `mapTileStatus` / `hasProtomapsApiKey`:
  - **No key** (`!keyConfigured`): "A Protomaps API key is required to load map
    tiles." Includes an external link to **https://maps.protomaps.com/keys**
    (free tier) via a normal `<a target="_blank">` (routed to `shell.openExternal`
    by the existing window-open handler), and an **"Open map settings"** button.
  - **Key rejected** (`keyConfigured && keyRejected`): "Your Protomaps API key was
    rejected. Check the key in settings." Includes the **"Open map settings"**
    button (and the get-a-key link).
  - The "Open map settings" button calls `setActiveKey('tool:settings:app')` and
    focuses the `app-map` section (existing settings scroll/jump mechanism).
- **`src/renderer/panels/MapView.tsx`**: replace the `manifest.missing`
  empty-state with three explicit cases driven by tile status:
  - **No key** (`!keyConfigured`): render a blank map placeholder with
    `<MapApiKeyNotice>` in the no-key state; **do not mount** `MapCanvas` (there is
    nothing it can load).
  - **Key rejected** (`keyConfigured && keyRejected`): **mount** `MapCanvas` (so
    already-cached tiles still render) with `<MapApiKeyNotice>` in the rejected
    state overlaid at the top of the map area.
  - **OK** (`keyConfigured && !keyRejected`): mount `MapCanvas` inside the existing
    `ErrorBoundary` as today (minus terrain), no banner.

### 7. Renderer — settings cache controls

- Extend `src/renderer/components/settings/MapKeySection.tsx` (section `app-map`)
  with a cache block:
  - Current cache size (formatted from `GET /api/map/tile-cache`), fetched when
    the section mounts and refreshed after a clear.
  - **"Clear tile cache"** button → `DELETE /api/map/tile-cache`, then refresh
    size + `notify.success`.
  - **"Open cache folder"** button → `POST /api/map/tile-cache/open`.
- Renderer API helpers in `src/renderer/lib/api.ts`: `getTileCacheInfo`,
  `clearTileCache`, `openTileCacheFolder`.

## Data flow (end to end, after change)

1. Renderer builds the MapLibre style with a single online vector source pointing
   at `${baseUrl}/api/map/tiles/{z}/{x}/{y}` (localhost).
2. MapLibre requests a tile; `transformRequest` attaches the app bearer token.
3. Main tile route: no key → `404 no_api_key` (banner shows "no key"); else check
   the LRU disk cache.
4. Cache hit → serve bytes. Miss → `net.fetch` Protomaps with the decrypted key,
   `200` → cache + serve (+ status `ok`), `401/403` → status `key_rejected` +
   `401`, `404/204` → `204`, else `502`.
5. `mapTileStatus` changes broadcast over WS → renderer store → banner reflects
   `no key` / `key rejected` / hidden.
6. Settings shows cache size and can clear the cache or open its folder.

## Testing strategy (TDD)

- **Unit — `tile-cache.ts`**: put/get round-trip; LRU eviction order; cap
  enforcement (put over cap evicts to low-water); `clear()` empties; `size()`
  accounting; index rebuild from an existing dir. Pure fs in a temp dir, no
  Electron.
- **Unit — tile route**: no-key → 404; cache hit serves without fetch; miss
  fetches + caches (mocked `net.fetch`); 401/403 → 401 + status transition;
  404/204 → 204; 502 on error; status broadcasts only on change.
- **DOM — banner + MapView gating**: `!keyConfigured` renders the no-key banner
  and not `MapCanvas`; `keyRejected` renders the rejected banner; both "Open map
  settings" buttons call `setActiveKey('tool:settings:app')`; keyed+ok renders the
  map, no banner.
- **DOM — settings**: cache size renders; clear calls the API and refreshes;
  open-folder calls the API.
- Full baseline before/after: `pnpm typecheck` + `pnpm test` (currently green:
  282 tests / 79 files).

## Accepted tradeoffs

- **Offline regression.** The app previously rendered maps fully offline with no
  key. Now the map needs a key and internet; areas work offline only after being
  viewed (cached). Called out and accepted; LRU cache mitigates repeat use.
- **Single provider dependency.** All tiles now depend on Protomaps hosted-API
  availability and the user's key/quota.

## Migration & cleanup

- The 741 MB of tile blobs remain in git/LFS **history** after deleting the
  working-tree files. A full purge (`git filter-repo` / BFG + force-push + LFS
  prune) is an **optional follow-up**, out of scope here.
- Removing the `pmtiles` dependency and the terrain `MapSettings` fields are
  in-scope cleanups.

## Open items to confirm during planning

- Exact settings jump: confirm the `activeSectionId` mechanism to focus `app-map`
  after `setActiveKey('tool:settings:app')`.
- Confirm Protomaps hosted basemap max native zoom (assumed 15, overzoom to 18 —
  matches current `ONLINE_MAX_ZOOM`/`ONLINE_CAMERA_MAX_ZOOM`).
- Confirm the exact upstream error semantics for an invalid key (401 vs 403) to
  map to `key_rejected`.

## File-by-file change list

**Remove**
- `resources/tiles/basemap.pmtiles`, `resources/tiles/terrain.pmtiles`
- `scripts/build-tiles.md`
- `src/main/map/tile-paths.ts`
- `src/renderer/lib/map/pmtiles-protocol.ts`
- `.gitattributes` LFS rule; `pmtiles` dep in `package.json`

**Add**
- `src/main/map/tile-cache.ts` (+ unit test)
- `src/renderer/components/map/MapApiKeyNotice.tsx` (+ DOM test)

**Modify**
- `forge.config.ts` (drop tile `extraResource`)
- `src/main/api/tiles.ts` (online-only + cached primary route; drop file serving)
- `src/main/api/routes.ts` (cache routes; wire status)
- `src/main/state/holder.ts` (+ `mapTileStatus`), snapshot/emit plumbing
- `src/renderer/lib/map/style-builder.ts` (online source; drop terrain/manifest)
- `src/renderer/lib/map/flavors.ts` (drop `hillshadeColors`)
- `src/renderer/components/map/MapCanvas.tsx` (drop protocol/terrain/hillshade)
- `src/renderer/panels/MapView.tsx` (status-based gating + banner)
- `src/renderer/panels/map/ControlsCard.tsx` (drop hillshade/3D toggles)
- `src/renderer/components/settings/MapKeySection.tsx` (cache controls)
- `src/renderer/lib/api.ts` (tile-cache helpers)
- renderer store slice(s): drop `mapManifest`, add `mapTileStatus`
- `MapSettings` type: drop hillshade/terrain3d fields
