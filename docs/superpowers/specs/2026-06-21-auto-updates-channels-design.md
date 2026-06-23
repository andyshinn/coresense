# Auto-Updates with Stable / Development Channels — Design

- **Date:** 2026-06-21
- **Status:** Approved (pending spec review)
- **Author:** Andy Shinn (with Claude)
- **Topic:** In-app auto-update across two channels (Stable, Development), with
  settings controls, manual-check surfaces, and a persistent "update pending"
  indicator.

## 1. Goal

Let CoreSense keep itself up to date from its GitHub Releases, with:

- Two **update channels**: **Stable** and **Development**.
- An **Application Settings** section to pick the channel, toggle automatic
  checking, and check on demand.
- Manual "Check for Updates" from a **menu item**, a **command-palette action**,
  and the **About dialog**.
- A persistent **"update pending" indicator** in the main UI
  (`ConnectionFooter`) that opens a **Popover** with details and a **Restart**
  action.
- On the silent path: close the app, install, and **restart automatically**.

## 2. What already exists (verified)

A working slice is already in place — do **not** rebuild it:

- [`src/main/updater.ts`](../../../src/main/updater.ts) calls
  `updateElectronApp({ updateInterval: '1 hour', logger })`, wired once at
  [`src/main/index.ts:148`](../../../src/main/index.ts) via `startUpdater()`.
- It does **not** pass `notifyUser`, which defaults to `true`. That is why
  publishing `v0.0.10` produced the native *"A new version has been downloaded —
  Restart now?"* prompt.
- **Therefore the Stable / macOS+Windows silent path already works**:
  background 1h poll → download → native restart prompt → install on restart,
  served by the free `update.electronjs.org` service against the
  `andyshinn/coresense` releases configured in `forge.config.ts`
  (`PublisherGithub`).

A full grep confirms **nothing else** related to updates exists: no channel
setting, no `autoCheck` toggle, no Settings/menu/palette/About surface, no
dev/Linux notify path, no `autoUpdater` status listeners, no update IPC/WS, no
renderer indicator. **All work in this design is additive around the working
core.**

## 3. Constraints that shaped the design

- Electron's native `autoUpdater` works on **macOS + Windows only** — there is
  no Linux support.
- `update.electronjs.org` serves **only the single latest stable release** — no
  prereleases and no channels.
- `update-electron-app` (kept, per decision below) wraps the native
  `autoUpdater` + `update.electronjs.org`. Once `updateElectronApp()` is called
  it **cannot be stopped or reconfigured** (it owns an internal interval and
  listeners with no teardown API), and it should be called **once**.
- The repository is **public**, so the unauthenticated GitHub REST API
  (60 req/hr/IP) is sufficient for the notify path. Unauthenticated API returns
  **published** releases (including prereleases) but **not drafts**.
- macOS and Windows builds are **already code-signed** in CI (required for
  `autoUpdater`). Unchanged by this work.

## 4. Decisions (resolved during brainstorming)

1. **Approach: "Hybrid notify."** Keep the proven silent path for Stable on
   mac/win; add a single **notify** path (our own code) reused for the
   Development channel everywhere and for all Linux updates. No new
   infrastructure (no GitHub Pages, no `electron-updater`, no server).
2. **Keep `update-electron-app`.** Build features *around* it for now; a future
   feature may replace it with a hand-rolled `autoUpdater` wrapper if richer
   runtime control is wanted.
3. **Platform scope.** mac/win = full silent auto-update; Linux = notify-only
   (Electron cannot self-update Linux packages).
4. **Development source = GitHub *prereleases*.** Tag a prerelease (e.g.
   `v0.1.0-beta.1`) → existing CI builds/signs it → publish as a GitHub
   *prerelease*. (Not "nightly from main.")
5. **Indicator UX.** A `ConnectionFooter` icon that appears only when an update
   is pending; clicking it opens a shadcn **Popover** with details and a
   **Restart** (silent) / **Download / Release notes** (notify) action. The
   Restart action is the one small addition on top of `update-electron-app`:
   our code calls `autoUpdater.quitAndInstall()`.

## 5. Behavior matrix

