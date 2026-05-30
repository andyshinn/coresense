# Testing Phase 2 — Integration + Decoupling Refactors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple Electron access behind three injectable seams, then add an `integration` Vitest project that exercises storage, the inbound packet path, the outbound send path, and the Hono API end-to-end in plain Node — no radio, no Electron runtime.

**Architecture:** Three tiny "platform seam" modules under `src/main/runtime/` hold an injected implementation (set at production bootstrap in `index.ts`, set to test doubles in the integration `setup.ts`). Call sites that only used Electron's `app` for `userData` paths, `app` lifecycle, or `safeStorage` switch to these seams and drop their `electron` import. Integration tests drive the real bus/session/state/storage/Hono modules with the seams injected and a fresh temp SQLite DB per file.

**Tech Stack:** Vitest 4.x (add `integration` project), `node:sqlite`, Hono (`api.request()` in-process), TypeScript, pnpm, Biome.

**Conventions:**
- pnpm only. Tests import `{ describe, it, expect, beforeEach, afterEach, vi }` explicitly from `vitest`.
- After each change run `pnpm typecheck` and `pnpm lint` (use `pnpm format` for Biome formatting; Biome may reorder imports / convert value-only-as-type to `import type` — accept).
- Commit after each task.
- **Refactor discipline (Tasks 1–4):** characterization-first. The seam modules are new code (true RED→GREEN TDD). The call-site swaps are behavior-preserving; the existing Phase 1 suite + `pnpm typecheck` are the safety net, plus the integration suites that follow.
- **Seam binding:** the getter returns the injected impl, or throws a clear "not initialized" error if used before injection. Production injection happens once in `index.ts` bootstrap (which imports `electron` normally) — this realizes the design's "lazy, central Electron access": the seam modules themselves never import `electron`, so the integration graph is Electron-free.

---

### Task 1: `userData` path seam

**Files:**
- Create: `src/main/runtime/userData.ts`
- Test: `tests/unit/main/runtime/userData.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/runtime/userData.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { setUserDataDir, userDataDir } from '../../../../src/main/runtime/userData';

afterEach(() => setUserDataDir(null));

describe('userDataDir', () => {
  it('returns the injected directory', () => {
    setUserDataDir('/tmp/coresense-test');
    expect(userDataDir()).toBe('/tmp/coresense-test');
  });

  it('falls back to CORESENSE_USER_DATA when no dir is injected', () => {
    setUserDataDir(null);
    const prev = process.env.CORESENSE_USER_DATA;
    process.env.CORESENSE_USER_DATA = '/tmp/from-env';
    try {
      expect(userDataDir()).toBe('/tmp/from-env');
    } finally {
      if (prev === undefined) delete process.env.CORESENSE_USER_DATA;
      else process.env.CORESENSE_USER_DATA = prev;
    }
  });

  it('throws a clear error when neither injection nor env nor electron is available', () => {
    setUserDataDir(null);
    const prev = process.env.CORESENSE_USER_DATA;
    delete process.env.CORESENSE_USER_DATA;
    try {
      expect(() => userDataDir()).toThrow(/userData directory not set/i);
    } finally {
      if (prev !== undefined) process.env.CORESENSE_USER_DATA = prev;
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- userData`
Expected: FAIL — cannot resolve `../../../../src/main/runtime/userData`.

- [ ] **Step 3: Implement the seam**

Create `src/main/runtime/userData.ts`:
```ts
// Central resolver for the writable userData directory. Production wires the
// real Electron path in index.ts bootstrap via setUserDataDir(); tests inject a
// temp dir. Resolution order: injected dir → CORESENSE_USER_DATA env → throw.
// This module deliberately does NOT import 'electron', so the storage/api graph
// stays Electron-free under Vitest.
let injected: string | null = null;

export function setUserDataDir(dir: string | null): void {
  injected = dir;
}

export function userDataDir(): string {
  if (injected) return injected;
  const fromEnv = process.env.CORESENSE_USER_DATA;
  if (fromEnv) return fromEnv;
  throw new Error(
    'userData directory not set — call setUserDataDir() during bootstrap (index.ts) or set CORESENSE_USER_DATA',
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- userData`
Expected: PASS — 3 tests.

