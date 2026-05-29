# Testing Infrastructure — Design

**Date:** 2026-05-29
**Status:** Approved (design); Phase 1 to be planned next

## Goal

Establish an automated test suite for CoreSense (Electron + React MeshCore client) that:

1. **Locks down protocol correctness** — the MeshCore decode/encode/session logic is the riskiest, hardest-to-debug code.
2. **Gives confidence to refactor** — a safety net for the ongoing DRY/reorg work.
3. **Catches regressions before release** — a CI gate per checkpoint.
4. **Proves end-to-end UI confidence** — the real Electron app launches and core flows work.

## Tooling

- **Vitest** with the `projects` (workspace) feature — one root `vitest.config.ts` defining two projects: `unit` and `integration`, both Node-env.
- **Playwright** (`@playwright/test`) using `_electron.launch()` for E2E — its own `playwright.config.ts`, outside the Vitest world.
- **`@vitest/coverage-v8`** for coverage reports — generated for visibility, **not** enforced by a threshold gate.
- An **electron stub module** aliased only in the `integration` project (`app.getPath` → temp dir), for code that still imports `electron`.

The unit/integration split exists because the two need different environments: `unit` is pure Node with zero Electron; `integration` needs mocked Electron + a temp SQLite database.

## Directory Layout

Tests live in a separate `tests/` tree mirroring `src/`:

```
tests/
  unit/
    main/protocol/        decode, encode (round-trip), codes, paths
    main/bridge/          framing (pure FrameDecoder / encodeFrame)
    renderer/lib/         airtime, battery, time, sortByPinned, meshcoreUri, …
  integration/
    main/                 bus→session→state→storage pipelines, Hono API routes
  e2e/
    *.spec.ts             Playwright-Electron flows
  fixtures/
    frames/               captured raw byte vectors (.bin/.json + provenance README)
    db/                   seed/expected SQLite states if needed
  support/
    electron-mock.ts      stub for `electron` (app.getPath → temp dir)
    fake-transport.ts     ITransport that replays fixture frames onto the event bus
    sqlite-temp.ts        per-test temp DB helper
```

## Architecture & Seams

The app is **event-bus driven**: transports (`ble`, `serial`) call `emit.packet(...)` onto a central bus (`src/main/events/bus.ts`); the protocol session (`src/main/protocol/session.ts`) subscribes and drives state (`src/main/state/holder.ts`), storage (`src/main/storage/`), and the Hono API (`src/main/api/`). This gives three clean test seams:

- **Unit** — pure functions with zero Electron dependency: `protocol/decode` (`parseXxx`), `protocol/encode` (`buildXxx`), `protocol/codes`, `protocol/paths`, `bridge/framing`, and DOM-free renderer `lib/` utilities.
- **Integration** — inject a **fake `ITransport`** via `transportManager.setTransport()` that replays captured fixture frames onto the bus; drive the pipeline and assert on emitted bus events, temp-DB rows, and Hono responses (via in-process `fetch`). Electron is mocked; SQLite uses a per-test temp directory.
- **E2E** — launch the real packaged app with Playwright. A `CORESENSE_FAKE_TRANSPORT=<fixture>` environment variable makes the app install the replay transport at startup instead of opening a real radio, so flows are deterministic and need no hardware.

### Hardware strategy

No physical radio is ever required by automation. All transport input comes from **captured fixture frames replayed through a fake `ITransport`**. The native hardware paths (`noble`/serial) are intentionally left to manual verification — automation covers everything downstream of received bytes.

### Fixtures

Protocol fixtures are **real captured frames**, not hand-built: mined from the existing `coresense.log` and from a live device session captured before Phase 1 test-writing. Each fixture in `tests/fixtures/frames/` is named and accompanied by a README noting its source, device firmware, and what the frame represents. Hand-constructed bytes are used only for malformed/truncated edge cases.

## Phase Map

