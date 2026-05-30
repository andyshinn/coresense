# Testing Phase 3 — E2E + CI — Design

**Date:** 2026-05-30
**Status:** Approved (design); plan next
**Parent:** [2026-05-29-testing-infrastructure-design.md](2026-05-29-testing-infrastructure-design.md) (Phase 3 section)

## Goal

Close out the testing infrastructure with the two pieces the umbrella design deferred to Phase 3:

1. **Playwright-Electron E2E** — launch the real built app (no dev server, no hardware) and exercise a handful of critical-path UI flows, made deterministic by replaying captured frames through a fake transport.
2. **GitHub Actions CI** — run typecheck + lint + unit + integration on every push/PR, plus a separate E2E job, and publish the coverage report as an artifact. No threshold gate.

This builds directly on Phase 1 (unit) and Phase 2 (integration), reusing the existing fixtures, seams (`userData`, `appLifecycle`, `secretStore`, `appInfo`), and `tests/` layout.

## Decisions (locked via brainstorming)

| Area | Decision |
|------|----------|
| Launch target | Unpacked Vite build (launch `.vite/build/index.js` via the dev Electron binary; `app.isPackaged === false`) |
| Replay hook | Env-gated `FileReplayTransport` shipped in `src/main/transport`, selected only when `CORESENSE_FAKE_TRANSPORT` is set; inert otherwise |
| E2E flows | All four: launches & renders; connect replay populates UI; send a channel message; pane navigation / pin |
| CI E2E OS | Ubuntu + xvfb (transport is faked, so no Bluetooth stack required) |
| CI triggers | `push` + `pull_request` (all branches; no merge to main required) |
| Coverage | Track, don't enforce — uploaded as a `checks`-job artifact |

## Architecture

### Why a replay transport in `src/main`

Phases 1–2 inject test doubles **in-process** (Vitest sets the seams directly). E2E launches a separate Electron process, so the double must live **inside the shipped main bundle** and be reachable purely through environment variables. The replay transport is the E2E analogue of `tests/support/fake-transport.ts`, but production-resident and env-gated.

### Transport selection at startup

