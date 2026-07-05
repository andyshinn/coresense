# Online Map Tiles — Design

- **Date:** 2026-07-04
- **Branch/worktree:** `worktree-feat+online-map-tiles`
- **Status:** Approved shape, pending spec review

## Summary

Today the app bakes two large PMTiles archives into the package at build time
(`resources/tiles/basemap.pmtiles` ≈ 521 MB at maxzoom 14, and
`resources/tiles/terrain.pmtiles` ≈ 220 MB, both git-LFS, shipped outside
`app.asar`). A Protomaps hosted-API key is *optional* and only unlocks a
higher-zoom online fallback.

This change moves to an **online-primary model with a small offline backdrop**:

- **Shrink** the bundled basemap to a tiny **world extract at maxzoom 5**, kept
  as an always-present low-detail backdrop (so the map screen is never blank).
- **Download** all higher-detail basemap tiles (zoom > 5) on demand from the
  Protomaps hosted API, proxied through the main process, and **cache** them on
  disk so they are not re-downloaded.
- Make a **Protomaps API key required** for detail beyond the backdrop. When no
  key is set — or a configured key is rejected by Protomaps — the map screen
  shows a **persistent banner** over the low-detail backdrop, with a button to
  jump straight to settings and (for the no-key case) how to obtain a key.
- **Remove** 3D terrain / hillshade (the `terrain.pmtiles` DEM) entirely — the
  Protomaps hosted API serves only vector basemap tiles and we are not adding a
  second DEM provider.
- Give the cache **user-configurable** size limits and management controls
  (current size, clear, open folder) in settings.

## Goals

- Replace the large bundled basemap with a small **world maxzoom-5** extract; keep
  it as an offline low-detail backdrop. Remove the terrain DEM.
- Fetch all higher-detail (zoom > 5) basemap tiles online from Protomaps,
  proxied through main (so the API key never reaches the renderer).
- Cache downloaded online tiles on disk with a bounded, **user-configurable**
  size-capped LRU so repeat views do not re-download.
- Require an API key for detail beyond the backdrop; show a **persistent** banner
  on the map screen when the key is missing or rejected, with a button to open
  settings.
- Cache controls in settings: current cache size, clear the cache, open the cache
  folder, and choose the cache size cap.

## Non-goals

- Removing the bundled basemap entirely. A small maxzoom-5 world extract stays as
  the offline backdrop.
- Keeping 3D terrain / hillshade, or adding an alternative DEM tile provider.
- Keyless high-detail tiles. Low detail (≤ z5) works offline from the bundle;
  detail beyond that requires a key.
- A configurable tile provider (Protomaps is fixed). Only the cache **size cap**
  is user-configurable.
- Purging the old 521 MB / 220 MB tile blobs from git/LFS **history** (optional
  follow-up; the new smaller extract replaces the working-tree file).

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Bundled tiles | **Keep basemap at maxzoom 5** (small world extract) as an offline backdrop; **remove** the large basemap + terrain |
| Terrain / hillshade / 3D | **Removed entirely** |
| Behavior with no / rejected key | **Low-detail bundled backdrop + persistent banner** (map is never blank; no keyless high-detail) |
| Cache backend | **Main-process proxy + file-per-tile disk cache with in-memory LRU index** (no new dependency); caches **online** tiles only |
| Cache bound | **Size-capped LRU**, **user-configurable** cap (preset select, default 512 MB) |
| Invalid-key UX | **"Key rejected" banner state** (detect Protomaps 401/403) |
| Tile route | **Keep existing** `/api/map/online-tile-proxy/:source/:z/:x/:y` (no rename) |
| Settings cache controls | Show size, **Clear cache**, **Open cache folder**, **choose size cap** |
| Navigate-to-settings | Button in both banner states → `tool:settings:app` (section `app-map`) |

## Current architecture (for reference)

- Build: `forge.config.ts` bundles `resources/tiles/*.pmtiles` as `extraResource`
  (outside asar). `.gitattributes` marks them git-LFS. `scripts/build-tiles.md`
  documents manual generation via `pmtiles extract`.