Each phase gets its own implementation-plan cycle after this shared design doc.

### Phase 1 — Harness + pure unit tests *(build first)*

1. **Harness:** add `vitest` + `@vitest/coverage-v8`; write `vitest.config.ts` with the `unit` project (Node env, `tests/unit/**`, `@/` alias matching `tsconfig.json`); add scripts `test`, `test:unit`, `test:watch`, `test:coverage`.
2. **Fixture capture:** mine `coresense.log` for raw frame hex and run one live device session; save to `tests/fixtures/frames/` with a provenance README.
3. **Unit targets** (characterize existing behavior against fixtures):
   - `protocol/decode` — all 17 `parseXxx` functions (channel info, channel msg v1+v3, status response, telemetry response, contact, contacts start/end, contact msg v1+v3, sent-ack, send-confirmed, batt+storage, device info, self info, custom vars, auto-add config), including malformed/truncated → `null` cases.
   - `protocol/encode` — all ~30 `buildXxx` byte-layout assertions; round-trip the symmetric pairs (`autoAddFlagsToByte`↔`autoAddByteToFlags`, `pathHashSizeToMode`↔`pathHashModeToSize`); `deriveChannelSecret` determinism.
   - `bridge/framing` — `FrameDecoder` partial/chunked/multi-frame reassembly + oversize guard; `encodeFrame`/decode round-trip.
   - `protocol/paths` — `channelHashOf`, `buildPath`.
   - `renderer/lib` DOM-free utils — `airtime`, `battery`, `time`, `sortByPinned`, `meshcoreUri`, `messageContent`, `contactColor`, `randomSecret`, `decodePacket`.
4. **Outcome:** `pnpm test:unit` green + a coverage baseline. Highest-risk byte-level logic locked before any Phase 2 refactoring.

**Open judgment call (resolved during implementation, not guessed now):** renderer `lib/` utils run in the Node env only if DOM-free. Any util touching `window`/DOM moves to a jsdom-configured slice or is deferred — decided per-file when writing its test.

### Phase 2 — Integration + decoupling refactors

1. Add the `integration` Vitest project + `electron-mock`, `sqlite-temp`, and `fake-transport` support helpers.
2. Refactor `storage/db.ts` (and similar Electron-coupled modules) to **inject the data path/dependency** instead of calling `app.getPath` internally — characterization tests first, then refactor green.
3. Pipeline tests: fake transport → bus → `session` → `state/holder` → `storage` → emitted events; Hono `api/routes` exercised via in-process `fetch`.

### Phase 3 — E2E + CI

1. `playwright.config.ts` + a handful of smoke / critical-path specs using the `CORESENSE_FAKE_TRANSPORT` env hook.
2. **GitHub Actions** workflow: `typecheck` + `lint` + `unit` + `integration` on push/PR; a separate E2E job (macOS runner, or Linux with xvfb); upload the coverage report as an artifact. **No threshold gate.**

## Decisions (locked)

| Area | Decision |
|------|----------|
| Goals | All four: protocol correctness, refactor confidence, regression gating, E2E UI |
| Protocol fixtures | Capture real frames now + mine `coresense.log` |
| Hardware seam | Fake `ITransport` replaying captures onto the bus; no radio in automation |
| Electron coupling | Refactor modules to inject paths/deps (not mock-everywhere) |
| Scope | Phase it; this doc covers all phases; build Phase 1 first |
| Test layout | Separate `tests/` tree mirroring `src/` |
| Coverage | Track, don't enforce |
| CI | GitHub Actions |
| Vitest structure | `projects` workspace: `unit` + `integration`; Playwright separate |
| Package manager | pnpm (only) |

## Out of Scope

- Testing native BLE/serial hardware paths (`noble`, serialport bindings) via automation.
- Coverage threshold enforcement.
- Performance/load testing.
- Visual regression / screenshot diffing (Playwright is used for functional E2E only).
