# Testing Phase 2 — Integration + Decoupling Refactors — Design

**Date:** 2026-05-29
**Status:** Approved (design); plan to be written next
**Parent:** [Testing Infrastructure design](2026-05-29-testing-infrastructure-design.md) — this is Phase 2 of that umbrella spec.

## Goal

Add an `integration` test layer that exercises the main-process pipelines end-to-end in plain Node — storage, the inbound packet path (transport → bus → session → state → storage), the outbound send path, and the Hono API — without a real radio or Electron runtime. Getting there requires small **decoupling refactors** that move Electron's `app`/`safeStorage` access behind injectable seams, which also serves the "confidence to refactor" goal.

## Decisions (locked)

| Area | Decision |
|------|----------|
| DI seam for `userData` paths | Central path module, lazy Electron fallback |
| Genuine Electron behaviors (lifecycle) | Refactor behind an injectable `appLifecycle` seam |
| `safeStorage` (map API key) | Inject a `secretStore` seam |
| Pipelines covered | Storage round-trip, inbound packet, outbound send, Hono API routes (all four) |
| Vitest structure | Add `integration` project alongside `unit` (Approach A) |
| Coverage | Tracked, not enforced (unchanged) |
| Hardware | None — inbound via `RawPacket` on the bus, outbound via a fake `ITransport` |

## Architecture & Seams

The main process is event-bus driven. The session subscribes with `bus.on('packet', onPacket)` and only handles `p.kind === 'companion'` packets (reading `p.code` + `p.bytes`). Transports emit those packets; the session sends via `transportManager.getTransport()?.sendBytes()`. This gives clean, hardware-free seams:

- **Inbound:** emit a `kind: 'companion'` `RawPacket` onto the bus — the session handles it exactly as in production. No `ITransport` needed.
- **Outbound:** register a fake `ITransport` via `transportManager.setTransport()` whose `sendBytes` captures the emitted bytes.

### Decoupling refactors (production code)

Three small "platform seam" modules under a new `src/main/runtime/`. Each exposes a getter that returns an injected implementation if set, otherwise **lazily** binds to Electron via `createRequire(import.meta.url)('electron')` — called only when no override is set, so the integration test graph never imports Electron.