- Main: a Hono HTTP server on `127.0.0.1` serves tiles.
  `src/main/map/tile-paths.ts` resolves bundled file paths;
  `src/main/api/tiles.ts` provides `FileSource`, `serveRange` (ranged file
  server), `buildTileManifest`, routes `/api/tiles/:source`,
  `/api/tiles/manifest`, and the online fallback proxy
  `/api/map/online-tile-proxy/:source/:z/:x/:y` (fetches
  `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=...`, **uncached**).
- API key: `src/main/map/api-key.ts` stores it OS-encrypted (`safeStorage`); only
  a boolean `hasProtomapsApiKey` is exposed to the renderer. Routes in
  `src/main/api/routes.ts` (`POST/GET/DELETE /api/map/api-key`), which force the
  server-owned `hasProtomapsApiKey` on `MapSettings`.
- Renderer: `src/renderer/lib/map/pmtiles-protocol.ts` registers a `pmtiles://`
  protocol pointing at the local server; `src/renderer/lib/map/style-builder.ts`
  composes the MapLibre style (bundled vector source + terrain raster-dem +
  online fallback above the bundled cutoff + Protomaps-CDN glyphs/sprites);
  `maxZoomForSettings` raises the camera ceiling to 18 when a key is present, else
  caps near the bundled maxzoom. `src/renderer/components/map/MapCanvas.tsx` owns
  the MapLibre instance and `transformRequest` (bearer token on localhost
  requests). `src/renderer/panels/MapView.tsx` gates on a `mapManifest` snapshot
  and shows a "Map tiles not installed" empty-state when tiles are absent.
- UI: shadcn/ui + Radix primitives + Tailwind v4 + lucide-react; toasts via
  `sonner`. No persistent-banner primitive exists (ad-hoc `cs-*`-token styled
  divs). No database dependency exists.

Much of this infrastructure is **reused unchanged** — the bundled basemap still
exists (just smaller), so the `pmtiles://` protocol, `tile-paths.ts`, the local
`serveRange`/manifest serving, and the `pmtiles` dependency all remain.

## Design

### 1. Shrink the bundled basemap; remove terrain (build + repo)

- **Regenerate `resources/tiles/basemap.pmtiles`** as a small **world** extract at
  **maxzoom 5** (whole planet, no bbox, so the backdrop covers the globe;
  estimated tens of MB). This is a manual `pmtiles extract` step — update
  `scripts/build-tiles.md` with the new recipe (world, `--maxzoom=5`) and drop the
  terrain recipe. Committing the new smaller asset replaces the old one (still via
  git-LFS; keep the `.gitattributes` LFS rule).
- **Delete** `resources/tiles/terrain.pmtiles` and all terrain code paths.
- `forge.config.ts`: keep the basemap in `extraResource`; remove the terrain
  entry (and any terrain-only `existsSync` handling).
- `src/main/map/tile-paths.ts`: drop `terrain` from `TILE_SOURCES` (basemap only).
- Keep the `pmtiles` dependency and `src/renderer/lib/map/pmtiles-protocol.ts`
  (the bundled backdrop still uses them).

### 2. Main — online tile proxy (key required) + LRU disk cache

Local bundled-tile serving in `src/main/api/tiles.ts` (`FileSource`, `serveRange`,
`buildTileManifest`, `/api/tiles/:source`, `/api/tiles/manifest`) **stays**, minus
terrain: the manifest describes only the bundled basemap (minzoom 0, maxzoom 5,
world bounds).

**New module `src/main/map/tile-cache.ts`** — pure, unit-testable disk cache for
**online** tiles:

- Cache dir: `join(userDataDir(), 'tile-cache')`. Files laid out by tile pyramid:
  `tile-cache/{z}/{x}/{y}.mvt` (human-inspectable; good for "open folder").
- Store the **raw response bytes** from Protomaps (already gzip-encoded) so we can
  replay them verbatim; record content-type/encoding to serve identical headers.
- In-memory LRU index `Map<key, { size, atime }>` where `key = "z/x/y"`. Built at
  startup by walking the cache dir (summing file sizes; seed `atime` from file
  mtime). Node is single-threaded so index mutations are atomic.
