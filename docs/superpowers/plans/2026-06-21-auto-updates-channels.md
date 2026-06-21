# Auto-Updates with Stable / Development Channels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two update channels (Stable, Development) on top of the existing
`update-electron-app` silent updater, with Settings controls, manual-check
surfaces (menu / command palette / About), and a persistent "update pending"
indicator (with a Popover restart action) in the ConnectionFooter.

**Architecture:** Keep the working silent path (`update-electron-app` → native
`autoUpdater`, Stable on macOS/Windows). Add a notify path (our own GitHub
Releases checker) for the Development channel everywhere and for all Linux
updates. A main-process **controller** chooses `silent` vs `notify` from
`(platform, channel)`, holds an `UpdateState`, broadcasts it over the existing
WebSocket, and exposes `check()` / `installAndRestart()` via `/api/updates/*`.
Electron access lives only in a thin, non-unit-tested wiring module; everything
else takes its Electron/HTTP dependencies by injection so it is unit-testable in
plain Node (matching the project's existing seam pattern, e.g. `appLifecycle()`).

**Tech Stack:** Electron Forge + Vite, TypeScript, React, Zustand store, Hono
HTTP server + `ws` WebSocket, Biome, Vitest (projects: `unit`, `integration`,
`dom`), `update-electron-app`, `semver`.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied
verbatim from the design spec
(`docs/superpowers/specs/2026-06-21-auto-updates-channels-design.md`).

- **Keep `update-electron-app`.** It owns the feed URL, download, background
  poll, and (with `notifyUser: true`) the native "Restart now?" dialog for the
  silent path. The ONLY direct `autoUpdater` calls we add are: read-only event
  listeners (status mirroring) and `autoUpdater.quitAndInstall()` for the
  Popover "Restart" action. Do NOT call `setFeedURL` or compute feed URLs.
- **Behavior matrix (exact):**
  - Stable + (`darwin` | `win32`) → `silent` (`update-electron-app`).
  - Development (any platform) → `notify`.
  - Stable + `linux` → `notify`.
  - `mode = (channel === 'stable' && (platform === 'darwin' || platform === 'win32')) ? 'silent' : 'notify'`.
- **Development source = GitHub *prereleases*** of `andyshinn/coresense`.
  Stable silent path uses `update.electronjs.org` (unchanged).
- **Notify path opens the release page** (`releaseUrl` via
  `shell.openExternal`) — NOT a per-asset/direct download (v1).
- **Channel default `stable`, `autoCheck` default `true`.**
- **No downgrade** when switching Development→Stable while on a newer
  prerelease (report `up-to-date`).
- **Known limitation (intended):** for the silent path, turning `autoCheck` off
  or switching away from Stable only takes effect on next launch
  (`update-electron-app` cannot be stopped/reconfigured once started). The
  notify path reacts immediately.
- **`semver`** is a direct dependency, used for prerelease-aware comparison.
- **Electron isolation:** modules under unit test must NOT statically import
  `electron` or `update-electron-app`. Real Electron deps are injected from the
  single composition root `src/main/updates/wiring.ts` (not unit-tested).
- **Worktree/sandbox:** we work in a git worktree under `.claude/worktrees/`.
  `git` commits and `pnpm add` (network) require the sandbox DISABLED;
  `vitest`, `tsc`, and `biome` run fine sandboxed.
- **Lint scope:** run `pnpm exec biome check <changed files>` (repo-wide
  `pnpm lint` flags pre-existing build/dist artifacts).
- **Commit style:** conventional commits, e.g. `feat(updates): ...`. End each
  commit message body with the project trailer
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/shared/types.ts` | `UpdateChannel`, `UpdateStatus`, `UpdateState`; `AppSettings.updates`; `DEFAULT_APP_SETTINGS.updates`; `WsMessage` variant | Modify |
| `src/main/updates/version.ts` | semver compare + pick-latest-release (pure) | Create |
| `src/main/updates/notify.ts` | GitHub Releases checker → `UpdateState` (fetch injected) | Create |
| `src/main/updates/silent.ts` | `update-electron-app`/`autoUpdater` wrapper (deps injected) | Create |
| `src/main/updates/controller.ts` | mode selection, state, poll, check/install; singleton seam | Create |
| `src/main/updates/wiring.ts` | composition root: wires real Electron deps; `startUpdates()` | Create |
| `src/main/updater.ts` | old single-purpose updater | Delete |
| `src/main/index.ts` | boot wiring (`startUpdater()` → `startUpdates()`) | Modify |
| `src/main/events/bus.ts` | `emit.updateState` + `BusEvents` | Modify |
| `src/main/server.ts` | broadcast `updateState` + snapshot on connect | Modify |
| `src/main/api/routes.ts` | `POST /api/updates/check`, `POST /api/updates/install` | Modify |
| `src/main/menu.ts` | Help-menu "Check for Updates…" → `controller.check()` | Modify |
| `src/main/about.ts` | About dialog "Check for Updates" button | Modify |
| `src/renderer/lib/store.ts` | `updateState` slice + `applyUpdateState` | Modify |
| `src/renderer/app/wsHandlers.ts` | `case 'updateState'` | Modify |
| `src/renderer/lib/api.ts` | `checkForUpdates()`, `installUpdate()` | Modify |
| `src/renderer/panels/settings/app/Updates.tsx` | Settings "Updates" section | Create |
| `src/renderer/panels/settings/app/index.ts` + `SettingsPanel.tsx` | register section | Modify |
| `src/renderer/shell/leftnav/ConnectionFooter.tsx` | update-pending indicator + Popover | Modify |
| `src/renderer/features/command-palette/items/actions.ts` | "Check for updates" action | Modify |
| `package.json` | `semver` + `@types/semver` | Modify |
| `.github/workflows/ci.yml` | publish prereleases (not draft) | Modify |

---

### Task 1: Shared update types + AppSettings.updates

**Files:**
- Modify: `src/shared/types.ts` (add types near `AppSettings`, line ~317; defaults at line ~417; `WsMessage` union ~line 949)
- Test: `tests/unit/shared/settings/app-settings-updates.test.ts`

**Interfaces:**
- Produces: `UpdateChannel = 'stable' | 'development'`; `UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'`; `UpdateState`; `AppSettings.updates: { channel: UpdateChannel; autoCheck: boolean }`; `DEFAULT_APP_SETTINGS.updates`; `WsMessage` adds `{ type: 'updateState'; payload: UpdateState }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/settings/app-settings-updates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../src/shared/types';

describe('AppSettings.updates defaults', () => {
  it('defaults to the stable channel with auto-check on', () => {
    expect(DEFAULT_APP_SETTINGS.updates).toEqual({ channel: 'stable', autoCheck: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/shared/settings/app-settings-updates.test.ts`
Expected: FAIL — `DEFAULT_APP_SETTINGS.updates` is `undefined`.

- [ ] **Step 3: Add the types**

In `src/shared/types.ts`, add near the other update/exported types (e.g. just above `export interface AppSettings {`):

```ts
export type UpdateChannel = 'stable' | 'development';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  /** Which mechanism applies right now, from (platform, channel). */
  mode: 'silent' | 'notify';
  channel: UpdateChannel;
  currentVersion: string;
  latestVersion?: string;
  /** Notify path only: the GitHub release page to open. */
  releaseUrl?: string;
  lastCheckedAt?: number;
  error?: string;
}
```

Inside `interface AppSettings { ... }` add the field (place after `quickActions`):

```ts
  /** Auto-update channel + background-check toggle. */
  updates: {
    channel: UpdateChannel;
    autoCheck: boolean;
  };
```

In `DEFAULT_APP_SETTINGS` add (after `quickActions: [...]`):

```ts
  updates: { channel: 'stable', autoCheck: true },
```

Add to the `WsMessage` union (after the `log:snapshot` member):

```ts
  | { type: 'updateState'; payload: UpdateState }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/shared/settings/app-settings-updates.test.ts`
Expected: PASS. Then `pnpm typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/unit/shared/settings/app-settings-updates.test.ts
git commit -m "feat(updates): add update channel/state types and AppSettings.updates"
```

---

### Task 2: semver dependency + version utilities

**Files:**
- Modify: `package.json` (add `semver`, `@types/semver`)
- Create: `src/main/updates/version.ts`
- Test: `tests/unit/main/updates/version.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeTag(tag: string): string | null`; `isNewer(latestTag: string, current: string): boolean`; `pickLatest(releases: GitHubRelease[], channel: UpdateChannel): GitHubRelease | null`; `interface GitHubRelease { tag_name: string; html_url: string; prerelease: boolean; draft: boolean }`.

- [ ] **Step 1: Add the dependency** (sandbox DISABLED — needs network)

```bash
pnpm add semver
pnpm add -D @types/semver
```

Expected: `package.json` lists `semver` under dependencies and `@types/semver` under devDependencies; lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/main/updates/version.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isNewer, normalizeTag, pickLatest } from '../../../../src/main/updates/version';

describe('normalizeTag', () => {
  it('strips a leading v and validates semver', () => {
    expect(normalizeTag('v0.1.0')).toBe('0.1.0');
    expect(normalizeTag('0.1.0-beta.2')).toBe('0.1.0-beta.2');
    expect(normalizeTag('nightly')).toBeNull();
  });
});

describe('isNewer', () => {
  it('compares release tags against the current version (prerelease-aware)', () => {
    expect(isNewer('v0.0.11', '0.0.10')).toBe(true);
    expect(isNewer('v0.0.10', '0.0.10')).toBe(false);
    expect(isNewer('v0.0.9', '0.0.10')).toBe(false);
    expect(isNewer('v0.1.0-beta.2', '0.1.0-beta.1')).toBe(true);
    expect(isNewer('v0.1.0-beta.1', '0.1.0')).toBe(false);
    expect(isNewer('v0.0.10', '0.1.0-beta.1')).toBe(false); // no downgrade dev->stable
  });
});

describe('pickLatest', () => {
  const releases = [
    { tag_name: 'v0.0.10', html_url: 'u10', prerelease: false, draft: false },
    { tag_name: 'v0.1.0-beta.1', html_url: 'b1', prerelease: true, draft: false },
    { tag_name: 'v0.1.0-beta.3', html_url: 'b3', prerelease: true, draft: false },
    { tag_name: 'v9.9.9', html_url: 'draft', prerelease: false, draft: true },
  ];
  it('stable picks the highest non-prerelease, ignoring drafts', () => {
    expect(pickLatest(releases, 'stable')?.html_url).toBe('u10');
  });
  it('development picks the highest prerelease', () => {
    expect(pickLatest(releases, 'development')?.html_url).toBe('b3');
  });
  it('returns null when no candidate matches', () => {
    expect(pickLatest([releases[0]], 'development')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/version.test.ts`
Expected: FAIL — module `src/main/updates/version.ts` not found.

- [ ] **Step 4: Implement `src/main/updates/version.ts`**

```ts
import semver from 'semver';
import type { UpdateChannel } from '../../shared/types';

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

/** Strip a leading `v` and return a valid semver string, or null. */
export function normalizeTag(tag: string): string | null {
  return semver.valid(tag.replace(/^v/, '').trim());
}

/** True when `latestTag` is a strictly newer version than `current`. */
export function isNewer(latestTag: string, current: string): boolean {
  const latest = normalizeTag(latestTag);
  const cur = semver.valid(current);
  if (!latest || !cur) return false;
  return semver.gt(latest, cur);
}

/**
 * Highest-semver published release for the channel.
 * Stable = newest non-prerelease; Development = newest prerelease.
 * Drafts are always excluded (unauthenticated API never returns them anyway).
 */
export function pickLatest(releases: GitHubRelease[], channel: UpdateChannel): GitHubRelease | null {
  const wantPrerelease = channel === 'development';
  let best: GitHubRelease | null = null;
  let bestVersion: string | null = null;
  for (const r of releases) {
    if (r.draft) continue;
    if (r.prerelease !== wantPrerelease) continue;
    const v = normalizeTag(r.tag_name);
    if (!v) continue;
    if (!bestVersion || semver.gt(v, bestVersion)) {
      best = r;
      bestVersion = v;
    }
  }
  return best;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/version.test.ts`
Expected: PASS. Then `pnpm typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/main/updates/version.ts tests/unit/main/updates/version.test.ts
git commit -m "feat(updates): add semver dep and version comparison utilities"
```

---

### Task 3: Notify checker (GitHub Releases)

**Files:**
- Create: `src/main/updates/notify.ts`
- Test: `tests/unit/main/updates/notify.test.ts`

**Interfaces:**
- Consumes: `isNewer`, `pickLatest`, `GitHubRelease` (Task 2); `UpdateChannel`, `UpdateState` (Task 1).
- Produces: `interface NotifyDeps { fetch: typeof fetch; now: () => number }`; `checkNotify(channel: UpdateChannel, currentVersion: string, deps: NotifyDeps): Promise<UpdateState>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/updates/notify.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { checkNotify } from '../../../../src/main/updates/notify';

function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}
const now = () => 1_000;

const releases = [
  { tag_name: 'v0.0.10', html_url: 'https://gh/u10', prerelease: false, draft: false },
  { tag_name: 'v0.1.0-beta.1', html_url: 'https://gh/b1', prerelease: true, draft: false },
];

describe('checkNotify', () => {
  it('reports an available stable update', async () => {
    const s = await checkNotify('stable', '0.0.9', { fetch: fakeFetch(releases), now });
    expect(s).toMatchObject({
      status: 'available',
      mode: 'notify',
      channel: 'stable',
      latestVersion: '0.0.10',
      releaseUrl: 'https://gh/u10',
      lastCheckedAt: 1000,
    });
  });

  it('reports an available development (prerelease) update', async () => {
    const s = await checkNotify('development', '0.0.10', { fetch: fakeFetch(releases), now });
    expect(s).toMatchObject({ status: 'available', latestVersion: '0.1.0-beta.1', releaseUrl: 'https://gh/b1' });
  });

  it('reports up-to-date when nothing is newer', async () => {
    const s = await checkNotify('stable', '0.0.10', { fetch: fakeFetch(releases), now });
    expect(s.status).toBe('up-to-date');
    expect(s.releaseUrl).toBeUndefined();
  });

  it('reports an error on a non-OK response', async () => {
    const s = await checkNotify('stable', '0.0.10', { fetch: fakeFetch(null, false, 503), now });
    expect(s.status).toBe('error');
    expect(s.error).toContain('503');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/notify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/updates/notify.ts`**

```ts
import type { UpdateChannel, UpdateState } from '../../shared/types';
import { type GitHubRelease, isNewer, normalizeTag, pickLatest } from './version';

const RELEASES_URL = 'https://api.github.com/repos/andyshinn/coresense/releases?per_page=30';

export interface NotifyDeps {
  fetch: typeof fetch;
  now: () => number;
}

/** Check GitHub Releases for the channel and return a notify-mode UpdateState. */
export async function checkNotify(
  channel: UpdateChannel,
  currentVersion: string,
  deps: NotifyDeps,
): Promise<UpdateState> {
  const base = { mode: 'notify', channel, currentVersion } as const;
  try {
    const res = await deps.fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'coresense-updater' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const releases = (await res.json()) as GitHubRelease[];
    const latest = pickLatest(releases, channel);
    const lastCheckedAt = deps.now();
    if (latest && isNewer(latest.tag_name, currentVersion)) {
      return {
        ...base,
        status: 'available',
        latestVersion: normalizeTag(latest.tag_name) ?? latest.tag_name,
        releaseUrl: latest.html_url,
        lastCheckedAt,
      };
    }
    return { ...base, status: 'up-to-date', lastCheckedAt };
  } catch (err) {
    return { ...base, status: 'error', error: (err as Error).message, lastCheckedAt: deps.now() };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/notify.test.ts`
Expected: PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/main/updates/notify.ts tests/unit/main/updates/notify.test.ts
git commit -m "feat(updates): add GitHub Releases notify checker"
```

---

### Task 4: Silent-path wrapper (update-electron-app)

**Files:**
- Create: `src/main/updates/silent.ts`
- Test: `tests/unit/main/updates/silent.test.ts`

**Interfaces:**
- Consumes: `UpdateState` (Task 1).
- Produces: `interface AutoUpdaterLike { on(event: string, listener: (...args: unknown[]) => void): void; checkForUpdates(): void; quitAndInstall(): void }`; `interface SilentDeps { autoUpdater: AutoUpdaterLike; updateElectronApp: (opts: { updateInterval?: string; notifyUser?: boolean; logger?: unknown }) => void; isPackaged: () => boolean; isMas: () => boolean; logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }; onState: (partial: Partial<UpdateState>) => void }`; `createSilentUpdater(deps: SilentDeps): { ensureStarted(): boolean; check(): void; installAndRestart(): void; isStarted(): boolean }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/updates/silent.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSilentUpdater } from '../../../../src/main/updates/silent';

function harness(over: Partial<Parameters<typeof createSilentUpdater>[0]> = {}) {
  const listeners: Record<string, (...a: unknown[]) => void> = {};
  const autoUpdater = {
    on: (e: string, fn: (...a: unknown[]) => void) => {
      listeners[e] = fn;
    },
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  const updateElectronApp = vi.fn();
  const onState = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const silent = createSilentUpdater({
    autoUpdater,
    updateElectronApp,
    isPackaged: () => true,
    isMas: () => false,
    logger,
    onState,
    ...over,
  });
  return { silent, autoUpdater, updateElectronApp, onState, listeners };
}

describe('createSilentUpdater', () => {
  it('does not start when unpackaged', () => {
    const { silent, updateElectronApp } = harness({ isPackaged: () => false });
    expect(silent.ensureStarted()).toBe(false);
    expect(updateElectronApp).not.toHaveBeenCalled();
  });

  it('does not start on Mac App Store builds', () => {
    const { silent, updateElectronApp } = harness({ isMas: () => true });
    expect(silent.ensureStarted()).toBe(false);
    expect(updateElectronApp).not.toHaveBeenCalled();
  });

  it('starts update-electron-app once and is idempotent', () => {
    const { silent, updateElectronApp } = harness();
    expect(silent.ensureStarted()).toBe(true);
    expect(silent.ensureStarted()).toBe(true);
    expect(updateElectronApp).toHaveBeenCalledTimes(1);
    expect(updateElectronApp).toHaveBeenCalledWith(
      expect.objectContaining({ updateInterval: '1 hour', notifyUser: true }),
    );
  });

  it('mirrors autoUpdater events into onState', () => {
    const { silent, onState, listeners } = harness();
    silent.ensureStarted();
    listeners['checking-for-update']();
    listeners['update-available']();
    listeners['update-downloaded']();
    listeners['update-not-available']();
    listeners.error(new Error('boom'));
    expect(onState).toHaveBeenCalledWith({ status: 'checking' });
    expect(onState).toHaveBeenCalledWith({ status: 'downloading' });
    expect(onState).toHaveBeenCalledWith({ status: 'downloaded' });
    expect(onState).toHaveBeenCalledWith({ status: 'up-to-date' });
    expect(onState).toHaveBeenCalledWith({ status: 'error', error: 'boom' });
  });

  it('check() starts then calls checkForUpdates; install calls quitAndInstall', () => {
    const { silent, autoUpdater } = harness();
    silent.check();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    silent.installAndRestart();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/silent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/updates/silent.ts`**

```ts
import type { UpdateState } from '../../shared/types';

export interface AutoUpdaterLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}

export interface SilentDeps {
  autoUpdater: AutoUpdaterLike;
  updateElectronApp: (opts: { updateInterval?: string; notifyUser?: boolean; logger?: unknown }) => void;
  isPackaged: () => boolean;
  isMas: () => boolean;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  onState: (partial: Partial<UpdateState>) => void;
}

/**
 * Thin layer over update-electron-app. It owns the feed/download/poll and the
 * native restart dialog (notifyUser: true). We only add read-only status
 * listeners and a quitAndInstall() for the in-app Popover restart action.
 */
export function createSilentUpdater(deps: SilentDeps) {
  let started = false;

  function attachListeners(): void {
    deps.autoUpdater.on('checking-for-update', () => deps.onState({ status: 'checking' }));
    deps.autoUpdater.on('update-available', () => deps.onState({ status: 'downloading' }));
    deps.autoUpdater.on('update-not-available', () => deps.onState({ status: 'up-to-date' }));
    deps.autoUpdater.on('update-downloaded', () => deps.onState({ status: 'downloaded' }));
    deps.autoUpdater.on('error', (...args: unknown[]) => {
      const err = args[0];
      deps.onState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    });
  }

  function ensureStarted(): boolean {
    if (started) return true;
    if (!deps.isPackaged() || deps.isMas()) return false;
    try {
      attachListeners();
      deps.updateElectronApp({ updateInterval: '1 hour', notifyUser: true, logger: deps.logger });
      started = true;
    } catch (err) {
      deps.logger.warn(`silent updater init failed: ${(err as Error).message}`);
      return false;
    }
    return true;
  }

  return {
    ensureStarted,
    check(): void {
      if (ensureStarted()) deps.autoUpdater.checkForUpdates();
    },
    installAndRestart(): void {
      deps.autoUpdater.quitAndInstall();
    },
    isStarted: (): boolean => started,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/silent.test.ts`
Expected: PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/main/updates/silent.ts tests/unit/main/updates/silent.test.ts
git commit -m "feat(updates): add silent-path wrapper around update-electron-app"
```

---

### Task 5: Update controller + singleton seam

**Files:**
- Create: `src/main/updates/controller.ts`
- Test: `tests/unit/main/updates/controller.test.ts`

**Interfaces:**
- Consumes: `UpdateChannel`, `UpdateState` (Task 1); `checkNotify` signature (Task 3); silent updater shape (Task 4).
- Produces:
  - `computeMode(platform: NodeJS.Platform, channel: UpdateChannel): 'silent' | 'notify'`
  - `interface UpdateControllerDeps { platform: NodeJS.Platform; currentVersion: string; getSettings: () => { channel: UpdateChannel; autoCheck: boolean }; silent: { ensureStarted(): boolean; check(): void; installAndRestart(): void }; checkNotify: (channel: UpdateChannel, current: string) => Promise<UpdateState>; openExternal: (url: string) => void; emitState: (s: UpdateState) => void; setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>; clearInterval: (h: ReturnType<typeof setInterval>) => void }`
  - `createUpdateController(deps): { start(): void; check(): Promise<UpdateState>; installAndRestart(): void; getState(): UpdateState; onSettingsChanged(): void; onSilentState(p: Partial<UpdateState>): void }`
  - Singleton seam: `setUpdatesController(c: UpdateController | null): void`; `updatesController(): UpdateController`; `currentUpdateState(): UpdateState`; and `type UpdateController = ReturnType<typeof createUpdateController>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/updates/controller.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../../../src/shared/types';
import { computeMode, createUpdateController } from '../../../../src/main/updates/controller';

describe('computeMode', () => {
  it('is silent only for stable on macOS/Windows', () => {
    expect(computeMode('darwin', 'stable')).toBe('silent');
    expect(computeMode('win32', 'stable')).toBe('silent');
    expect(computeMode('linux', 'stable')).toBe('notify');
    expect(computeMode('darwin', 'development')).toBe('notify');
    expect(computeMode('linux', 'development')).toBe('notify');
  });
});

function harness(over: Partial<Parameters<typeof createUpdateController>[0]> = {}) {
  const silent = { ensureStarted: vi.fn(() => true), check: vi.fn(), installAndRestart: vi.fn() };
  const emitState = vi.fn();
  const openExternal = vi.fn();
  const checkNotify = vi.fn(
    async (channel, current): Promise<UpdateState> => ({
      status: 'available',
      mode: 'notify',
      channel,
      currentVersion: current,
      latestVersion: '9.9.9',
      releaseUrl: 'https://gh/rel',
    }),
  );
  let settings = { channel: 'stable' as const, autoCheck: true };
  const timers: Array<() => void> = [];
  const controller = createUpdateController({
    platform: 'darwin',
    currentVersion: '0.0.10',
    getSettings: () => settings,
    silent,
    checkNotify,
    openExternal,
    emitState,
    setInterval: (fn) => {
      timers.push(fn);
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: vi.fn(),
    ...over,
  });
  return { controller, silent, emitState, openExternal, checkNotify, setSettings: (s: typeof settings) => (settings = s) };
}

describe('createUpdateController', () => {
  it('silent check delegates to the silent updater', async () => {
    const { controller, silent } = harness();
    await controller.check();
    expect(silent.check).toHaveBeenCalledTimes(1);
    expect(controller.getState().mode).toBe('silent');
  });

  it('notify check uses checkNotify and stores the result', async () => {
    const { controller, checkNotify } = harness({ platform: 'linux' });
    const s = await controller.check();
    expect(checkNotify).toHaveBeenCalledWith('stable', '0.0.10');
    expect(s.status).toBe('available');
    expect(s.releaseUrl).toBe('https://gh/rel');
  });

  it('install opens the release URL in notify mode', async () => {
    const { controller, openExternal } = harness({ platform: 'linux' });
    await controller.check();
    controller.installAndRestart();
    expect(openExternal).toHaveBeenCalledWith('https://gh/rel');
  });

  it('install delegates to the silent updater in silent mode', async () => {
    const { controller, silent } = harness();
    await controller.check();
    controller.installAndRestart();
    expect(silent.installAndRestart).toHaveBeenCalledTimes(1);
  });

  it('emits state on every transition', async () => {
    const { controller, emitState } = harness({ platform: 'linux' });
    await controller.check();
    expect(emitState).toHaveBeenCalledWith(expect.objectContaining({ status: 'checking' }));
    expect(emitState).toHaveBeenCalledWith(expect.objectContaining({ status: 'available' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/updates/controller.ts`**

```ts
import type { UpdateChannel, UpdateState } from '../../shared/types';

export function computeMode(platform: NodeJS.Platform, channel: UpdateChannel): 'silent' | 'notify' {
  return channel === 'stable' && (platform === 'darwin' || platform === 'win32') ? 'silent' : 'notify';
}

export interface UpdateControllerDeps {
  platform: NodeJS.Platform;
  currentVersion: string;
  getSettings: () => { channel: UpdateChannel; autoCheck: boolean };
  silent: { ensureStarted(): boolean; check(): void; installAndRestart(): void };
  checkNotify: (channel: UpdateChannel, current: string) => Promise<UpdateState>;
  openExternal: (url: string) => void;
  emitState: (s: UpdateState) => void;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (h: ReturnType<typeof setInterval>) => void;
}

const POLL_MS = 60 * 60 * 1000;

export function createUpdateController(deps: UpdateControllerDeps) {
  const initial = deps.getSettings();
  let state: UpdateState = {
    status: 'idle',
    mode: computeMode(deps.platform, initial.channel),
    channel: initial.channel,
    currentVersion: deps.currentVersion,
  };
  let poll: ReturnType<typeof setInterval> | null = null;

  function setState(partial: Partial<UpdateState>): void {
    state = { ...state, ...partial };
    deps.emitState(state);
  }

  function stopPoll(): void {
    if (poll !== null) {
      deps.clearInterval(poll);
      poll = null;
    }
  }

  async function check(): Promise<UpdateState> {
    const { channel } = deps.getSettings();
    const mode = computeMode(deps.platform, channel);
    setState({ status: 'checking', mode, channel });
    if (mode === 'silent') {
      // Status flows back through onSilentState() from autoUpdater events.
      deps.silent.check();
      return state;
    }
    const result = await deps.checkNotify(channel, deps.currentVersion);
    setState(result);
    return state;
  }

  function installAndRestart(): void {
    if (state.mode === 'silent') deps.silent.installAndRestart();
    else if (state.releaseUrl) deps.openExternal(state.releaseUrl);
  }

  function applySettings(): void {
    const { channel, autoCheck } = deps.getSettings();
    const mode = computeMode(deps.platform, channel);
    setState({ mode, channel });
    if (mode === 'silent') {
      stopPoll(); // update-electron-app owns its own interval
      if (autoCheck) deps.silent.ensureStarted();
    } else {
      stopPoll();
      if (autoCheck) poll = deps.setInterval(() => void check(), POLL_MS);
    }
  }

  return {
    start(): void {
      applySettings();
      if (deps.getSettings().autoCheck) void check();
    },
    check,
    installAndRestart,
    getState: (): UpdateState => state,
    onSettingsChanged: applySettings,
    onSilentState: (p: Partial<UpdateState>): void => setState(p),
  };
}

export type UpdateController = ReturnType<typeof createUpdateController>;

// Singleton seam (mirrors runtime/appLifecycle): the composition root sets the
// instance; routes/menu/about/server read it. Tests inject a fake.
let instance: UpdateController | null = null;

export function setUpdatesController(c: UpdateController | null): void {
  instance = c;
}

export function updatesController(): UpdateController {
  if (!instance) throw new Error('updates controller not initialized');
  return instance;
}

export function currentUpdateState(): UpdateState {
  return instance
    ? instance.getState()
    : { status: 'idle', mode: 'notify', channel: 'stable', currentVersion: '' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/controller.test.ts`
Expected: PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/main/updates/controller.ts tests/unit/main/updates/controller.test.ts
git commit -m "feat(updates): add update controller with mode selection and singleton seam"
```

---

### Task 6: Composition root + boot wiring + bus event

**Files:**
- Create: `src/main/updates/wiring.ts`
- Delete: `src/main/updater.ts`
- Modify: `src/main/index.ts` (line 55 import, line 148 call)
- Modify: `src/main/events/bus.ts` (`emit` object ~line 82; `BusEvents` type ~line 119)
- Test: `tests/unit/main/updates/bus-updateState.test.ts`

**Interfaces:**
- Consumes: `createSilentUpdater` (Task 4); `createUpdateController`, `setUpdatesController` (Task 5); `checkNotify` (Task 3); `emit`/`bus` (bus.ts); `stateHolder` (state/holder); `APP_VERSION` (build-info).
- Produces: `startUpdates(): void`; `emit.updateState(state: UpdateState)` + its `BusEvents` entry.

- [ ] **Step 1: Write the failing test (bus wiring)**

Create `tests/unit/main/updates/bus-updateState.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { bus, emit } from '../../../../src/main/events/bus';
import type { UpdateState } from '../../../../src/shared/types';

describe('emit.updateState', () => {
  it('emits the updateState bus event with the payload', () => {
    const seen: UpdateState[] = [];
    const handler = (s: UpdateState) => seen.push(s);
    bus.on('updateState', handler);
    const state: UpdateState = { status: 'idle', mode: 'notify', channel: 'stable', currentVersion: '0.0.10' };
    emit.updateState(state);
    bus.off('updateState', handler);
    expect(seen).toEqual([state]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/bus-updateState.test.ts`
Expected: FAIL — `emit.updateState` is not a function.

- [ ] **Step 3: Add the bus event**

In `src/main/events/bus.ts`, add to the `emit` object (after `logEntry`):

```ts
  updateState: (state: UpdateState) => bus.emit('updateState', state),
```

Add to the `BusEvents` type (after `'log:entry'`):

```ts
  updateState: (state: UpdateState) => void;
```

Add `UpdateState` to the existing type import from `'../../shared/types'`.

- [ ] **Step 4: Implement `src/main/updates/wiring.ts`**

```ts
import { app, autoUpdater, shell } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import { APP_VERSION } from '../build-info';
import { bus, emit } from '../events/bus';
import { child } from '../log';
import { stateHolder } from '../state/holder';
import { createUpdateController, setUpdatesController, type UpdateController } from './controller';
import { checkNotify } from './notify';
import { createSilentUpdater } from './silent';

// Composition root: the ONLY module that imports electron / update-electron-app
// for the updater. Everything it wires is dependency-injected and unit-tested.
export function startUpdates(): void {
  const log = child('updates');
  let controllerRef: UpdateController | null = null;

  const silent = createSilentUpdater({
    autoUpdater: autoUpdater as unknown as Parameters<typeof createSilentUpdater>[0]['autoUpdater'],
    updateElectronApp,
    isPackaged: () => app.isPackaged,
    isMas: () => Boolean(process.mas),
    logger: { info: (m) => log.info(m), warn: (m) => log.warn(m), error: (m) => log.error(m) },
    onState: (p) => controllerRef?.onSilentState(p),
  });

  const controller = createUpdateController({
    platform: process.platform,
    currentVersion: APP_VERSION,
    getSettings: () => stateHolder().getAppSettings().updates,
    silent,
    checkNotify: (channel, current) => checkNotify(channel, current, { fetch: globalThis.fetch, now: () => Date.now() }),
    openExternal: (url) => void shell.openExternal(url),
    emitState: (s) => emit.updateState(s),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
  });

  controllerRef = controller;
  setUpdatesController(controller);
  bus.on('appSettings', () => controller.onSettingsChanged());
  controller.start();
}
```

- [ ] **Step 5: Rewire `src/main/index.ts` and delete the old updater**

In `src/main/index.ts`, change the import at line 55 from:

```ts
import { startUpdater } from './updater';
```

to:

```ts
import { startUpdates } from './updates/wiring';
```

Change the call at line 148 from `startUpdater();` to `startUpdates();`. Then:

```bash
git rm src/main/updater.ts
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm exec vitest run --project unit tests/unit/main/updates/bus-updateState.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: no errors (confirms `index.ts` + `wiring.ts` + bus types line up).

- [ ] **Step 7: Commit**

```bash
git add src/main/updates/wiring.ts src/main/index.ts src/main/events/bus.ts tests/unit/main/updates/bus-updateState.test.ts
git commit -m "feat(updates): wire updates controller at boot and add updateState bus event"
```

---

### Task 7: API routes (`/api/updates/check`, `/api/updates/install`)

**Files:**
- Modify: `src/main/api/routes.ts` (add imports; add two routes near the other `/api/app` routes)
- Test: `tests/integration/api/updates-routes.test.ts`

**Interfaces:**
- Consumes: `updatesController` (Task 5).
- Produces: `POST /api/updates/check` → `{ ok: true; updateState: UpdateState }`; `POST /api/updates/install` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/updates-routes.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { setUpdatesController, type UpdateController } from '../../../src/main/updates/controller';
import type { UpdateState } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const sample: UpdateState = {
  status: 'available',
  mode: 'notify',
  channel: 'development',
  currentVersion: '0.0.10',
  latestVersion: '0.1.0-beta.1',
  releaseUrl: 'https://gh/rel',
};

afterEach(() => setUpdatesController(null));

describe('updates routes', () => {
  it('POST /api/updates/check returns the controller state', async () => {
    const check = vi.fn(async () => sample);
    setUpdatesController({ check, installAndRestart: vi.fn(), getState: () => sample } as unknown as UpdateController);
    const res = await app().request('/api/updates/check', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; updateState: UpdateState };
    expect(body.ok).toBe(true);
    expect(body.updateState.latestVersion).toBe('0.1.0-beta.1');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('POST /api/updates/install invokes installAndRestart', async () => {
    const installAndRestart = vi.fn();
    setUpdatesController({ check: vi.fn(async () => sample), installAndRestart, getState: () => sample } as unknown as UpdateController);
    const res = await app().request('/api/updates/install', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(installAndRestart).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project integration tests/integration/api/updates-routes.test.ts`
Expected: FAIL — routes return 404 (not registered).

- [ ] **Step 3: Implement the routes**

In `src/main/api/routes.ts`, add to the imports:

```ts
import { updatesController } from '../updates/controller';
```

Add the routes alongside the other `/api/app/*` routes (e.g. right after the `/api/app/quit` handler):

```ts
  api.post('/api/updates/check', async (c) => {
    const updateState = await updatesController().check();
    return c.json({ ok: true, updateState });
  });

  api.post('/api/updates/install', (c) => {
    updatesController().installAndRestart();
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project integration tests/integration/api/updates-routes.test.ts`
Expected: PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/main/api/routes.ts tests/integration/api/updates-routes.test.ts
git commit -m "feat(updates): add /api/updates/check and /api/updates/install routes"
```

---

### Task 8: Server broadcast + snapshot on connect

**Files:**
- Modify: `src/main/server.ts` (broadcast handler ~line 217; bus subscription ~line 250; off/cleanup section ~line 254-287; new-client snapshot ~line 171)
- Test: covered by typecheck + the existing broadcast pattern (see note).

**Interfaces:**
- Consumes: `emit.updateState`/`bus` `'updateState'` event (Task 6); `currentUpdateState()` (Task 5); `WsMessage` `updateState` (Task 1).
- Produces: every WS client receives `{ type: 'updateState', payload }` on connect and on each controller transition.

> **Test note:** the project has no server-boot/WS integration harness, and the
> broadcast/subscribe/cleanup lines are a verbatim mirror of the existing
> `onAppSettings`/`onMenuAction` handlers. This task is verified by `pnpm
> typecheck` plus the unit coverage of `emit.updateState` (Task 6) and
> `currentUpdateState()` (exercised in Task 5's module). Do NOT invent a fragile
> new server-start test.

- [ ] **Step 1: Add the broadcast handler**

In `src/main/server.ts`, near the other `on*` handlers (e.g. after `onAppSettings`):

```ts
  const onUpdateState = (state: UpdateState) => broadcast({ type: 'updateState', payload: state });
```

Add `UpdateState` to the existing type import from `'../shared/types'`, and import the snapshot accessor near the other `src/main/updates` imports (add the import line at the top):

```ts
import { currentUpdateState } from './updates/controller';
```

- [ ] **Step 2: Subscribe and clean up**

In the bus subscription block (with `bus.on('appSettings', onAppSettings)` etc.) add:

```ts
  bus.on('updateState', onUpdateState);
```

In the cleanup/`off` section (where listeners are removed on server close) add:

```ts
  bus.off('updateState', onUpdateState);
```

- [ ] **Step 3: Send a snapshot on connect**

In the `wss.on('connection', ...)` handler, alongside the other initial `ws.send(...)` snapshot messages, add:

```ts
    ws.send(JSON.stringify({ type: 'updateState', payload: currentUpdateState() } satisfies WsMessage));
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm exec vitest run --project integration`
Expected: existing integration tests still pass (no regression).

- [ ] **Step 5: Commit**

```bash
git add src/main/server.ts
git commit -m "feat(updates): broadcast updateState over WebSocket with snapshot on connect"
```

---

### Task 9: Renderer store + WS handler + API client

**Files:**
- Modify: `src/renderer/lib/store.ts` (`CoreState` interface; initial state; add setter; hydrate)
- Modify: `src/renderer/app/wsHandlers.ts` (add `case 'updateState'`)
- Modify: `src/renderer/lib/api.ts` (add `checkForUpdates`, `installUpdate`)
- Test: `tests/unit/renderer/lib/update-store.test.ts`

**Interfaces:**
- Consumes: `UpdateState` (Task 1); `request`/`ApiClient` (api.ts).
- Produces: `useStore` state `updateState: UpdateState | null` + `applyUpdateState(s: UpdateState | null)`; `api.checkForUpdates(c): Promise<{ ok: true; updateState: UpdateState }>`; `api.installUpdate(c): Promise<{ ok: true }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/update-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import type { UpdateState } from '../../../../src/shared/types';

describe('store updateState slice', () => {
  it('starts null and applies pushed state', () => {
    expect(useStore.getState().updateState).toBeNull();
    const s: UpdateState = { status: 'downloaded', mode: 'silent', channel: 'stable', currentVersion: '0.0.10' };
    useStore.getState().applyUpdateState(s);
    expect(useStore.getState().updateState).toEqual(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/update-store.test.ts`
Expected: FAIL — `applyUpdateState` is not a function.

- [ ] **Step 3: Add the store slice**

In `src/renderer/lib/store.ts`:
- Add `UpdateState` to the existing type import from `'../../shared/types'`.
- In the `CoreState` interface (near `appSettings`), add:

```ts
  updateState: UpdateState | null;
  applyUpdateState: (state: UpdateState | null) => void;
```

- In the store initializer (near `appSettings: DEFAULT_APP_SETTINGS`), add:

```ts
  updateState: null,
```

- Add the setter (near `applyAppSettings`):

```ts
  applyUpdateState: (state) => set(() => ({ updateState: state })),
```

- [ ] **Step 4: Add the WS handler case**

In `src/renderer/app/wsHandlers.ts`, inside the `switch (msg.type)` (e.g. after `case 'appSettings'`):

```ts
      case 'updateState':
        s.applyUpdateState(msg.payload);
        break;
```

- [ ] **Step 5: Add the API client helpers**

In `src/renderer/lib/api.ts`:
- Add `UpdateState` to the type import from the shared types.
- Add to the `api` object:

```ts
  checkForUpdates: (c: ApiClient) =>
    request<{ ok: true; updateState: UpdateState }>(c, '/api/updates/check', { method: 'POST' }),
  installUpdate: (c: ApiClient) =>
    request<{ ok: true }>(c, '/api/updates/install', { method: 'POST' }),
```

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/update-store.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: no errors (confirms the `'updateState'` WsMessage case is handled).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/store.ts src/renderer/app/wsHandlers.ts src/renderer/lib/api.ts tests/unit/renderer/lib/update-store.test.ts
git commit -m "feat(updates): renderer store slice, WS handler, and api client for updates"
```

---

### Task 10: Settings "Updates" section

**Files:**
- Create: `src/renderer/panels/settings/app/Updates.tsx`
- Modify: `src/renderer/panels/settings/app/index.ts` (export)
- Modify: `src/renderer/panels/settings/SettingsPanel.tsx` (register in `TAB_SECTIONS.app` + render in `AppTab`)
- Test: `tests/component/settings-updates.test.tsx`

**Interfaces:**
- Consumes: `useStore`, `api.checkForUpdates`/`api.installUpdate`, `saveApp`, `useSettingsSection`, `Row`/`Select`/`Toggle`, `SettingsSection`, `SectionProps`, `UpdateState`.
- Produces: `export function UpdatesSection({ client }: SectionProps)`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/settings-updates.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: {
    putAppSettings: vi.fn(async () => ({ ok: true })),
    checkForUpdates: vi.fn(async () => ({ ok: true, updateState: null })),
  },
}));

import { api } from '../../src/renderer/lib/api';
import { useStore } from '../../src/renderer/lib/store';
import { UpdatesSection } from '../../src/renderer/panels/settings/app/Updates';

const client = { baseUrl: 'http://x', apiKey: 'k' };

describe('UpdatesSection', () => {
  it('renders channel + auto-check and triggers a manual check', () => {
    render(<UpdatesSection client={client} />);
    expect(screen.getByText('Updates')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('persists a channel change on save', () => {
    render(<UpdatesSection client={client} />);
    fireEvent.change(screen.getByDisplayValue('Stable'), { target: { value: 'development' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api.putAppSettings).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ updates: expect.objectContaining({ channel: 'development' }) }),
    );
  });
});
```

> If the existing `Select` renders as a native `<select>`, `getByDisplayValue('Stable')` + `fireEvent.change` works. If it is a custom control, mirror the interaction used in an existing `tests/component` settings/select test instead — keep the assertion (`api.putAppSettings` called with `updates.channel === 'development'`) identical.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/settings-updates.test.tsx`
Expected: FAIL — `UpdatesSection` module not found.

- [ ] **Step 3: Implement `src/renderer/panels/settings/app/Updates.tsx`**

```tsx
import { ArrowUpCircle, RefreshCw } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { Row, Select, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from './shared';

const CHANNEL_OPTIONS = [
  { value: 'stable', label: 'Stable' },
  { value: 'development', label: 'Development' },
] as const;

const eqUpdates = (a: AppSettingsType, b: AppSettingsType) =>
  a.updates.channel === b.updates.channel && a.updates.autoCheck === b.updates.autoCheck;

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  checking: 'Checking…',
  'up-to-date': 'Up to date',
  available: 'Update available',
  downloading: 'Downloading…',
  downloaded: 'Downloaded — restart to apply',
  error: 'Check failed',
};

export function UpdatesSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const updateState = useStore((s) => s.updateState);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-updates',
    saved,
    eq: eqUpdates,
    onSave: (d) => saveApp(client, { updates: d.updates }, 'Update settings saved'),
  });

  const u = draft.updates;
  const s0 = saved.updates;
  const setU = (patch: Partial<AppSettingsType['updates']>) =>
    setDraft((s) => ({ ...s, updates: { ...s.updates, ...patch } }));

  const onCheck = () => {
    if (!client) return;
    void api.checkForUpdates(client).then(
      (r) => {
        if (r.updateState?.status === 'available') notify.success(`Update available: ${r.updateState.latestVersion}`);
        else if (r.updateState?.status === 'up-to-date') notify.info('You are up to date');
      },
      (err) => notify.error(`Update check failed: ${(err as Error).message}`, err),
    );
  };

  const statusText = updateState ? (STATUS_LABEL[updateState.status] ?? updateState.status) : 'Idle';
  const silentRestartHint =
    dirty && (s0.channel === 'stable' || u.channel === 'stable')
      ? 'Channel/auto-check changes to the silent updater apply on next launch.'
      : undefined;

  return (
    <SettingsSection
      id="app-updates"
      icon={ArrowUpCircle}
      title="Updates"
      description="Choose an update channel and check for new versions."
      footnote={silentRestartHint}
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Update channel"
        description="Stable ships tested releases. Development tracks pre-release builds."
        changed={u.channel !== s0.channel}
        control={
          <Select
            value={u.channel}
            options={CHANNEL_OPTIONS}
            onChange={(channel) => setU({ channel })}
          />
        }
      />
      <Row
        label="Automatically check for updates"
        description="Check in the background about once an hour."
        changed={u.autoCheck !== s0.autoCheck}
        control={<Toggle checked={u.autoCheck} onChange={(v) => setU({ autoCheck: v })} />}
      />
      <Row
        label="Status"
        description={updateState?.currentVersion ? `Current version ${updateState.currentVersion}` : undefined}
        control={
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-cs-text-dim">{statusText}</span>
            <button
              type="button"
              disabled={!client}
              onClick={onCheck}
              className="flex items-center gap-1 rounded border border-cs-border bg-cs-bg-2 px-2 py-1 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" />
              Check for Updates
            </button>
          </div>
        }
      />
    </SettingsSection>
  );
}
```

- [ ] **Step 4: Register the section**

In `src/renderer/panels/settings/app/index.ts` add:

```ts
export { UpdatesSection } from './Updates';
```

In `src/renderer/panels/settings/SettingsPanel.tsx`:
- Add `UpdatesSection` to the existing import from `./app`.
- In `TAB_SECTIONS.app`, append:

```ts
    { id: 'app-updates', title: 'Updates', tab: 'app' },
```

- In `AppTab(...)`'s returned fragment, append `<UpdatesSection client={client} />` as the last section.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/settings-updates.test.tsx`
Expected: PASS. Then `pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/settings/app/Updates.tsx src/renderer/panels/settings/app/index.ts src/renderer/panels/settings/SettingsPanel.tsx tests/component/settings-updates.test.tsx
git commit -m "feat(updates): add Updates settings section"
```

---

### Task 11: ConnectionFooter update-pending indicator + Popover

**Files:**
- Modify: `src/renderer/shell/leftnav/ConnectionFooter.tsx`
- Test: `tests/component/connection-footer-update.test.tsx`

**Interfaces:**
- Consumes: `useStore` `updateState`; `api.installUpdate`; shadcn `Popover`/`PopoverTrigger`/`PopoverContent` from `../../components/ui/popover`; `UpdateState`.
- Produces: an indicator rendered only when `updateState.status` is `'available'` or `'downloaded'`, opening a Popover with version details and an action button.

- [ ] **Step 1: Write the failing test**

Create `tests/component/connection-footer-update.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: { installUpdate: vi.fn(async () => ({ ok: true })), connect: vi.fn() },
}));

import { SidebarProvider } from '../../src/renderer/components/ui/sidebar';
import { useStore } from '../../src/renderer/lib/store';
import { ConnectionFooter } from '../../src/renderer/shell/leftnav/ConnectionFooter';
import type { UpdateState } from '../../src/shared/types';

function renderFooter() {
  return render(
    <SidebarProvider>
      <ConnectionFooter
        client={{ baseUrl: 'http://x', apiKey: 'k' }}
        state="connected"
        sync={{ phase: 'idle', channels: { done: 0, total: 0 }, contacts: { done: 0, total: 0 } }}
        onClick={() => {}}
        active={false}
      />
    </SidebarProvider>,
  );
}

afterEach(() => useStore.getState().applyUpdateState(null));

describe('ConnectionFooter update indicator', () => {
  it('is hidden when no update is pending', () => {
    renderFooter();
    expect(screen.queryByTestId('update-indicator')).toBeNull();
  });

  it('shows the indicator when an update is downloaded', () => {
    const s: UpdateState = { status: 'downloaded', mode: 'silent', channel: 'stable', currentVersion: '0.0.10', latestVersion: '0.0.11' };
    useStore.getState().applyUpdateState(s);
    renderFooter();
    expect(screen.getByTestId('update-indicator')).toBeTruthy();
  });
});
```

> If `SidebarProvider` is not the exact export name, use the provider the other
> leftnav component tests wrap with. Keep the two assertions identical.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/connection-footer-update.test.tsx`
Expected: FAIL — no element with testid `update-indicator`.

- [ ] **Step 3: Implement the indicator**

In `src/renderer/shell/leftnav/ConnectionFooter.tsx`:
- Add imports:

```tsx
import { ArrowUpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
```

(Note: `Bluetooth`, `RotateCw` are already imported; merge the lucide import.)

- Inside the component body (after the existing hooks), add:

```tsx
  const updateState = useStore((s) => s.updateState);
  const updatePending =
    updateState && (updateState.status === 'available' || updateState.status === 'downloaded');
  const onInstall = () => {
    if (!client || !updateState) return;
    void api.installUpdate(client).catch(() => {});
  };
```

- Render the indicator inside the `<SidebarMenuItem>`, after the existing `canReconnect` button block:

```tsx
        {updatePending && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="update-indicator"
                title="Update available"
                aria-label="Update available"
                className="absolute right-8 top-1/2 flex aspect-square size-7 -translate-y-1/2 items-center justify-center rounded-md text-cs-online transition-colors hover:bg-cs-bg-3"
              >
                <ArrowUpCircle aria-hidden="true" className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-2 text-[12px]">
              <div className="font-medium text-cs-text">
                {updateState?.status === 'downloaded' ? 'Update ready' : 'Update available'}
              </div>
              <div className="text-cs-text-dim">
                {updateState?.currentVersion}
                {updateState?.latestVersion ? ` → ${updateState.latestVersion}` : ''}
                {` (${updateState?.channel})`}
              </div>
              <button
                type="button"
                onClick={onInstall}
                className="flex w-full items-center justify-center gap-1 rounded border border-cs-border bg-cs-bg-2 px-2 py-1 text-cs-text hover:bg-cs-bg-3"
              >
                {updateState?.mode === 'silent' ? 'Restart & install' : 'Open download'}
              </button>
            </PopoverContent>
          </Popover>
        )}
```

> The indicator sits at `right-8` so it does not overlap the reconnect button
> (`right-1`). If both can show at once and crowd, that is acceptable for v1.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/connection-footer-update.test.tsx`
Expected: PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/leftnav/ConnectionFooter.tsx tests/component/connection-footer-update.test.tsx
git commit -m "feat(updates): add update-pending indicator with Popover in ConnectionFooter"
```

---

### Task 12: Menu, About, and command-palette surfaces

**Files:**
- Modify: `src/main/menu.ts` (Help submenu + macOS app menu)
- Modify: `src/main/about.ts` (About dialog button)
- Modify: `src/renderer/features/command-palette/items/actions.ts` (palette action)
- Test: `tests/unit/renderer/features/command-palette/updates-action.test.ts`

**Interfaces:**
- Consumes: `updatesController()` (main); `api.checkForUpdates` (renderer palette).
- Produces: a Help-menu "Check for Updates…" item; an About-dialog "Check for Updates" button; a palette action `action:checkForUpdates`.

- [ ] **Step 1: Write the failing test (palette action)**

Create `tests/unit/renderer/features/command-palette/updates-action.test.ts`. First inspect the exact export/signature of the action builder in `src/renderer/features/command-palette/items/actions.ts` (it is the function that returns the action `PaletteItem[]`, e.g. `buildActionItems({ client, lastDevice, close })`). Then:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/api', () => ({
  api: { checkForUpdates: vi.fn(async () => ({ ok: true, updateState: null })) },
}));

import { api } from '../../../../../src/renderer/lib/api';
// Adjust the import + call to match the real builder export and its argument shape:
import { buildActionItems } from '../../../../../src/renderer/features/command-palette/items/actions';

describe('command palette: check for updates', () => {
  it('exposes an action that calls api.checkForUpdates', () => {
    const client = { baseUrl: 'http://x', apiKey: 'k' };
    const items = buildActionItems({ client, close: () => {} } as never);
    const action = items.find((i) => i.id === 'action:checkForUpdates');
    expect(action).toBeTruthy();
    action?.run();
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/features/command-palette/updates-action.test.ts`
Expected: FAIL — no `action:checkForUpdates` item.

- [ ] **Step 3: Add the palette action**

In `src/renderer/features/command-palette/items/actions.ts`:
- Add `ArrowUpCircle` to the existing `lucide-react` import.
- Before the final `return list;`, push:

```ts
  list.push({
    id: 'action:checkForUpdates',
    label: 'Check for updates',
    hint: 'App',
    group: 'action',
    groupLabel: 'Actions',
    icon: ArrowUpCircle,
    keywords: 'update upgrade version check',
    run: () => {
      if (!client) return;
      void api.checkForUpdates(client).then(
        (r) => {
          if (r.updateState?.status === 'available') notify.success(`Update available: ${r.updateState.latestVersion}`);
          else if (r.updateState?.status === 'up-to-date') notify.info('You are up to date');
        },
        (err) => notify.error(`Update check failed: ${(err as Error).message}`, err),
      );
      close();
    },
  });
```

(`client`, `api`, `notify`, `close` are already in scope in this builder — confirm against the existing actions.)

- [ ] **Step 4: Add the menu item (main)**

In `src/main/menu.ts`:
- Add the import: `import { updatesController } from './updates/controller';`
- In the `role: 'help'` submenu, add before the About entries:

```ts
      {
        label: 'Check for Updates…',
        click: () => {
          void updatesController().check();
        },
      },
      { type: 'separator' },
```

- In the macOS app-menu submenu (the `if (isMac)` block), add after `{ role: 'about' }`:

```ts
        {
          label: 'Check for Updates…',
          click: () => {
            void updatesController().check();
          },
        },
```

- [ ] **Step 5: Add the About dialog button (main)**

In `src/main/about.ts`, in `showAboutDialog`, change the `buttons`/`defaultId` and handle the response:

```ts
  const opts = {
    type: 'info' as const,
    title: `About ${app.name}`,
    message: app.name,
    detail,
    buttons: ['OK', 'Check for Updates'],
    defaultId: 0,
    cancelId: 0,
  };
  const handle = (result: { response: number }) => {
    if (result.response === 1) void updatesController().check();
  };
  if (parent) {
    void dialog.showMessageBox(parent, opts).then(handle);
  } else {
    void dialog.showMessageBox(opts).then(handle);
  }
```

Add the import at the top: `import { updatesController } from './updates/controller';`

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/features/command-palette/updates-action.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/menu.ts src/main/about.ts src/renderer/features/command-palette/items/actions.ts tests/unit/renderer/features/command-palette/updates-action.test.ts
git commit -m "feat(updates): add menu, About, and command-palette check-for-updates surfaces"
```

---

### Task 13: CI — publish prereleases

**Files:**
- Modify: `.github/workflows/ci.yml` (the `release` job's `softprops/action-gh-release@v3` step)

**Interfaces:**
- Consumes: existing tag→build→release pipeline.
- Produces: prerelease tags (containing `-`) publish a non-draft GitHub *prerelease*; stable tags keep the current draft-then-manual-publish flow.

- [ ] **Step 1: Edit the release step**

In `.github/workflows/ci.yml`, change the `Create draft release` step's `with:` block from:

```yaml
        with:
          draft: true
          generate_release_notes: true
          files: dist-artifacts/coresense-*/**/*
          fail_on_unmatched_files: true
```

to:

```yaml
        with:
          # Stable tags (no "-") stay a draft for manual publish, as today.
          # Prerelease tags (e.g. v0.1.0-beta.1) auto-publish as a GitHub
          # prerelease so the in-app notify path (unauthenticated API, which
          # cannot see drafts) can find them.
          draft: ${{ !contains(github.ref_name, '-') }}
          prerelease: ${{ contains(github.ref_name, '-') }}
          generate_release_notes: true
          files: dist-artifacts/coresense-*/**/*
          fail_on_unmatched_files: true
```

(Optionally rename the step label from `Create draft release` to `Create release`.)

- [ ] **Step 2: Validate the workflow**

Run: `pnpm dlx @action-validator/cli .github/workflows/ci.yml` (or `actionlint .github/workflows/ci.yml` if available).
Expected: exit 0, no syntax errors. (Sandbox may need to be disabled for the network fetch of the validator.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(updates): publish prerelease tags as GitHub prereleases for the dev channel"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:

- §2 (keep existing silent path) → Task 4 keeps `update-electron-app`.
- §4/§5 behavior matrix → `computeMode` (Task 5), silent (Task 4) + notify (Task 3).
- §6 data model → Task 1.
- §7 controller / silent / notify / autoCheck semantics / lazy-start / quitAndInstall → Tasks 3–6, with the silent restart hint surfaced in Task 10.
- §8 transport (WS broadcast + snapshot, `/api/updates/*`) → Tasks 6–9.
- §9 UI surfaces (Settings, ConnectionFooter+Popover, menu, About, palette) → Tasks 10–12. *Refinement:* the spec's automatic notify toast is replaced by (a) the persistent indicator for background detection and (b) toast feedback on manual checks — to avoid re-toasting on every repeated `updateState` broadcast/snapshot. Persistent signal preserved; this is intentional and noted here for the reviewer.
- §10 CI prerelease publishing → Task 13.
- §11 deps (`semver`, keep `update-electron-app`) → Task 2 + Task 4.
- §12 testing → unit/integration/dom tests across all tasks.
- §13 out-of-scope (no dev silent install, no Linux silent install, no downgrade, next-launch limitation, release-page download) → encoded in `computeMode`/notify and the Task 10 hint.

**2. Placeholder scan** — no TBD/TODO; every code step shows real code. Two
tasks carry explicit *adaptation notes* (Task 10 select interaction, Task 11
sidebar provider, Task 12 palette builder signature) where the exact
local API must be matched — these name the precise thing to confirm and keep the
assertions fixed, rather than leaving logic unwritten.

**3. Type consistency** — `UpdateState`/`UpdateChannel`/`UpdateStatus` defined
once (Task 1) and reused verbatim. `checkNotify(channel, current, deps)`,
`createSilentUpdater(deps)`, `createUpdateController(deps)`, `updatesController()`
signatures match across producer and consumer tasks. `latestVersion`/`releaseUrl`
field names are consistent in notify, controller, routes, store, Settings, and
footer. `applyUpdateState`, `api.checkForUpdates`, `api.installUpdate` names match
across store/ws/api/UI.

## Execution Handoff

You already chose **Subagent-Driven Development** at the start of this session,
so on your approval I'll proceed with superpowers:subagent-driven-development —
a fresh implementer per task with a spec+quality review between each, then a
whole-branch review at the end.
