# Testing Phase 3 — E2E + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright-Electron E2E tests (driven by an env-gated replay transport) and a GitHub Actions CI workflow that runs typecheck + lint + unit + integration + a separate E2E job.

**Architecture:** A new production-resident `FileReplayTransport` replays captured companion frames onto the event bus when `CORESENSE_FAKE_TRANSPORT` is set; a `installStartupTransport` selector wires it (or the real BLE transport) at boot via dynamic import so native BLE deps never load in test mode. Playwright launches the unpacked Vite build (`.vite/build/index.js`) with a temp `CORESENSE_USER_DATA` dir and the fixture env var, then drives four critical-path flows against `data-testid` anchors. CI builds with `electron-forge package` and runs E2E headless under xvfb on Ubuntu.

**Tech Stack:** Electron + electron-forge (Vite plugin), React 19, Vitest, `@playwright/test` (`_electron`), GitHub Actions, pnpm.

**Spec:** [docs/superpowers/specs/2026-05-30-testing-phase3-e2e-ci-design.md](../specs/2026-05-30-testing-phase3-e2e-ci-design.md)

---

## Context the implementer needs

- **Event bus:** `src/main/events/bus.ts` exports `bus` (a Node `EventEmitter`) and `emit` (typed helpers). A real transport, on receiving bytes, calls `emit.packet(rawPacket)`; the protocol session subscribes and drives state/storage, which broadcasts to the renderer over WebSocket. So replaying frames onto the bus exercises the full main→renderer pipeline.
- **Frame parsing:** `src/main/transport/companionFrame.ts` exports `parseCompanionFrame(frame: Buffer): ParsedFrame | null`. `BleTransport.onData` ([src/main/transport/ble.ts:330-399](../../../src/main/transport/ble.ts#L330)) shows the canonical `emit.packet({...})` shapes for `kind: 'companion'` and `kind: 'mesh'` — mirror those.
- **`ITransport`** (`src/main/transport/types.ts`): `{ type: 'ble'|'serial'; connect(deviceId); disconnect(); scan?; stopScan?; sendBytes?(bytes); shutdown? }`.
- **`RawPacket`** (`src/shared/types.ts:9-27`): `{ timestamp; transportType; kind: 'mesh'|'companion'; hex; bytes:number[]; payloadHex; payloadBytes:number[]; snr?; rssi?; code?; codeName? }`.
- **userData seam:** `src/main/runtime/userData.ts` already reads `process.env.CORESENSE_USER_DATA` — set it to a temp dir for isolated E2E runs. Settings files (`channels.json`, `contacts.json`, …) live directly in that dir (see `src/main/storage/settings.ts` `FILES`).
- **Send path:** the renderer composer's `onSend` → `POST /api/messages/:key` ([src/main/api/routes.ts:484-520](../../../src/main/api/routes.ts#L484)) inserts the message with state `'sending'` and calls `emit.messages(...)` **before** TX, so the optimistic message reaches the UI even though replay's `sendBytes` is a no-op.
- **Vitest** picks up only `tests/unit/**` and `tests/integration/**`; Playwright owns `tests/e2e/**`. No overlap (different runners, `.test.ts` vs `.spec.ts`).
- **Integration test setup** (`tests/integration/setup.ts`) runs `bus.removeAllListeners()` in `afterEach` and seeds a temp userData — reuse it for the new main-process tests.
- Local pnpm is 11.4.0; CI Node is pinned to 24.15.0.

---

## File Structure

- **Create** `src/main/transport/replay.ts` — `FileReplayTransport` (env-gated replay double).
- **Create** `src/main/transport/select.ts` — `installStartupTransport(env, manager)` selector.
- **Modify** `src/main/index.ts` — swap the static `BleTransport` install for the dynamic selector.
- **Create** `tests/integration/transport/replay.test.ts` and `tests/integration/transport/select.test.ts`.
- **Create** `tests/fixtures/frames/e2e-connect.json` — ordered replay fixture (deviceInfo + selfInfo).
- **Create** `playwright.config.ts`, `tests/e2e/support/launch.ts`, and `tests/e2e/{launches,connect-replay,send-message,navigation}.spec.ts`.
- **Modify** renderer components to add `data-testid` anchors (Task 4).
- **Modify** `package.json` — add `@playwright/test` dev dep + `test:e2e` script.
- **Create** `.github/workflows/ci.yml`.

---

### Task 1: FileReplayTransport

**Files:**
- Create: `src/main/transport/replay.ts`
- Test: `tests/integration/transport/replay.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/transport/replay.test.ts
import { Buffer } from 'node:buffer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { FileReplayTransport } from '../../../src/main/transport/replay';
import type { RawPacket } from '../../../src/shared/types';

describe('FileReplayTransport', () => {
  it('replays fixture frames onto the bus as companion packets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    // RESP_DEVICE_INFO (0x0d) then a short RESP_SELF_INFO-ish (0x05) frame.
    writeFileSync(fixture, JSON.stringify([{ hex: '0d0babcd' }, '05aa']));

    const packets: RawPacket[] = [];
    bus.on('packet', (p: RawPacket) => packets.push(p));

    await new FileReplayTransport(fixture).connect('replay');

    expect(packets).toHaveLength(2);
    expect(packets[0].kind).toBe('companion');
    expect(packets[0].code).toBe(0x0d);
    expect(packets[0].payloadHex).toBe('0babcd');
    expect(packets[1].code).toBe(0x05);
    expect(packets[1].payloadHex).toBe('aa');
  });

  it('records sendBytes without emitting packets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    writeFileSync(fixture, JSON.stringify([]));
    const t = new FileReplayTransport(fixture);
    await t.sendBytes(Buffer.from([1, 2, 3]));
    expect(t.sent).toHaveLength(1);
    expect([...t.sent[0]]).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- replay`
Expected: FAIL — cannot resolve `src/main/transport/replay` (module does not exist).

- [ ] **Step 3: Write the implementation**

```ts
// src/main/transport/replay.ts
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { emit } from '../events/bus';
import { child } from '../log';
import { parseCompanionFrame } from './companionFrame';
import type { ITransport } from './types';

const log = child('replay');

/** A frame entry in a replay fixture: either a hex string or an object with a
 *  `hex` field (extra fields like `name`/`code` are ignored). */
type FixtureFrame = string | { hex: string };

function loadFrames(path: string): Buffer[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as FixtureFrame[];
  if (!Array.isArray(parsed)) {
    throw new Error(`replay fixture ${path} must be a JSON array of frames`);
  }
  return parsed.map((f) => Buffer.from(typeof f === 'string' ? f : f.hex, 'hex'));
}

/**
 * Production-resident, env-gated transport double for E2E. Reads a fixture of
 * captured companion frames and replays them onto the event bus exactly as a
 * real transport would after receiving bytes. Selected only when
 * CORESENSE_FAKE_TRANSPORT is set (see ./select). `sendBytes` is a recording
 * no-op: outbound byte layout is covered by the integration suite, and E2E
 * asserts UI behavior rather than wire bytes.
 */
export class FileReplayTransport implements ITransport {
  readonly type = 'ble' as const;
  readonly sent: Buffer[] = [];
  private readonly fixturePath: string;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async connect(deviceId: string): Promise<void> {
    emit.transportState('connected', deviceId);
    let frames: Buffer[];
    try {
      frames = loadFrames(this.fixturePath);
    } catch (err) {
      log.error(`failed to load replay fixture: ${(err as Error).message}`);
      return;
    }
    for (const frame of frames) this.dispatch(frame);
    log.info(`replayed ${frames.length} frame(s) from ${this.fixturePath}`);
  }

  async disconnect(): Promise<void> {
    emit.transportState('idle');
  }

  async sendBytes(bytes: Buffer): Promise<void> {
    this.sent.push(Buffer.from(bytes));
  }

  /** Mirror BleTransport.onData: parse the frame and emit the matching packet.
   *  The mesh-observation side-channel (path attribution) is intentionally
   *  omitted — it does not affect the E2E flows. */
  private dispatch(frame: Buffer): void {
    const parsed = parseCompanionFrame(frame);
    if (!parsed) return;
    const hex = frame.toString('hex');
    const bytes = [...frame];
    if (parsed.kind === 'mesh') {
      emit.packet({
        timestamp: 0,
        transportType: 'ble',
        kind: 'mesh',
        hex,
        bytes,
        payloadHex: parsed.meshHex,
        payloadBytes: [...parsed.meshBytes],
        snr: parsed.snr,
        rssi: parsed.rssi,
      });
    } else {
      emit.packet({
        timestamp: 0,
        transportType: 'ble',
        kind: 'companion',
        hex,
        bytes,
        payloadHex: parsed.payloadHex,
        payloadBytes: [...parsed.payloadBytes],
        code: parsed.code,
        codeName: parsed.codeName,
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:integration -- replay`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/replay.ts tests/integration/transport/replay.test.ts
git commit -m "feat: add env-gated FileReplayTransport for E2E"
```

---

### Task 2: Startup transport selector + index.ts wiring

**Files:**
- Create: `src/main/transport/select.ts`
- Test: `tests/integration/transport/select.test.ts`
- Modify: `src/main/index.ts:52` (import) and `src/main/index.ts:114` (install)

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/transport/select.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileReplayTransport } from '../../../src/main/transport/replay';
import { installStartupTransport } from '../../../src/main/transport/select';
import type { ITransport } from '../../../src/main/transport/types';

describe('installStartupTransport', () => {
  it('installs a FileReplayTransport when CORESENSE_FAKE_TRANSPORT is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'select-test-'));
    const fixture = join(dir, 'frames.json');
    writeFileSync(fixture, JSON.stringify([]));

    let installed: ITransport | null = null;
    const manager = {
      setTransport: (t: ITransport) => {
        installed = t;
      },
    };

    const result = await installStartupTransport(
      { CORESENSE_FAKE_TRANSPORT: fixture } as NodeJS.ProcessEnv,
      manager,
    );

    expect(installed).toBeInstanceOf(FileReplayTransport);
    expect(result).toBe(installed);
  });
});
```

> Note: only the fake branch is unit-tested. The BLE branch dynamically imports `./ble`, which loads native `@stoprocent/noble`; it is exercised manually with real hardware, not in automation.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- select`
Expected: FAIL — cannot resolve `src/main/transport/select`.

- [ ] **Step 3: Write the selector**

```ts
// src/main/transport/select.ts
import type { ITransport } from './types';

interface TransportSink {
  setTransport(t: ITransport): void;
}

/**
 * Choose and install the startup transport from the environment. When
 * CORESENSE_FAKE_TRANSPORT names a replay fixture, install the env-gated
 * FileReplayTransport and kick off replay; otherwise install the real
 * BleTransport. Both modules load via dynamic import so the unused path's
 * native deps (noble for BLE) never load.
 */
export async function installStartupTransport(
  env: NodeJS.ProcessEnv,
  manager: TransportSink,
): Promise<ITransport> {
  const fixture = env.CORESENSE_FAKE_TRANSPORT;
  if (fixture) {
    const { FileReplayTransport } = await import('./replay');
    const transport = new FileReplayTransport(fixture);
    manager.setTransport(transport);
    // Kick off replay immediately — no UI "connect" step in E2E.
    void transport.connect('replay');
    return transport;
  }
  const { BleTransport } = await import('./ble');
  const transport = new BleTransport();
  manager.setTransport(transport);
  return transport;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:integration -- select`
Expected: PASS (1 test).

- [ ] **Step 5: Wire into index.ts**

In `src/main/index.ts`, remove the static BLE import on line 52:

```ts
import { BleTransport } from './transport/ble';
```

and add, alongside the other transport imports:

```ts
import { installStartupTransport } from './transport/select';
```

Then replace line 114:

```ts
  // Register the default BLE transport.
  transportManager.setTransport(new BleTransport());
```

with:

```ts
  // Select the startup transport: real BLE, or the env-gated replay transport
  // when CORESENSE_FAKE_TRANSPORT is set (E2E). Dynamic import inside keeps
  // native BLE deps from loading in test mode.
  await installStartupTransport(process.env, transportManager);
```

- [ ] **Step 6: Verify the full suite + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all exit 0; no test regressions. (Confirms removing the static `BleTransport` import didn't break boot wiring and `index.ts` still typechecks.)

- [ ] **Step 7: Commit**

```bash
git add src/main/transport/select.ts tests/integration/transport/select.test.ts src/main/index.ts
git commit -m "feat: select startup transport via env-gated dynamic import"
```

---

### Task 3: Playwright harness + launch helper + Flow 1 smoke spec

**Files:**
- Modify: `package.json` (add `@playwright/test` dev dep + `test:e2e` script)
- Create: `playwright.config.ts`
- Create: `tests/fixtures/frames/e2e-connect.json`
- Create: `tests/e2e/support/launch.ts`
- Create: `tests/e2e/launches.spec.ts`

- [ ] **Step 1: Add the Playwright dependency and script**

Run: `pnpm add -D @playwright/test`

Then add to `package.json` `scripts`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Create the Playwright config**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

// Electron apps are single-instance and share global OS state (windows, the
// local HTTP/WS server port), so run specs serially.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
});
```

- [ ] **Step 3: Create the replay fixture**

```json
// tests/fixtures/frames/e2e-connect.json
[
  { "hex": "0d0baf280000000031392041707220323032360048656c7465632054313134000000000000000000000000000000000000000000000000000000000076312e31352e30000000000000000000000000000001" },
  { "hex": "050114161a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d508fdcc0109472cfa00012a00bde40d0024f4000007056567726d652e73682048616e64" }
]
```

> These are the real `RESP_DEVICE_INFO` (0x0d → device model "Heltec T114") and `RESP_SELF_INFO` (0x05 → owner identity) frames captured in `tests/fixtures/frames/connect-session.json`.

- [ ] **Step 4: Create the launch helper**

```ts
// tests/e2e/support/launch.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { Channel, Contact } from '../../../src/shared/types';

// Playwright runs from the repo root; the built main entry is the package
// `main` field. `electron-forge package` populates `.vite/build` at the root.
const MAIN_ENTRY = join(process.cwd(), '.vite', 'build', 'index.js');
const DEFAULT_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'frames', 'e2e-connect.json');

export interface LaunchOptions {
  /** Replay fixture path; defaults to the connect-session fixture. */
  fixture?: string;
  /** Seed `channels.json` in the temp userData dir before launch. */
  channels?: Channel[];
  /** Seed `contacts.json` in the temp userData dir before launch. */
  contacts?: Contact[];
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  close: () => Promise<void>;
}

export async function launchApp(opts: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'coresense-e2e-'));
  if (opts.channels) {
    writeFileSync(join(userDataDir, 'channels.json'), JSON.stringify(opts.channels));
  }
  if (opts.contacts) {
    writeFileSync(join(userDataDir, 'contacts.json'), JSON.stringify(opts.contacts));
  }

  // Playwright resolves the locally-installed Electron binary automatically
  // when executablePath is omitted; launching the entry script (not a packaged
  // bundle) keeps app.isPackaged === false.
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      CORESENSE_USER_DATA: userDataDir,
      CORESENSE_FAKE_TRANSPORT: opts.fixture ?? DEFAULT_FIXTURE,
      CORESENSE_LOG_LEVEL: 'warn',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const close = async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  };

  return { app, page, userDataDir, close };
}
```

- [ ] **Step 5: Write the Flow 1 smoke spec**

```ts
// tests/e2e/launches.spec.ts
import { expect, test } from '@playwright/test';
import { launchApp } from './support/launch';

test('app launches and renders the main shell', async () => {
  const { page, close } = await launchApp();
  try {
    // The LeftNav carries aria-label="Primary navigation" and is always
    // present once the three-pane shell mounts.
    await expect(page.locator('[aria-label="Primary navigation"]')).toBeVisible();
  } finally {
    await close();
  }
});
```

- [ ] **Step 6: Build, then run the spec to verify it passes**

Run: `pnpm package && pnpm test:e2e -- launches`
Expected: PASS (1 test). The app boots with the replay transport, the renderer loads over the local Hono server, and the LeftNav renders.

> If launch fails resolving `.vite/build/index.js`, confirm `pnpm package` populated it; if the Forge version writes the entry elsewhere, update `MAIN_ENTRY` to the unpacked entry under `out/` (resolved per the spec's launch fallback note).

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts tests/e2e/support/launch.ts tests/e2e/launches.spec.ts tests/fixtures/frames/e2e-connect.json
git commit -m "test: add Playwright-Electron harness and launch smoke E2E"
```

---

### Task 4: Instrument renderer with E2E selectors

Add `data-testid` (and a couple of `data-*` keys) to the elements the remaining flows assert on. All edits are additive — no behavior change.

**Files:**
- Modify: `src/renderer/shell/leftnav/OwnerCard.tsx:94`
- Modify: `src/renderer/shell/leftnav/ConnectionFooter.tsx:90`
- Modify: `src/renderer/components/Composer.tsx` (textarea ~126, send button ~141)
- Modify: `src/renderer/components/MessageRow.tsx:54`
- Modify: `src/renderer/shell/leftnav/ChannelSubList.tsx` (button ~96, Star ~101)
- Modify: `src/renderer/shell/leftnav/ChannelContextMenu.tsx:36`
- Modify: `src/renderer/panels/ChannelView.tsx:100`

- [ ] **Step 1: Owner name** — on the `<span>` rendering `{owner?.name ?? 'No identity'}` (OwnerCard.tsx:94), add:

```tsx
data-testid="owner-name"
```

- [ ] **Step 2: Connection footer** — on the `<SidebarMenuButton>` at ConnectionFooter.tsx:90, add `data-testid="connection-status-footer"`. (`SidebarMenuButton` forwards unknown props to its underlying element; if a typecheck error shows it does not, wrap the button's label content in a `<span data-testid="connection-status-footer">` instead.)

- [ ] **Step 3: Composer input + send button** — on the `<textarea>` (Composer.tsx ~126) add `data-testid="message-composer-input"`; on the send `<button>` (Composer.tsx ~141, already `aria-label="Send"`) add `data-testid="message-send-button"`.

- [ ] **Step 4: Message row** — on the root `<div className="group px-3 py-0.5" ...>` (MessageRow.tsx:54), add:

```tsx
data-testid="message-row"
```

- [ ] **Step 5: Channel nav item + pin indicator** — on the channel `<button>` (ChannelSubList.tsx ~96) add `data-testid="channel-nav-item"` and `data-channel-key={ch.key}`; on the pin `<Star ... />` (ChannelSubList.tsx ~101) add `data-testid="channel-pin-indicator"`.

- [ ] **Step 6: Pin context-menu item** — for the "Pin to top"/"Unpin" menu entry (ChannelContextMenu.tsx:36), add `data-testid="pin-toggle-menu-item"`. If the `menuItem(...)` helper does not accept a testid, pass it through the helper's options or render the item with the attribute on its element so Playwright can target it.

- [ ] **Step 7: Channel view container** — on the root `<div className="flex h-full flex-col">` (ChannelView.tsx:100), add `data-testid="channel-view"` and `data-channel-key={channel.key}`.

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/
git commit -m "test: add data-testid anchors for E2E flows"
```

---

### Task 5: Flow 2 — connect replay populates the UI

**Files:**
- Create: `tests/e2e/connect-replay.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/connect-replay.spec.ts
import { expect, test } from '@playwright/test';
import { launchApp } from './support/launch';

test('replayed connect session populates connection + owner in the UI', async () => {
  const { page, close } = await launchApp(); // default fixture = e2e-connect
  try {
    // The replay transport emits transportState('connected'), which the footer
    // reflects through the WS pipeline.
    await expect(page.getByTestId('connection-status-footer')).toContainText('Connected');
    // RESP_SELF_INFO sets the owner identity; the header span changes away from
    // its empty-state "No identity".
    await expect(page.getByTestId('owner-name')).not.toHaveText('No identity');
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Build, then run the spec to verify it passes**

Run: `pnpm package && pnpm test:e2e -- connect-replay`
Expected: PASS. (`pnpm package` rebuilds so Task 4's `data-testid`s are in the renderer bundle.)

> If `owner-name` does not change, the captured `RESP_SELF_INFO` may not populate `owner.name` through the session; in that case assert on the always-visible `connection-status-footer` = "Connected" alone and note the gap — do not invent UI behavior.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/connect-replay.spec.ts
git commit -m "test: E2E connect-replay populates UI"
```

---

### Task 6: Flow 3 — send a channel message

**Files:**
- Create: `tests/e2e/send-message.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/send-message.spec.ts
import { expect, test } from '@playwright/test';
import type { Channel } from '../../src/shared/types';
import { launchApp } from './support/launch';

// A valid, sendable channel: `idx` is required for outbound CMD_SEND_CHAN_TXT_MSG
// (see src/main/protocol/session.ts sendChannelText). secretHex is a dummy
// 16-byte value, matching the Phase 2 outbound integration test.
const PUBLIC: Channel = {
  key: 'ch:Public',
  name: 'Public',
  kind: 'public',
  idx: 0,
  secretHex: '00112233445566778899aabbccddeeff',
};

test('sending a channel message shows it in the conversation', async () => {
  const { page, close } = await launchApp({ channels: [PUBLIC] });
  try {
    const item = page.getByTestId('channel-nav-item').filter({ hasText: 'Public' });
    // Expand the Channels group if the seeded channel is not already visible.
    if (!(await item.isVisible())) await page.getByText('Channels', { exact: true }).click();
    await item.click();

    await page.getByTestId('message-composer-input').fill('hello world');
    await page.getByTestId('message-send-button').click();

    // POST /api/messages/:key inserts the optimistic message and broadcasts it
    // before TX, so it appears regardless of the no-op replay sendBytes.
    await expect(
      page.getByTestId('message-row').filter({ hasText: 'hello world' }),
    ).toBeVisible();
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Build, then run the spec to verify it passes**

Run: `pnpm package && pnpm test:e2e -- send-message`
Expected: PASS — the typed message renders in the message list.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/send-message.spec.ts
git commit -m "test: E2E send a channel message"
```

---

### Task 7: Flow 4 — pane navigation + pin

**Files:**
- Create: `tests/e2e/navigation.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/navigation.spec.ts
import { expect, test } from '@playwright/test';
import type { Channel } from '../../src/shared/types';
import { launchApp } from './support/launch';

const CHANNELS: Channel[] = [
  { key: 'ch:Public', name: 'Public', kind: 'public', idx: 0, secretHex: '00112233445566778899aabbccddeeff' },
  { key: 'ch:Private', name: 'Private', kind: 'public', idx: 1, secretHex: 'ffeeddccbbaa99887766554433221100' },
];

test('navigates between channels and pins one to the top', async () => {
  const { page, close } = await launchApp({ channels: CHANNELS });
  try {
    const publicItem = page.getByTestId('channel-nav-item').filter({ hasText: 'Public' });
    const privateItem = page.getByTestId('channel-nav-item').filter({ hasText: 'Private' });
    if (!(await publicItem.isVisible())) await page.getByText('Channels', { exact: true }).click();

    await publicItem.click();
    await expect(page.getByTestId('channel-view')).toHaveAttribute('data-channel-key', 'ch:Public');

    await privateItem.click();
    await expect(page.getByTestId('channel-view')).toHaveAttribute('data-channel-key', 'ch:Private');

    // Pin "Private" via its right-click context menu.
    await privateItem.click({ button: 'right' });
    await page.getByTestId('pin-toggle-menu-item').click();
    await expect(privateItem.getByTestId('channel-pin-indicator')).toBeVisible();
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Build, then run the spec to verify it passes**

Run: `pnpm package && pnpm test:e2e -- navigation`
Expected: PASS — the active channel-view key switches Public→Private, and the pin star appears on "Private".

> If pinning navigates to a different open state or the Star renders outside the nav button, adjust the `channel-pin-indicator` placement in Task 4 / the locator scope — but keep the assertion on a real pinned-state signal.

- [ ] **Step 3: Run the full E2E suite to confirm no cross-spec interference**

Run: `pnpm package && pnpm test:e2e`
Expected: all 4 specs PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/navigation.spec.ts
git commit -m "test: E2E pane navigation and pin-to-top"
```

---

### Task 8: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install native build deps
        run: sudo apt-get update && sudo apt-get install -y libudev-dev
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 24.15.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:unit
      - run: pnpm test:integration
      - run: pnpm test:coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install native build + headless Electron deps
        run: sudo apt-get update && sudo apt-get install -y libudev-dev xvfb
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 24.15.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Install Electron/Chromium shared libraries
        run: pnpm exec playwright install-deps
      - run: pnpm package
      - run: xvfb-run --auto-servernum pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

- [ ] **Step 2: Validate the workflow YAML locally**

Run: `pnpm exec biome check .github/workflows/ci.yml || true` then visually confirm valid YAML (Biome may not lint YAML; the goal is to catch obvious syntax issues). Optionally, if available: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: no YAML parse error.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (checks + e2e)"
```

- [ ] **Step 4: Push and confirm CI runs green**

```bash
git push -u origin worktree-testing-phase1
```

Then check the Actions run (`gh run watch` or the GitHub UI). Expected: both `checks` and `e2e` jobs pass. If `e2e` fails on a missing system library, add it to the `apt-get` line; if it fails resolving the built entry, reconcile `MAIN_ENTRY` with the artifact `pnpm package` produced (see Task 3 note).

---

## Self-Review

**Spec coverage:**
- Replay transport (env-gated, in `src/main`) → Task 1. ✅
- Dynamic-import startup selection avoiding noble → Task 2. ✅
- Unpacked Vite build + `_electron.launch` + temp userData/fixture env → Task 3 (config + launch helper). ✅
- Four E2E flows (launches, connect-populates, send, navigate/pin) → Tasks 3, 5, 6, 7. ✅
- `data-testid` instrumentation + channel seeding → Task 4 + launch helper. ✅
- CI: checks job (typecheck/lint/unit/integration/coverage + artifact) and e2e job (xvfb, package, no gate) on push/PR, Node 24.15.0 → Task 8. ✅
- Coverage tracked not enforced (no threshold step) → Task 8. ✅

**Placeholder scan:** No "TBD"/"handle errors"/"similar to". The two spec-level deferrals (`.vite` entry fallback, possible owner-name gap) are written as concrete fallbacks with explicit instructions, not blank placeholders.

**Type consistency:** `installStartupTransport(env, manager)`, `FileReplayTransport(fixturePath)`, `launchApp(opts)` and the `Channel` seed shape (`key/name/kind/idx/secretHex`) are used identically across tasks. `data-testid` names (`owner-name`, `connection-status-footer`, `message-composer-input`, `message-send-button`, `message-row`, `channel-nav-item`, `channel-pin-indicator`, `pin-toggle-menu-item`, `channel-view`) match between Task 4 (added) and Tasks 5–7 (asserted). ✅