- **User-configurable cap** (see §3/§7): a default of 512 MB, settable via a
  `setMaxBytes(n)` call driven by the persisted setting. When a `put` pushes the
  total over the cap, evict least-recently-used files down to a low-water mark
  (`0.9 * cap`). Lowering the cap in settings triggers an immediate eviction pass.
- API: `get(key) → Buffer | null` (updates atime), `put(key, bytes)`,
  `size() → { bytes, count }`, `clear()`, `dir()`, `setMaxBytes(n)`.
- Nice-to-have (note in plan, implement if cheap): de-dupe concurrent in-flight
  fetches for the same key so a burst doesn't fetch the same tile N times.

**`src/main/api/tiles.ts` — online proxy route** (keep the existing path
`GET /api/map/online-tile-proxy/:source/:z/:x/:y`; only `basemap` is valid now,
terrain 404s). Add caching + status:

  1. `getApiKey()`; if none → `404 { error: 'no_api_key' }`.
  2. Cache hit (`tileCache.get`) → serve bytes with stored headers
     (`Content-Type: application/x-protobuf`, `Content-Encoding: gzip`,
     `Cache-Control` as today). A cache hit does **not** touch `keyRejected` —
     serving cached bytes does not re-validate the key; only a fresh upstream
     `200` clears the rejected status.
  3. Miss → `net.fetch` `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=…`:
     - `200` → `tileCache.put`, serve, set status `ok`.
     - `401`/`403` → set status `key_rejected` (broadcast on change), return
       `401`; do **not** cache.
     - `404`/`204` → `204` (empty tile; stop retrying); do not cache.
     - other/network error → `502`; do not cache.
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
- `hasProtomapsApiKey` on `MapSettings` remains as-is (drives whether the online
  source is added to the style, and the camera zoom ceiling).

### 4. Main — cache management routes

- `GET /api/map/tile-cache` → `{ bytes, count }` from `tileCache.size()`.
- `DELETE /api/map/tile-cache` → `tileCache.clear()`, return `{ bytes: 0, count: 0 }`.
- `POST /api/map/tile-cache/open` → `shell.openPath(tileCache.dir())` (mirrors the
  existing `shell.openPath(folderPath())` pattern in `src/main/index.ts:92`).
- The cache **size cap** is carried on `MapSettings` and applied via
  `tileCache.setMaxBytes` when settings load and on change (see §7); it does not
  need its own route (rides the existing `PUT /api/settings/map`).

### 5. Renderer — style, map canvas, terrain removal

- **`src/renderer/lib/map/style-builder.ts`**: keep the bundled `pmtiles://`
  basemap vector source (now maxzoom 5) and the online vector source above the
  bundled cutoff, gated on `hasProtomapsApiKey`. Because the bundled maxzoom is
  now 5, the existing "cap bundled layers at `manifest.basemap.maxZoom+1`, add
  online source from the cutoff up to `ONLINE_MAX_ZOOM (15)`" logic naturally makes
  online the source for zoom > 5. Keep `maxZoomForSettings` (camera ceiling 18
  with key; near the bundled maxzoom without). **Remove** the `terrain-dem` raster
  source and hillshade layers. Keep the `coresense` flavor, Protomaps-CDN
  glyphs/sprites (keyless), and attribution (drop the Mapterhorn terrain
  attribution).
- **`src/renderer/components/map/MapCanvas.tsx`**: keep `ensurePmtilesProtocol`
  (bundled backdrop) and `transformRequest` (online + bearer). **Remove** the
  hillshade-visibility effect and the 3D `setTerrain` effect. Keep the
  `hasProtomapsApiKey`/theme-driven `setStyle` rebuild (adds/removes the online
  source).
- **`src/renderer/lib/map/flavors.ts`**: remove `hillshadeColors`.
- **Terrain settings**: drop the hillshade + 3D-terrain toggles from
  `ControlsCard.tsx` and the corresponding `MapSettings` fields. Keep the
  light-basemap (theme override) toggle. Old persisted settings carrying the
  removed fields are harmless (ignored).
- **Manifest**: keep `mapManifest` but basemap-only (drop terrain). Consumers that
  referenced terrain zoom/bounds are removed.

### 6. Renderer — persistent banner over the backdrop + MapView