Today [src/main/index.ts:114](../../../src/main/index.ts#L114) unconditionally runs:

```ts
transportManager.setTransport(new BleTransport());
```

`BleTransport`'s module statically imports `@stoprocent/noble` (a native dep), so this line forces the native Bluetooth binding to load at boot. Phase 3 replaces it with a guarded, **dynamic-import** selection so the chosen path is the only native code that loads:

```ts
if (process.env.CORESENSE_FAKE_TRANSPORT) {
  const { FileReplayTransport } = await import('./transport/replay');
  transportManager.setTransport(new FileReplayTransport(process.env.CORESENSE_FAKE_TRANSPORT));
} else {
  const { BleTransport } = await import('./transport/ble');
  transportManager.setTransport(new BleTransport());
}
```

Behavior-preserving for production (BLE still the default; one extra `await` at boot) and means the Ubuntu E2E runner never loads `noble`.

### `FileReplayTransport`

New `src/main/transport/replay.ts` implementing the existing `ITransport` interface (`src/main/transport/types.ts`):

- **Constructor** takes a fixture path (the value of `CORESENSE_FAKE_TRANSPORT`).
- **On connect/start**, reads the fixture JSON — an array of companion frames in the **same shape as `tests/fixtures/frames/connect-session.json`** — and emits each onto the event bus via `emit.packet(...)`, exactly as a real transport would after receiving bytes. Frames are emitted in order, immediately on connect (no artificial timing).
- **`sendBytes()`** is a recording no-op (outbound byte correctness is already covered by the Phase 2 integration tests; E2E asserts UI behavior, not wire bytes).
- Imports no `electron`; constructs `RawPacket`s directly (it cannot import from `tests/`).

### Build & launch

- **Build:** `pnpm package` (electron-forge **package**). This runs the Forge-managed Vite build — which injects the `MAIN_WINDOW_VITE_NAME` / `MAIN_WINDOW_VITE_DEV_SERVER_URL` constants a bare `vite build` would leave undefined — and produces an unpacked app **without** running any maker/installer (DMG/squirrel/zip are `make`, not `package`). Side effect: `.vite/build/index.js` and `.vite/renderer/main_window/` are populated at the repo root.
- **Launch:** Playwright `_electron.launch({ args: [<.vite/build/index.js>], executablePath: <node_modules electron>, env })`. Launching the entry script via the dev Electron binary keeps `app.isPackaged === false`. `electronApp.firstWindow()` returns the page the specs drive. (If the root `.vite/build` entry proves unavailable in a given Forge version, fall back to launching the unpacked binary under `out/` — resolved at implementation time.)
- **Renderer loading:** in prod mode the app serves the renderer from `.vite/renderer/main_window` over its in-process Hono server (`http://127.0.0.1:<port>`); the window loads that URL. No Vite dev server is involved.

### Per-run isolation (reuses existing seams)

The launch env sets:

- `CORESENSE_USER_DATA=<fresh temp dir>` — the `userData` seam already reads this (`src/main/runtime/userData.ts`), so every run gets clean storage/settings/logs.
- `CORESENSE_FAKE_TRANSPORT=<fixture path>` — selects the replay transport.

No real radio, no shared state between runs, no installer overhead.

## E2E layout

```
tests/
  e2e/
    support/
      launch.ts        boot helper: temp userData + fixture env, returns { app, page }; teardown
    launches.spec.ts          flow 1
    connect-replay.spec.ts    flow 2
    send-message.spec.ts      flow 3
    navigation.spec.ts        flow 4
playwright.config.ts          testDir: tests/e2e; outside the Vitest projects
```

### `tests/e2e/support/launch.ts`

A helper that: creates a temp userData dir; optionally seeds settings files into it (see "seeding" below); resolves the Electron binary and the built main entry; calls `_electron.launch(...)` with the env vars; waits for `firstWindow()`; and returns `{ app, page, userDataDir }` plus a teardown that closes the app and removes the temp dir.

### The four specs

1. **`launches.spec.ts`** — app launches, the main window appears, the main pane renders, no boot crash / no renderer error overlay.
2. **`connect-replay.spec.ts`** — launch with the `connect-session.json` fixture; assert the replayed device info / channels / contacts surface in the UI.
3. **`send-message.spec.ts`** — with a channel present (seeded, see below), type a message into the composer, send it, and assert it appears in the conversation view.
4. **`navigation.spec.ts`** — switch panes via the left nav and exercise pin-to-top; assert the active pane / pinned state updates.

### Two implementation realities (baked into the plan)

- **Stable selectors:** the specs need a small number of `data-testid` attributes on the elements they touch (composer input, send button, message list item, left-nav items, pane container). These are minimal, additive, and production-safe.
- **Seeding a channel for flow 3:** "send a channel message" requires a channel to exist. The launch helper pre-writes a `channels.json` into the temp userData dir before launch (reusing the real settings file format from `src/main/storage/settings.ts`), keeping the replay fixture focused on the connect session. Other flows may seed additional settings the same way as needed.

## CI design

New `.github/workflows/ci.yml`.

**Triggers:** `push` and `pull_request` (all branches).

**Common setup (both jobs):** checkout → `pnpm/action-setup` → `actions/setup-node` pinned to **Node 24.15.0** (matches the Node version bundled in the stable Electron the app ships on) with pnpm cache → `pnpm install`. System packages required to build native deps / run headless Electron are installed via `apt-get` before install where needed.

**Job `checks` (ubuntu-latest):**
1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test:unit`
4. `pnpm test:integration`
5. `pnpm test:coverage`
6. Upload `coverage/` as an artifact. **No threshold gate.**

**Job `e2e` (ubuntu-latest):**
1. Install headless-Electron system libs (xvfb + the GTK/NSS/X libraries Electron needs; via `npx playwright install-deps` and/or explicit `apt-get`).
2. `pnpm package` (produces the launchable build).
3. `xvfb-run --auto-servernum pnpm test:e2e`.
4. On failure, upload the Playwright HTML report / traces as an artifact.

The two jobs run independently; `e2e` does not gate `checks` (or vice versa).

## New / changed files

- **New:** `src/main/transport/replay.ts`, `playwright.config.ts`, `tests/e2e/support/launch.ts`, `tests/e2e/*.spec.ts` (×4), `.github/workflows/ci.yml`.
- **Modified:** `src/main/index.ts` (guarded dynamic transport selection at the line that currently constructs `BleTransport`); `package.json` (add `@playwright/test` dev dep + `test:e2e` script); a few renderer components (additive `data-testid` attributes only).

## Out of scope (unchanged from umbrella design)

- Testing native BLE/serial hardware paths via automation.
- Coverage threshold enforcement.
- Performance / load testing.
- Visual-regression / screenshot diffing (Playwright is functional E2E only).