- [ ] **Step 5: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/runtime/userData.ts tests/unit/main/runtime/userData.test.ts
git commit -m "feat: add injectable userData path seam"
```

---

### Task 2: `appLifecycle` seam

**Files:**
- Create: `src/main/runtime/appLifecycle.ts`
- Test: `tests/unit/main/runtime/appLifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/runtime/appLifecycle.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appLifecycle, setAppLifecycle } from '../../../../src/main/runtime/appLifecycle';

afterEach(() => setAppLifecycle(null));

describe('appLifecycle', () => {
  it('returns the injected implementation', () => {
    const quit = vi.fn();
    const relaunch = vi.fn();
    const exit = vi.fn();
    setAppLifecycle({ quit, relaunch, exit });
    appLifecycle().quit();
    appLifecycle().relaunch();
    appLifecycle().exit(0);
    expect(quit).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('throws when used before injection', () => {
    setAppLifecycle(null);
    expect(() => appLifecycle()).toThrow(/appLifecycle not set/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- appLifecycle`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seam**

Create `src/main/runtime/appLifecycle.ts`:
```ts
// Injectable wrapper over the Electron app lifecycle calls used by api/routes.
// Production wires real electron.app methods in index.ts; tests inject spies.
export interface AppLifecycle {
  quit(): void;
  relaunch(): void;
  exit(code?: number): void;
}

let injected: AppLifecycle | null = null;

export function setAppLifecycle(impl: AppLifecycle | null): void {
  injected = impl;
}

export function appLifecycle(): AppLifecycle {
  if (!injected) {
    throw new Error('appLifecycle not set — call setAppLifecycle() during bootstrap (index.ts)');
  }
  return injected;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- appLifecycle`
Expected: PASS — 2 tests.

- [ ] **Step 5: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/runtime/appLifecycle.ts tests/unit/main/runtime/appLifecycle.test.ts
git commit -m "feat: add injectable appLifecycle seam"
```

---

### Task 3: `secretStore` seam

**Files:**
- Create: `src/main/runtime/secretStore.ts`
- Test: `tests/unit/main/runtime/secretStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/runtime/secretStore.test.ts`:
```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { secretStore, setSecretStore } from '../../../../src/main/runtime/secretStore';

afterEach(() => setSecretStore(null));

describe('secretStore', () => {
  it('returns the injected implementation', () => {
    setSecretStore({
      available: () => true,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => b.toString('utf8'),
    });
    const s = secretStore();
    expect(s.available()).toBe(true);
    const cipher = s.encryptString('hello');
    expect(s.decryptString(cipher)).toBe('hello');
  });

  it('throws when used before injection', () => {
    setSecretStore(null);
    expect(() => secretStore()).toThrow(/secretStore not set/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- secretStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seam**

Create `src/main/runtime/secretStore.ts`:
```ts
import type { Buffer } from 'node:buffer';

// Injectable wrapper over Electron safeStorage (used by map/api-key.ts).
// Production wires electron.safeStorage in index.ts; tests inject an in-memory
// plaintext impl. Mirrors the safeStorage API surface api-key.ts depends on.
export interface SecretStore {
  available(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(cipher: Buffer): string;
}

let injected: SecretStore | null = null;

export function setSecretStore(impl: SecretStore | null): void {
  injected = impl;
}

export function secretStore(): SecretStore {
  if (!injected) {
    throw new Error('secretStore not set — call setSecretStore() during bootstrap (index.ts)');
  }
  return injected;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- secretStore`
Expected: PASS — 2 tests.

- [ ] **Step 5: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/runtime/secretStore.ts tests/unit/main/runtime/secretStore.test.ts
git commit -m "feat: add injectable secretStore seam"
```

---

### Task 4: Refactor call sites to the seams + wire production bootstrap

**Files:**
- Modify: `src/main/storage/db.ts`, `src/main/storage/settings.ts`, `src/main/api/middleware/auth.ts`, `src/main/logging/fileSink.ts`, `src/main/map/api-key.ts`, `src/main/api/routes.ts`, `src/main/index.ts`

This task is behavior-preserving. After each file, run `pnpm typecheck`. The existing unit suite + the integration suites (Tasks 6–9) are the regression net.

- [ ] **Step 1: `storage/db.ts` — userData seam + export `closeDb`**

In `src/main/storage/db.ts`: remove `import { app } from 'electron';`, add `import { userDataDir } from '../runtime/userData';`. Change the path line:
```ts
const path = join(userDataDir(), 'messages.db');
```
`db.ts` already exports `closeDb()` (it closes and nulls the `db` singleton) — the integration harness uses it as-is. No change needed there; only swap the `app.getPath('userData')` call.

- [ ] **Step 2: `storage/settings.ts` — userData seam**

Remove the `app` import (if `app` is only used for `getPath`), add `import { userDataDir } from '../runtime/userData';`, and change `pathFor`:
```ts
function pathFor(file: string): string {
  return join(userDataDir(), file);
}
```

- [ ] **Step 3: `api/middleware/auth.ts` — userData seam**

Remove `import { app } from 'electron';`, add `import { userDataDir } from '../../runtime/userData';`, change `getConfigPath`:
```ts
export function getConfigPath(): string {
  return join(userDataDir(), 'config.json');
}
```

- [ ] **Step 4: `logging/fileSink.ts` — userData seam**

Remove `import { app } from 'electron';`, add `import { userDataDir } from '../runtime/userData';`, change the logs-folder line:
```ts
if (!cachedFolder) cachedFolder = path.join(userDataDir(), 'logs');
```

- [ ] **Step 5: `map/api-key.ts` — userData + secretStore seams**

Remove `import { app, safeStorage } from 'electron';`, add:
```ts
import { secretStore } from '../runtime/secretStore';
import { userDataDir } from '../runtime/userData';
```
Change `blobPath` to use `userDataDir()`, and replace every `safeStorage.X` with `secretStore().X`:
- `blobPath()` → `return join(userDataDir(), FILE);`
- `safeStorage.isEncryptionAvailable()` → `secretStore().available()`
- `safeStorage.decryptString(cipher)` → `secretStore().decryptString(cipher)`
- `safeStorage.encryptString(key.trim())` → `secretStore().encryptString(key.trim())`

- [ ] **Step 6: `api/routes.ts` — appLifecycle seam**

Remove `import { app } from 'electron';`, add `import { appLifecycle } from '../runtime/appLifecycle';`. Replace the lifecycle calls in the quit/relaunch handlers:
- `setTimeout(() => app.quit(), 0);` → `setTimeout(() => appLifecycle().quit(), 0);`
- `app.relaunch();` → `appLifecycle().relaunch();`
- `app.exit(0);` → `appLifecycle().exit(0);`

- [ ] **Step 7: `index.ts` — wire production implementations at bootstrap**

In `src/main/index.ts`, immediately after the existing `import './storage/paths';` line (which sets up the dev userData redirect), add the seam wiring. Import `app` (and `safeStorage`) from electron if not already imported, plus the setters:
```ts
import { app, safeStorage } from 'electron';
import { setAppLifecycle } from './runtime/appLifecycle';
import { setSecretStore } from './runtime/secretStore';
import { setUserDataDir } from './runtime/userData';

// Wire the platform seams to real Electron before any storage/api code runs.
setUserDataDir(app.getPath('userData'));
setAppLifecycle({
  quit: () => app.quit(),
  relaunch: () => app.relaunch(),
  exit: (code) => app.exit(code),
});
setSecretStore({
  available: () => safeStorage.isEncryptionAvailable(),
  encryptString: (s) => safeStorage.encryptString(s),
  decryptString: (b) => safeStorage.decryptString(b),
});
```
Place this wiring near the top of the bootstrap, before windows are created or the server starts. If `app`/`safeStorage` are already imported in `index.ts`, merge rather than duplicate the import. Keep this block AFTER `import './storage/paths'` so the dev userData redirect has applied.

- [ ] **Step 8: Verify typecheck, lint, and the existing suite**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: typecheck/lint exit 0; all 122 existing unit tests still pass (the refactor is behavior-preserving; no test asserted the old electron import).

- [ ] **Step 9: Commit**

```bash
git add src/main/storage/db.ts src/main/storage/settings.ts src/main/api/middleware/auth.ts src/main/logging/fileSink.ts src/main/map/api-key.ts src/main/api/routes.ts src/main/index.ts
git commit -m "refactor: route userData/lifecycle/safeStorage through injectable seams"
```

**If `pnpm typecheck` reports remaining `electron` references** in any of these files (e.g. `settings.ts` used `app` for something other than `getPath`), keep that import for the non-path use and only swap the `getPath('userData')` call. Report any such case as DONE_WITH_CONCERNS with the detail.

---

### Task 5: Integration harness — Vitest project, setup, and support helpers

**Files:**
- Modify: `vitest.config.ts`, `package.json`
- Create: `tests/support/sqlite-temp.ts`, `tests/support/fake-transport.ts`, `tests/support/seams.ts`, `tests/integration/setup.ts`, `tests/integration/smoke.test.ts`

- [ ] **Step 1: Add the `integration` project and script**

In `vitest.config.ts`, add a second project to the `projects` array (after the `unit` project), and keep the top-level `coverage` block:
```ts
      {
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src/renderer'),
          },
        },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
```
In `package.json` scripts, add: `"test:integration": "vitest run --project integration"`.

- [ ] **Step 2: Write the `seams.ts` helper**

Create `tests/support/seams.ts`:
```ts
import { Buffer } from 'node:buffer';
import type { AppLifecycle } from '../../src/main/runtime/appLifecycle';
import type { SecretStore } from '../../src/main/runtime/secretStore';

export interface SpyLifecycle extends AppLifecycle {
  calls: string[];
}

/** AppLifecycle double that records calls instead of touching the process. */
export function spyLifecycle(): SpyLifecycle {
  const calls: string[] = [];
  return {
    calls,
    quit: () => void calls.push('quit'),
    relaunch: () => void calls.push('relaunch'),
    exit: (code) => void calls.push(`exit:${code ?? 0}`),
  };
}

/** In-memory SecretStore double — base64, no OS keychain. */
export function memorySecretStore(): SecretStore {
  return {
    available: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8'),
  };
}
```

- [ ] **Step 3: Write the `sqlite-temp.ts` helper**

Create `tests/support/sqlite-temp.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../../src/main/storage/db';
import { setUserDataDir } from '../../src/main/runtime/userData';

let currentDir: string | null = null;

/** Point storage at a fresh temp userData dir and reset the DB singleton. */
export function useTempUserData(): string {
  currentDir = mkdtempSync(join(tmpdir(), 'coresense-it-'));
  setUserDataDir(currentDir);
  closeDb(); // ensure the next openDb() opens against the new dir
  return currentDir;
}

/** Tear down: close the DB and remove the temp dir. */
export function cleanupTempUserData(): void {
  closeDb();
  if (currentDir) {
    rmSync(currentDir, { recursive: true, force: true });
    currentDir = null;
  }
  setUserDataDir(null);
}
```

- [ ] **Step 4: Write the `fake-transport.ts` helper**

Create `tests/support/fake-transport.ts`:
```ts
import { Buffer } from 'node:buffer';
import type { RawPacket } from '../../src/shared/types';
import type { ITransport } from '../../src/main/transport/types';

/** Build a kind:'companion' RawPacket from a full companion frame (code byte +
 *  payload). This is exactly what the session's onPacket consumes. */
export function companionPacket(frame: Buffer | string): RawPacket {
  const bytes = typeof frame === 'string' ? Buffer.from(frame, 'hex') : frame;
  const payload = bytes.subarray(1);
  return {
    timestamp: 0,
    transportType: 'ble',
    kind: 'companion',
    hex: bytes.toString('hex'),
    bytes: [...bytes],
    payloadHex: payload.toString('hex'),
    payloadBytes: [...payload],
    code: bytes[0],
  };
}

/** ITransport double that captures every sendBytes payload. */
export class FakeTransport implements ITransport {
  readonly type = 'ble' as const;
  readonly sent: Buffer[] = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async sendBytes(bytes: Buffer): Promise<void> {
    this.sent.push(Buffer.from(bytes));
  }
}
```

- [ ] **Step 5: Write the integration `setup.ts`**

Create `tests/integration/setup.ts`:
```ts
import { afterEach, beforeEach } from 'vitest';
import { bus } from '../../src/main/events/bus';
import { setAppLifecycle } from '../../src/main/runtime/appLifecycle';
import { setSecretStore } from '../../src/main/runtime/secretStore';
import { transportManager } from '../../src/main/transport/manager';
import { cleanupTempUserData, useTempUserData } from '../support/seams-bootstrap';
import { memorySecretStore, spyLifecycle } from '../support/seams';

beforeEach(() => {
  useTempUserData();
  setAppLifecycle(spyLifecycle());
  setSecretStore(memorySecretStore());
});

afterEach(() => {
  bus.removeAllListeners();
  transportManager.setTransport(null as never);
  cleanupTempUserData();
  setAppLifecycle(null);
  setSecretStore(null);
});
```
**Note:** import `useTempUserData`/`cleanupTempUserData` from `../support/sqlite-temp` (correct the path — the snippet above shows the intended functions; the module is `tests/support/sqlite-temp.ts`). If `transportManager.setTransport` rejects `null`, add a `clearTransport()` method to the manager in this task (one-liner: `clearTransport(){ this.active = null; }`) and call it instead — note that production change in your report.

- [ ] **Step 6: Write a smoke test that proves the harness boots**

Create `tests/integration/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { userDataDir } from '../../src/main/runtime/userData';
import { openDb } from '../../src/main/storage/db';

describe('integration harness', () => {
  it('points storage at a temp dir and opens a DB', () => {
    expect(userDataDir()).toMatch(/coresense-it-/);
    const db = openDb();
    const row = db.prepare('SELECT 1 AS n').get() as { n: number };
    expect(row.n).toBe(1);
  });
});
```

- [ ] **Step 7: Run the integration project**

Run: `pnpm test:integration`
Expected: PASS — the smoke test runs; `userDataDir()` resolves to a temp dir and `openDb()` works against `node:sqlite`. Fix the `setup.ts` import path / `clearTransport` issues flagged in Step 5 until green.

- [ ] **Step 8: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add vitest.config.ts package.json tests/support/sqlite-temp.ts tests/support/fake-transport.ts tests/support/seams.ts tests/integration/setup.ts tests/integration/smoke.test.ts src/main/transport/manager.ts
git commit -m "test: add integration Vitest project, setup, and support helpers"
```

---

### Task 6: Storage round-trip suite

**Files:**
- Create: `tests/integration/storage/round-trip.test.ts`

`messagesStore` API (from `src/main/storage/messages.ts`): `insert(message)`, `byKey(key, {limit?, before?})`, `recent(limit?)`, `findById(id)`, `markState(id, state)`, `trimPerKey(key, keep?)`. Message keys: `ch:<name>` (channel) or `c:<pkhex>` (dm). `searchMessages` is in `src/main/storage/search.ts`.

- [ ] **Step 1: Write the test**

Create `tests/integration/storage/round-trip.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/shared/types';
import { messagesStore } from '../../../src/main/storage/messages';
import { searchMessages } from '../../../src/main/storage/search';

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  key: 'ch:General',
  ts: 1_700_000_000_000,
  body: 'hello world',
  state: 'received',
  ...over,
});

describe('messagesStore round-trip', () => {
  it('inserts and reads back by key', () => {
    messagesStore.insert(msg());
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'm1', body: 'hello world', state: 'received' });
  });

  it('upserts idempotently on mid', () => {
    messagesStore.insert(msg({ body: 'first' }));
    messagesStore.insert(msg({ body: 'second' }));
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe('second');
  });

  it('updates state via markState', () => {
    messagesStore.insert(msg({ id: 'm2', key: 'c:aabb', body: 'dm', state: 'sending' }));
    messagesStore.markState('m2', 'ack');
    expect(messagesStore.findById('m2')?.state).toBe('ack');
  });

  it('bounds history with trimPerKey', () => {
    for (let i = 0; i < 5; i++) {
      messagesStore.insert(msg({ id: `k${i}`, ts: 1_700_000_000_000 + i, body: `b${i}` }));
    }
    messagesStore.trimPerKey('ch:General', 2);
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(2);
    // trim keeps the most recent by ts
    expect(rows.map((r) => r.body)).toEqual(['b3', 'b4']);
  });

  it('finds messages via FTS search', () => {
    messagesStore.insert(msg({ id: 's1', body: 'the quick brown fox' }));
    const results = searchMessages('quick');
    expect(results.some((r) => r.id === 's1')).toBe(true);
  });
});
```
**Note on `searchMessages`:** confirm its signature and return shape in `src/main/storage/search.ts` (it may take `(query, opts?)` and return objects with an `id`/`mid` and a snippet). Adjust the final test's assertion to the actual return type — the intent is "an inserted body is findable by a word in it." If the return uses `mid`, assert on that field.

- [ ] **Step 2: Run the test**

Run: `pnpm test:integration -- round-trip`
Expected: PASS — 5 tests. If the FTS test shape differs, fix per the note (do not weaken the other assertions).

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/storage/round-trip.test.ts
git commit -m "test: integration storage round-trip (insert/upsert/state/trim/FTS)"
```

---

### Task 7: Inbound packet pipeline suite

**Files:**
- Create: `tests/integration/inbound/channel-message.test.ts`

The session subscribes on `start()` and handles `kind:'companion'` packets. `handleChannelMsg` requires the channel slot to be known via `session.markChannelPresent({ idx, key, ... })`; with `pathLen=0xFF` (direct) it stores a `received` message (`body = cleanBody`, `key = channel.key`) via `holder.upsertMessage` (which persists to the DB) and fires `emit.messages(channel.key, ...)`.

- [ ] **Step 1: Write the test**

Create `tests/integration/inbound/channel-message.test.ts`:
```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '../../../src/shared/types';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { messagesStore } from '../../../src/main/storage/messages';
import { companionPacket } from '../../support/fake-transport';

// RESP_CHANNEL_MSG_RECV_V3 (0x11) frame, idx=0, pathLen=0xFF (direct),
// txt_type=0, ts, body "Alice: hi". Layout: [0x11][snr*4][2B rsv][idx][path_len]
// [txt_type][ts u32 LE][body].
function channelMsgV3(idx: number, ts: number, body: string): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(11 + text.length);
  frame[0] = 0x11;
  frame.writeInt8(48, 1); // snr*4 = 48 → 12 dB
  frame[4] = idx;
  frame[5] = 0xff; // direct
  frame[6] = 0;
  frame.writeUInt32LE(ts, 7);
  text.copy(frame, 11);
  return frame;
}

describe('inbound channel-message pipeline', () => {
  afterEach(() => protocolSession().stop());

  it('routes a received channel frame to state + storage + bus event', () => {
    const session = protocolSession();
    session.start();
    session.markChannelPresent({ key: 'ch:General', name: 'General', kind: 'public', idx: 0 });

    const emitted: Array<{ key: string; messages: Message[] }> = [];
    bus.on('messages', (key: string, messages: Message[]) => emitted.push({ key, messages }));

    emit.packet(companionPacket(channelMsgV3(0, 1_700_000_000, 'Alice: hi')));

    // Bus event fired for the channel key
    expect(emitted.at(-1)?.key).toBe('ch:General');
    // Persisted to the DB
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'ch:General', body: 'hi', state: 'received' });
  });

  it('drops a channel frame for an unknown slot', () => {
    const session = protocolSession();
    session.start();
    // No markChannelPresent → idx 3 unknown.
    emit.packet(companionPacket(channelMsgV3(3, 1_700_000_001, 'Bob: yo')));
    expect(messagesStore.recent()).toHaveLength(0);
  });
});
```
**Notes:**
- `protocolSession()` is a singleton; `stop()` in `afterEach` removes its bus listeners so files don't cross-talk. Confirm `stop()` exists (it does at `session.ts:261`).
- `handleChannelMsg` splits the `"Alice: "` sender prefix, so the stored `body` is `'hi'` and `fromPublicKeyHex` is `'name:Alice'`. If the singleton retains state across the two tests, the temp DB is fresh per test (setup.ts) but the in-memory session is not — `markChannelPresent` in test 1 could leak `idx 0` into test 2. Since test 2 uses `idx 3` (still unknown) this is fine; if you add more cases, call `session.markChannelAbsent(idx)` or rely on distinct idxs.

- [ ] **Step 2: Run the test**

Run: `pnpm test:integration -- channel-message`
Expected: PASS — 2 tests. If `body`/`fromPublicKeyHex` differ from the documented split, read `handleChannelMsg` (`session.ts:1821`) and adjust the assertion to the real stored values (the pipeline reaching state+DB+bus is the point).

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/inbound/channel-message.test.ts
git commit -m "test: integration inbound channel-message pipeline"
```

---

### Task 8: Outbound send pipeline suite

**Files:**
- Create: `tests/integration/outbound/send-channel.test.ts`

`sendChannelText(channelKey, text)` looks up the channel in `stateHolder().getChannels()`, resolves `idx`, builds the frame with `buildSendChannelText({ channelIdx, text })` (no explicit timestamp → uses `Date.now()`), and writes via `transportManager.getTransport().sendBytes()`. So assert the **structure** of the captured frame (code, flags, idx, text), not the timestamp.

- [ ] **Step 1: Write the test**

Create `tests/integration/outbound/send-channel.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Channel } from '../../../src/shared/types';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import { FakeTransport } from '../../support/fake-transport';

const channel: Channel = {
  key: 'ch:General',
  name: 'General',
  kind: 'public',
  idx: 2,
  secretHex: '00112233445566778899aabbccddeeff',
};

describe('outbound channel send', () => {
  it('encodes the channel-text frame and writes it to the transport', async () => {
    stateHolder().setChannels([channel]);
    const fake = new FakeTransport();
    transportManager.setTransport(fake);

    const result = await protocolSession().sendChannelText('ch:General', 'hi there');
    expect(result.ok).toBe(true);

    expect(fake.sent).toHaveLength(1);
    const frame = fake.sent[0];
    expect(frame[0]).toBe(0x03); // SEND_CHAN_TXT_MSG
    expect(frame[1]).toBe(0); // flags
    expect(frame[2]).toBe(2); // channel idx
    // bytes 3..6 are the LE timestamp (non-deterministic); body follows at 7.
    expect(frame.subarray(7).toString('utf8')).toBe('hi there');
  });

  it('fails cleanly when the channel slot is unknown', async () => {
    stateHolder().setChannels([{ ...channel, idx: undefined }]);
    transportManager.setTransport(new FakeTransport());
    const result = await protocolSession().sendChannelText('ch:General', 'hi');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no slot index/i);
  });
});
```
**Note:** `sendChannelText` resolves `idx` via `channel.idx ?? findIdxByKey(...)`. Seeding the channel with `idx: 2` makes it deterministic without needing `markChannelPresent`. Confirm `stateHolder().setChannels` is the channel setter (it is, `holder.ts:84`).

- [ ] **Step 2: Run the test**

Run: `pnpm test:integration -- send-channel`
Expected: PASS — 2 tests.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/outbound/send-channel.test.ts
git commit -m "test: integration outbound channel-send pipeline"
```

---

### Task 9: Hono API routes suite

**Files:**
- Create: `tests/integration/api/routes.test.ts`

`createRoutes({ port, wsClients, bridgeStatus })` returns a Hono app. Hono apps expose `.request(path, init?)` for in-process testing. **Auth note:** `apiKeyAuth` is applied in `server.ts` (`app.use('/api/*', apiKeyAuth)`), NOT inside `createRoutes`. So the app returned by `createRoutes` has **no auth middleware** — requests need no Authorization header. `/api/app/quit` calls `appLifecycle().quit()` inside a `setTimeout(..., 0)`; flush it before asserting.

- [ ] **Step 1: Write the test**

Create `tests/integration/api/routes.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { appLifecycle } from '../../../src/main/runtime/appLifecycle';
import { createRoutes } from '../../../src/main/api/routes';
import { stateHolder } from '../../../src/main/state/holder';
import type { SpyLifecycle } from '../../support/seams';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('api routes', () => {
  it('serves capabilities (public)', async () => {
    const res = await app().request('/api/capabilities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { httpPort: number };
    expect(body.httpPort).toBe(8080);
  });

  it('returns seeded channels', async () => {
    stateHolder().setChannels([{ key: 'ch:General', name: 'General', kind: 'public' }]);
    const res = await app().request('/api/channels');
    const body = (await res.json()) as Array<{ key: string }>;
    expect(body.map((c) => c.key)).toContain('ch:General');
  });

  it('invokes appLifecycle.quit on /api/app/quit (no real quit)', async () => {
    const res = await app().request('/api/app/quit', { method: 'POST' });
    expect(res.status).toBeLessThan(500);
    await flush();
    expect((appLifecycle() as SpyLifecycle).calls).toContain('quit');
  });

  it('round-trips the map api-key through secretStore', async () => {
    const set = await app().request('/api/map/api-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'pm-secret-key' }),
    });
    expect(set.status).toBeLessThan(400);
    const get = await app().request('/api/map/api-key');
    const body = (await get.json()) as { hasKey: boolean };
    expect(body.hasKey).toBe(true);
  });
});
```
**Notes:**
- `BridgeStatus` is cast with `as never` to avoid threading its full shape; if `bridgeStatus` is consumed by an endpoint you test, build the real object instead and confirm its shape in `src/shared/types.ts`.
- The quit handler returns then quits via `setTimeout`; `flush()` waits for it. The spy is the one injected by `setup.ts`, retrieved via `appLifecycle()`.
- If `/api/app/quit` differs in method/path, confirm in `routes.ts` (`api.post('/api/app/quit', ...)`).

- [ ] **Step 2: Run the test**

Run: `pnpm test:integration -- routes`
Expected: PASS — 4 tests.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/api/routes.test.ts
git commit -m "test: integration Hono API routes (read, lifecycle spy, secretStore)"
```

---

### Task 10: Full verification + coverage baseline

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite (both projects)**

Run: `pnpm test`
Expected: PASS — `unit` + `integration` projects all green, output pristine.

- [ ] **Step 2: Coverage**

Run: `pnpm test:coverage`
Expected: report prints; confirm `storage/messages.ts`, `protocol/session.ts` (channel-msg + send paths), `api/routes.ts`, and the three `runtime/*` seams now show meaningfully higher coverage than the Phase 1 baseline. No gate.

- [ ] **Step 3: Final typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

---

## Self-Review

**Spec coverage** (against `2026-05-29-testing-phase2-integration-design.md`):
- DI seam — central path module → Task 1; appLifecycle seam → Task 2; secretStore seam → Task 3; call-site refactors + production wiring → Task 4. ✓
- `integration` Vitest project + setup + helpers (sqlite-temp, fake-transport, seams) → Task 5. ✓
- Pipelines: storage round-trip → Task 6; inbound packet → Task 7; outbound send → Task 8; Hono API → Task 9. ✓
- Success criteria (all projects green, typecheck/lint clean, integration graph Electron-free) → Task 10 + the fact that seams never import electron. ✓

**Refinement vs. spec:** the spec described a "lazy Electron fallback" inside the path module; the plan instead keeps the seam modules Electron-free and injects real Electron impls once at `index.ts` bootstrap (the getter throws if used before injection). This achieves the same goal (no Electron import in the seam/test graph, central Electron access) more simply and is noted here intentionally.

**Placeholder scan:** no TBD/TODO; every step has real code or an exact command. A handful of steps carry explicit "confirm X against file Y and adjust" notes — these are genuine integration-state verifications (FTS return shape, the channel-message stored fields, `bridgeStatus` shape, `setTransport(null)` handling), not placeholders; each names the file and the specific thing to check.

**Type/name consistency:** `setUserDataDir`/`userDataDir`, `setAppLifecycle`/`appLifecycle` + `AppLifecycle`, `setSecretStore`/`secretStore` + `SecretStore`, `companionPacket`/`FakeTransport`, `useTempUserData`/`cleanupTempUserData`/`closeDb`, `spyLifecycle`/`memorySecretStore`/`SpyLifecycle`, `messagesStore.*`, `stateHolder().setChannels`, `protocolSession().{start,stop,markChannelPresent,sendChannelText}`, `createRoutes` — all consistent across tasks and matched to the real source.

**Known in-task verifications (named, not placeholders):**
- Task 4: `settings.ts` may use `app` for more than `getPath` (keep that import if so); `db.ts` `closeDb` export.
- Task 5: `setup.ts` import path for the temp helpers; possible `transportManager.clearTransport()` one-liner.
- Task 6: `searchMessages` signature/return field.
- Task 7: exact stored `body`/`fromPublicKeyHex` from `handleChannelMsg`.
- Task 9: `BridgeStatus` shape if an exercised endpoint reads it.