- **New component `src/renderer/components/map/MapApiKeyNotice.tsx`** — a
  persistent, non-dismissible banner styled with `cs-*` tokens + a lucide icon
  (e.g. `KeyRound`), positioned as an overlay at the top of the map area
  (absolute, over the canvas). Two states, driven by `mapTileStatus`:
  - **No key** (`!keyConfigured`): "Add a Protomaps API key to load detailed map
    tiles." Includes an external link to **https://maps.protomaps.com/keys**
    (free tier) via a normal `<a target="_blank">` (routed to `shell.openExternal`
    by the existing window-open handler), and an **"Open map settings"** button.
  - **Key rejected** (`keyConfigured && keyRejected`): "Your Protomaps API key was
    rejected. Check the key in settings." Includes the **"Open map settings"**
    button (and the get-a-key link).
  - The "Open map settings" button calls `setActiveKey('tool:settings:app')` and
    focuses the `app-map` section (existing settings scroll/jump mechanism).
- **`src/renderer/panels/MapView.tsx`**: the map is **never blank** now — the
  bundled backdrop always renders. Behavior:
  - Basemap **missing** (dev without `git lfs pull`) → keep the existing "Map tiles
    not installed" empty-state.
  - Basemap present → **always mount `MapCanvas`** inside the existing
    `ErrorBoundary`. Overlay `<MapApiKeyNotice>` when `!keyConfigured` (no-key
    state) or `keyRejected` (rejected state); no banner when `keyConfigured &&
    !keyRejected`. Without a key the backdrop shows the low-detail world and the
    camera ceiling stays near zoom 5 (from `maxZoomForSettings`), so the banner is
    the prompt to unlock detail.

### 7. Renderer — settings cache controls (size cap, size, clear, open)

- Extend `src/renderer/components/settings/MapKeySection.tsx` (section `app-map`)
  with a cache block:
  - **Cache size cap** — a `Select` of presets (256 MB, 512 MB, 1 GB, 2 GB, 5 GB),
    default 512 MB, persisted on `MapSettings.tileCacheMaxBytes` via the existing
    `PUT /api/settings/map`. On change, main applies `tileCache.setMaxBytes` (and
    evicts if lowered).
  - **Current cache size** — formatted from `GET /api/map/tile-cache`, fetched on
    mount and refreshed after clear / after a cap change.
  - **"Clear tile cache"** button → `DELETE /api/map/tile-cache`, then refresh size
    + `notify.success`.
  - **"Open cache folder"** button → `POST /api/map/tile-cache/open`.
- Renderer API helpers in `src/renderer/lib/api.ts`: `getTileCacheInfo`,
  `clearTileCache`, `openTileCacheFolder`.
- `MapSettings` type gains `tileCacheMaxBytes: number` (default 512 MB); main's
  holder validates/clamps it (min ~64 MB) and calls `setMaxBytes` on load/change.

## Data flow (end to end, after change)

1. Renderer builds the MapLibre style: bundled `pmtiles://` basemap (zoom 0–5) +,
   when `hasProtomapsApiKey`, an online vector source (zoom > 5) pointing at
   `${baseUrl}/api/map/online-tile-proxy/basemap/{z}/{x}/{y}` (localhost).
2. Bundled tiles (≤ z5) load from the local pmtiles file (`serveRange`). MapLibre
   requests online tiles (> z5); `transformRequest` attaches the app bearer token.
3. Main online route: no key → `404 no_api_key`; else check the LRU disk cache.
4. Cache hit → serve bytes. Miss → `net.fetch` Protomaps with the decrypted key,
   `200` → cache + serve (+ status `ok`), `401/403` → status `key_rejected` +
   `401`, `404/204` → `204`, else `502`.
5. `mapTileStatus` changes broadcast over WS → renderer store → banner reflects
   `no key` / `key rejected` / hidden. The backdrop stays visible underneath.
6. Settings shows cache size, can clear the cache, open its folder, and choose the
   size cap (applied to `tileCache.setMaxBytes`).

## Testing strategy (TDD)

- **Unit — `tile-cache.ts`**: put/get round-trip; LRU eviction order; cap
  enforcement (put over cap evicts to low-water); `setMaxBytes` lowering triggers
  eviction; `clear()` empties; `size()` accounting; index rebuild from an existing
  dir. Pure fs in a temp dir, no Electron.