| | **Stable channel** | **Development channel** |
|---|---|---|
| **macOS / Windows** | **Silent** — `update-electron-app` background download → install on restart | **Notify** — GitHub API finds newest *prerelease* → indicator/toast → open release |
| **Linux** | **Notify** — GitHub API finds newest *stable* release → open release | **Notify** — GitHub API finds newest *prerelease* → open release |

`UpdateState.mode` (`'silent' | 'notify'`) is computed from `(platform,
channel)` and tells every surface which behavior applies right now.

## 6. Data model

Added to `AppSettings` in [`src/shared/types.ts`](../../../src/shared/types.ts),
persisted through the existing `app-settings.json` flow (atomic write +
recursive-merge defaults, so older files gain the field on read):

```ts
export type UpdateChannel = 'stable' | 'development';

// inside AppSettings:
updates: {
  channel: UpdateChannel;   // default 'stable'
  autoCheck: boolean;       // default true — gates the on-launch check + the silent updater
};
```

`DEFAULT_APP_SETTINGS.updates = { channel: 'stable', autoCheck: true }`.

Broadcast state that drives every update surface:

```ts
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'     // notify path: a newer release exists
  | 'downloading'   // silent path: autoUpdater downloading
  | 'downloaded'    // silent path: ready, pending restart
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  mode: 'silent' | 'notify';
  channel: UpdateChannel;
  currentVersion: string;          // app.getVersion()
  latestVersion?: string;          // when known
  releaseUrl?: string;             // notify path → shell.openExternal
  lastCheckedAt?: number;          // epoch ms
  error?: string;
}
```

> Direct per-asset download URLs are intentionally **out of scope for v1**: the
> notify path opens the **release page** so the user picks the correct asset
> (especially Linux `.deb` vs `.rpm`). Per-asset/distro detection is a future
> enhancement.

## 7. Main-process architecture

New module `src/main/updates/` (replacing the single-purpose `updater.ts`):

- **`controller.ts`** — single source of truth. Reads `AppSettings.updates`,
  computes `mode` from `(platform, channel)`, holds the current `UpdateState`,
  emits it on every transition, exposes `check()`, `installAndRestart()`, and
  `getState()`. Subscribes to the `appSettings` bus event so channel/`autoCheck`
  changes are observed.
- **`silent.ts`** (Stable + mac/win) — thin layer over `update-electron-app`:
  - Calls `updateElectronApp({ updateInterval: '1 hour', notifyUser: true,
    logger })` **once**, lazily: at startup if `autoCheck` is true, otherwise on
    the first manual check. Guarded by a once-flag.
  - Attaches **read-only** listeners to the `autoUpdater` singleton
    (`checking-for-update`, `update-available`, `update-not-available`,
    `update-downloaded`, `error`) to mirror status into `UpdateState`.
  - `check()` → `autoUpdater.checkForUpdates()` (after ensuring init).
  - `installAndRestart()` → `autoUpdater.quitAndInstall()` (Popover "Restart").
  - Keeps the existing guards: no-op when `!app.isPackaged` or `process.mas`.
- **`notify.ts`** (Development everywhere + Linux) — our own checker, fully
  controllable:
  - `GET https://api.github.com/repos/andyshinn/coresense/releases` (or
    `/releases/latest` for stable-on-Linux), filtered by channel
    (prerelease vs not).
  - Compare newest tag (stripped of leading `v`) against `app.getVersion()`
    using `semver` (prerelease-aware).
  - On a newer version → set `status: 'available'` with `latestVersion` and
    `releaseUrl`. `installAndRestart()` in notify mode → `shell.openExternal`
    of the release.
  - **No background polling.** The notify path checks only **once on launch**
    (when `autoCheck` is on) and **on demand** (manual "Check for Updates").
    This is deliberate: the GitHub Releases API is unauthenticated
    (60 req/hr/IP), so we avoid a recurring timer — and we also do **not**
    re-check on settings changes — to keep API usage minimal and rate-limit-safe.

### `autoCheck` + manual-check semantics

- `autoCheck` gates the **on-launch** check (both paths) and whether the silent
  path's `update-electron-app` (which has its own internal hourly poll) starts.
  The notify path has no timer of its own.