1. **`runtime/userData.ts`** — `userDataDir(): string`, `setUserDataDir(dir | null)`. Resolution order: injected dir → `process.env.CORESENSE_USER_DATA` → lazy `app.getPath('userData')`. Call sites updated (drop their `import { app } from 'electron'` where `userData` was the only use):
   - `storage/db.ts`, `storage/settings.ts`, `api/middleware/auth.ts`, `map/api-key.ts`, `logging/fileSink.ts`.
   - `storage/paths.ts` keeps its production dev-redirect side-effect (it's imported only by `index.ts`, never by the test graph).

2. **`runtime/appLifecycle.ts`** — `appLifecycle(): { quit(); relaunch(); exit(code?) }`, `setAppLifecycle(impl)`. `api/routes.ts` calls `appLifecycle().quit()` / `.relaunch()` / `.exit()` instead of importing `app`.

3. **`runtime/secretStore.ts`** — `secretStore(): { available(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }`, `setSecretStore(impl)`. `map/api-key.ts` uses it instead of Electron `safeStorage`.

**Refactor discipline:** characterization-first. Before changing a module, pin its current behavior with a test, then apply the seam keeping it green. No behavior change — only the seam. Net change: 3 new ~20-line modules + ~7 one-line call-site swaps.

After this, `storage/{db,messages,settings,search}`, `protocol/session`, `state/holder`, and `api/routes` all run in plain Node with the seams injected — zero Electron import in the integration graph.

## Test Harness

Add an `integration` project to `vitest.config.ts`:
- `name: 'integration'`, `environment: 'node'`, `include: ['tests/integration/**/*.test.ts']`, `setupFiles: ['tests/integration/setup.ts']`.
- Script: `test:integration` = `vitest run --project integration`. `test` continues to run all projects.

**`tests/integration/setup.ts`** (per-file, via `beforeEach`/`afterEach`): inject `setUserDataDir(<fresh temp dir>)`, `setAppLifecycle(spy)`, `setSecretStore(in-memory plaintext)`; reset the bus listeners, `transportManager`, and the DB singleton between tests so nothing leaks. Order-independent and parallel-safe.

**Support helpers** (`tests/support/`):
- **`sqlite-temp.ts`** — make a unique temp `userData` dir under the OS temp dir; return `{ dir, cleanup }`; expose `resetDb()` that closes and clears the memoized `db` singleton so each test opens a fresh database.
- **`fake-transport.ts`** —
  - `companionPacket(frame: Buffer | string): RawPacket` builds a `kind: 'companion'` packet (`code = bytes[0]`, `bytes`, `hex`, `payloadHex`/`payloadBytes` = bytes after the code), ready for `emit.packet(...)`.
  - `FakeTransport implements ITransport` — captures `sendBytes` into `sent: Buffer[]`; registered via `transportManager.setTransport()`.
- **`seams.ts`** — the spy `AppLifecycle` (records `quit`/`relaunch`/`exit` calls) and in-memory `SecretStore` (identity/base64, no real crypto), reused by `setup.ts` and assertable in routes tests.

## The Four Pipeline Suites

All under `tests/integration/`:

1. **`storage/round-trip.test.ts`** — `messagesStore` + `search` on a fresh temp DB: insert → `byKey`/`recent`/`findById`; idempotent upsert on `mid`; `markState` transitions; `trimPerKey` bounding; FTS `searchMessages` returns a hit with the `<mark>` snippet; sentinel-stripping in `sanitizeBody`.

2. **`inbound/packet-pipeline.test.ts`** — emit `companionPacket(...)` for representative frames and assert BOTH emitted bus events (captured via `bus.on`) AND DB rows:
   - channel-message frame → `emit.messages` for the channel key + a `messages` row;
   - contact/advert frame → `emit.contacts` + contact present in state;
   - `RESP_SENT` / `PUSH_SEND_CONFIRMED` → `emit.messageState` transitions.

3. **`outbound/send-pipeline.test.ts`** — `transportManager.setTransport(fake)`, invoke the session send path (e.g. send channel text), assert the exact bytes in `fake.sent` (cross-checked against Phase 1 `encode` builders) and a pending `sending` row; then feed a matching `RESP_SENT`/confirm frame and assert the state moves to `sent`/`ack`.

4. **`api/routes.test.ts`** — build the Hono app and drive it with in-process `app.fetch(new Request(...))` (no socket) against a temp DB + seeded state:
   - read endpoints (state snapshot, messages/search) assert response JSON;
   - the restart endpoint asserts the injected `appLifecycle` spy's `quit`/`relaunch` were called (no real quit);
   - an api-key set/get endpoint round-trips through the in-memory `secretStore`.

## Fixtures

Phase 1's `tests/fixtures/frames/connect-session.json` already has `deviceInfo`/`selfInfo`. For inbound/outbound, mine `coresense.log` for a real `RESP_CHANNEL_MSG_RECV_V3`, a contact-message, and a `RESP_SENT` frame where present; hand-build from the documented byte layout (same approach as the Phase 1 decode tests) where the log lacks one. New fixtures are added with provenance notes.

## Out of Scope

- Native transport paths (BLE/serial bindings), unchanged from Phase 1.
- Bridge/TCP/mDNS multi-client fan-out (`bridge/`), beyond what the inbound/outbound session path touches.
- E2E (Playwright) and CI — Phase 3.
- Coverage threshold enforcement.
- Refactoring Electron-only modules not in the integration graph (`menu`, `notifications`, `updater`, `window/registry`, `window/state` window APIs, `about`).

## Success Criteria

- `pnpm test:integration` green; `pnpm test` (all projects) green; `pnpm typecheck` and `pnpm lint` clean.
- The integration graph imports no Electron at test time (seams injected).
- Production behavior unchanged: the lazy-Electron fallbacks make `userDataDir()`/`appLifecycle()`/`secretStore()` behave exactly as the prior direct `app`/`safeStorage` calls did.