- **Unit — online proxy route**: no-key → 404; cache hit serves without fetch;
  miss fetches + caches (mocked `net.fetch`); 401/403 → 401 + status transition;
  404/204 → 204; 502 on error; status broadcasts only on change.
- **DOM — banner + MapView**: basemap present + `!keyConfigured` renders the
  backdrop map with the no-key banner; `keyRejected` renders the rejected banner;
  both "Open map settings" buttons call `setActiveKey('tool:settings:app')`;
  keyed + ok renders the map with no banner; basemap missing renders the
  "not installed" state.
- **DOM — settings**: cache size renders; changing the cap persists via
  `PUT /api/settings/map`; clear calls the API and refreshes; open-folder calls
  the API.
- Full baseline before/after: `pnpm typecheck` + `pnpm test` (currently green:
  282 tests / 79 files).

## Accepted tradeoffs

- **Reduced offline detail.** The app previously rendered high-detail maps offline
  from the bundle. Now offline shows only the low-detail (≤ z5) backdrop; detail
  needs a key + internet, and an area works offline at detail only after being
  viewed (cached). Accepted; the small backdrop + LRU cache are the mitigations.
- **Single provider dependency.** All detail tiles depend on Protomaps hosted-API
  availability and the user's key/quota.

## Migration & cleanup

- The old 521 MB / 220 MB blobs remain in git/LFS **history** after replacing the
  basemap and deleting terrain. A full purge (`git filter-repo` / BFG +
  force-push + LFS prune) is an **optional follow-up**, out of scope here.
- In-scope cleanups: remove terrain assets/code and the terrain `MapSettings`
  fields; shrink the bundled basemap.

## Open items to confirm during planning

- Exact settings jump: confirm the `activeSectionId` mechanism to focus `app-map`
  after `setActiveKey('tool:settings:app')`.
- Confirm Protomaps hosted basemap max native zoom (assumed 15; camera overzoom to
  18 — matches current `ONLINE_MAX_ZOOM` / `ONLINE_CAMERA_MAX_ZOOM`).
- Confirm the bundled world maxzoom-5 extract size once regenerated (sanity-check
  it is small, ~tens of MB).
- Confirm the exact upstream error semantics for an invalid key (401 vs 403) to
  map to `key_rejected`.

## File-by-file change list

**Remove**
- `resources/tiles/terrain.pmtiles`
- terrain code paths / `hillshadeColors` in `src/renderer/lib/map/flavors.ts`

**Replace (regenerate asset)**
- `resources/tiles/basemap.pmtiles` → small world extract at maxzoom 5 (git-LFS)

**Add**
- `src/main/map/tile-cache.ts` (+ unit test)
- `src/renderer/components/map/MapApiKeyNotice.tsx` (+ DOM test)

**Modify**
- `scripts/build-tiles.md` (world maxzoom-5 basemap recipe; drop terrain)
- `forge.config.ts` (drop terrain `extraResource`; keep basemap)
- `src/main/map/tile-paths.ts` (drop terrain source)
- `src/main/api/tiles.ts` (cache + status on the online proxy; basemap-only
  manifest; keep local file serving)
- `src/main/api/routes.ts` (cache routes; wire status; apply cap on settings)
- `src/main/state/holder.ts` (+ `mapTileStatus`, `tileCacheMaxBytes` handling),
  snapshot/emit plumbing
- `src/renderer/lib/map/style-builder.ts` (drop terrain; online required for
  detail via the existing cutoff logic)
- `src/renderer/components/map/MapCanvas.tsx` (drop terrain/hillshade effects)
- `src/renderer/panels/MapView.tsx` (backdrop always renders; banner overlay by
  status; keep "not installed" for a missing bundle)
- `src/renderer/panels/map/ControlsCard.tsx` (drop hillshade/3D toggles)
- `src/renderer/components/settings/MapKeySection.tsx` (cache size cap + size +
  clear + open folder)
- `src/renderer/lib/api.ts` (tile-cache helpers)
- renderer store slice(s): keep `mapManifest` (basemap-only), add `mapTileStatus`
- `MapSettings` type: drop hillshade/terrain3d fields; add `tileCacheMaxBytes`