- **Manual "Check for Updates" always works.** Notify mode runs our checker;
  silent mode ensures `update-electron-app` is initialized then calls
  `checkForUpdates()`.
- **Known limitation (documented in-UI):** because `update-electron-app` cannot
  be stopped/reconfigured once started, turning `autoCheck` **off**, or
  switching **away from** Stable, after the silent path has initialized does not
  stop its interval **until next launch**. The notify path has no such
  limitation. The Settings UI shows a subtle "Restart to apply" hint when a
  change affects the already-running silent path. (Removing this limitation is
  the natural future "bolt-on" that replaces `update-electron-app`.)

## 8. Transport (matches existing conventions)

- **main → renderer (WebSocket broadcast):**
  - Add `emit.updateState(state)` to
    [`src/main/events/bus.ts`](../../../src/main/events/bus.ts) plus its
    `BusEvents` entry.
  - Add an `onUpdateState` subscriber in
    [`src/main/server.ts`](../../../src/main/server.ts) that `broadcast()`s
    `{ type: 'updateState', payload: UpdateState }`.
  - Add `{ type: 'updateState'; payload: UpdateState }` to the `WsMessage` union
    in [`src/shared/types.ts`](../../../src/shared/types.ts).
  - Send a snapshot to each new WS client on connect (mirroring how
    `transportState`/`bridgeStatus` seed on connection).
  - Handle the message in
    [`src/renderer/app/wsHandlers.ts`](../../../src/renderer/app/wsHandlers.ts)
    and store it (the renderer `useStore`).
- **renderer → main (Hono `/api/*`, API-key authed):**
  - `POST /api/updates/check` → `controller.check()`.
  - `POST /api/updates/install` → `controller.installAndRestart()`.
  - **Channel + `autoCheck` reuse the existing app-settings save route** — no
    new endpoints; the controller reacts via the `appSettings` bus event.
  - Add typed client helpers in [`src/renderer/lib/api.ts`](../../../src/renderer/lib/api.ts).

## 9. UI surfaces

- **Settings → new "Updates" section** in the app-settings panel
  ([`src/renderer/panels/settings/app/`](../../../src/renderer/panels/settings/app/)),
  alongside Notifications/Toasts:
  - Channel radio/select (Stable / Development).
  - "Automatically check for updates" switch (`autoCheck`).
  - Current version + last-checked + status line.
  - **Check for Updates** button whose label tracks `UpdateState`
    (Check → Checking… → Up to date / Update available / Restart to install).
  - "Restart to apply" hint when a change affects the running silent path.
- **`ConnectionFooter` indicator + Popover**
  ([`src/renderer/shell/leftnav/ConnectionFooter.tsx`](../../../src/renderer/shell/leftnav/ConnectionFooter.tsx)):
  - A lucide icon (e.g. `ArrowUpCircle`) rendered **only** when
    `status === 'available'` or `status === 'downloaded'`; accent/online color;
    works in both expanded and collapsed (icon-only) sidebar modes.
  - Click → shadcn **Popover** ([`components/ui/popover.tsx`](../../../src/renderer/components/ui/popover.tsx), already present)
    with: current → new version, channel, status, and an action:
    - silent / `downloaded` → **Restart now** (`POST /api/updates/install`).
    - notify / `available` → **Download** / **Release notes**
      (opens `releaseUrl`).
  - Reads the same `UpdateState` from the store; no extra wiring beyond the WS
    broadcast.
- **Menu** ([`src/main/menu.ts`](../../../src/main/menu.ts)): add **Check for
  Updates…** to the Help menu (and the macOS app menu). Because the menu runs in
  main and the controller is main-side, the click handler calls
  `controller.check()` **directly** — no `MenuAction` round-trip through the
  renderer. The controller's `UpdateState` broadcast keeps every surface
  (including the Settings button and the indicator) in sync.
- **Command palette**: add a "Check for Updates" action in
  [`src/renderer/features/command-palette/items/actions.ts`](../../../src/renderer/features/command-palette/items/actions.ts);
  the action (renderer-side) calls `POST /api/updates/check`.
- **About dialog** ([`src/main/about.ts`](../../../src/main/about.ts)): add a
  **Check for Updates** button to the native dialog `buttons` and call
  `controller.check()` directly on that response (main-side, like the menu).
- **Notify toast**: when `status` becomes `available` in notify mode, surface a
  toast via the existing [`notify`](../../../src/renderer/lib/notify.ts) (sonner)
  helper — "Update available: vX.Y.Z" → opens the release. Respects the existing
  toast enable/duration settings.

## 10. CI / release pipeline

[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) already builds
and signs all three platforms on `v*.*.*` tags and creates a **draft** GitHub
release. Changes:

- Prerelease tags (e.g. `v0.1.0-beta.1`) already match the `v*.*.*` trigger.
  The release job must publish them as a GitHub **prerelease**
  (`prerelease: true`, e.g. auto-detected from a `-` in the tag).
- **Critical:** prereleases must be **published** (not left as a draft) —
  the unauthenticated GitHub API the notify path uses does not return drafts.
  (Stable already publishes: `v0.0.10` is live.) The dev-release runbook step is
  simply "publish the prerelease."
- No new hosting, no GitHub Pages, no `electron-updater`.

## 11. Dependencies

- Add **`semver`** + **`@types/semver`** as direct dependencies for
  prerelease-aware version comparison in the notify path. (`semver@7.x` is
  already present transitively; we promote it to a direct dep rather than import
  a transitive one.)
- **Keep `update-electron-app`** and `electron-squirrel-startup`.

## 12. Testing strategy

- **Unit** (`vitest` unit project):
  - `semver`-based comparison incl. prerelease ordering.
  - `(platform, channel) → mode` matrix.
  - notify checker: filtering prerelease vs stable, picking newest, "up to
    date" when current ≥ latest (incl. dev→stable downgrade case), error
    handling — mock `fetch`.
  - controller state transitions — mock `autoUpdater` + notify checker.
- **Integration** (`vitest` integration project):
  - `POST /api/updates/check` and `/install` behavior.
  - WS `updateState` broadcast + snapshot on connect.
  - app-settings change re-evaluates the controller mode.
- **DOM** (`vitest` dom project):
  - Settings "Updates" section renders each status; toggles call the API.
  - `ConnectionFooter` indicator shows/hides by status; Popover renders the
    right action per `mode`.
- **E2E** (`playwright`): unchanged — `autoUpdater` cannot run unsigned in CI;
  the silent path stays guarded by `app.isPackaged`.

## 13. Out of scope / known limits

- No silent auto-install for the **Development** channel (notify + open release),
  by design.
- No **Linux** silent install (Electron limitation).
- No **downgrade** when switching Development→Stable while on a newer
  prerelease — the user stays put until Stable catches up; shown as "up to
  date."
- Runtime channel switch / `autoCheck`-off for the **silent** path takes effect
  on **next launch** (see §7); shown via an in-UI hint.
- Direct per-asset/per-distro download links (notify path opens the release
  page instead).
- Replacing `update-electron-app` with a custom `autoUpdater` wrapper for full
  runtime control — explicitly deferred to a future feature.

## 14. File-change summary

| Area | Files |
|---|---|
| Types | `src/shared/types.ts` (`UpdateChannel`, `UpdateStatus`, `UpdateState`, `AppSettings.updates`, `DEFAULT_APP_SETTINGS`, `WsMessage`) |
| Main — updater | `src/main/updates/{controller,silent,notify}.ts` (replaces `src/main/updater.ts`); wire in `src/main/index.ts` |
| Main — transport | `src/main/events/bus.ts`, `src/main/server.ts`, update routes module under `/api` |
| Main — surfaces | `src/main/menu.ts`, `src/main/about.ts` |
| Renderer — state | `src/renderer/app/wsHandlers.ts`, `src/renderer/lib/store.ts`, `src/renderer/lib/api.ts` |
| Renderer — UI | `src/renderer/panels/settings/app/Updates.tsx` (+ registration), `src/renderer/shell/leftnav/ConnectionFooter.tsx`, `src/renderer/features/command-palette/items/actions.ts` |
| CI | `.github/workflows/ci.yml` |
| Deps | `package.json` (`semver`, `@types/semver`) |
