# Message Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-delete a single message from `messages.db` behind a confirmation, reachable from a unified action-bar dropdown / right-click item set in channels, DMs, and search results.

**Architecture:** A `DELETE /api/messages/:key/:id` route on the existing local Hono API removes the row and writes a tombstone (so a re-heard channel packet can't resurrect it), then emits a dedicated `messagesDeleted` bus event that fans out over the one WebSocket to every client. In the renderer, both menus render from a single `ContextMenuEntry[]` producer, and the confirmation is a Radix Popover rendered by the message row itself.

**Tech Stack:** Electron + React 19 + TypeScript, `node:sqlite` (`DatabaseSync`) with FTS5, Hono HTTP + `ws`, zustand v5, Radix (`radix-ui` umbrella), Tailwind, Vitest (three projects), Biome.

**Spec:** `docs/superpowers/specs/2026-07-28-message-deletion-design.md` — read it before Task 1.

## Global Constraints

- **Formatting (Biome, enforced):** 2-space indent, `lineWidth: 125`, single quotes for JS/TS, double quotes for JSX attributes, semicolons always, trailing commas `all`. Run `npx biome check --write src tests` before every commit.
- **Run tooling via `npx`, never `pnpm <script>`** — pnpm's pre-run deps-check reflink-fails in `.claude/worktrees/` worktrees. `npx vitest run --project <unit|integration|dom>`, `npx tsc --noEmit`, `npx biome check src tests`.
- **`npx biome check` must be scoped to `src tests`** — repo-wide fails on pre-existing `build/`, `dist/`, `out/` artifacts.
- **Test file extensions are load-bearing:** `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts` (a `.tsx` there is silently not collected); `tests/component/**/*.test.tsx` (a `.ts` there is silently not collected).
- **`globals: true` is NOT set.** Every test must `import { describe, expect, it, vi } from 'vitest';` explicitly.
- **`@testing-library/jest-dom` is NOT installed.** Use `toBeTruthy()` / `toBeNull()` / `.textContent`. Never `toBeInTheDocument()`, `toBeVisible()`, `toBeDisabled()`.
- **`@testing-library/user-event` is NOT installed.** All interaction via `fireEvent`.
- **There is no shared `Message` test factory.** Each test file defines its own local builder. `Message` is `{ id, key, fromPublicKeyHex?, body, ts, state, meta? }` — `fromPublicKeyHex` is **omitted** for self-sent messages.
- **Anything touching `src/main/storage` must live under `tests/integration/`.** Only that project wires temp userData; elsewhere `userDataDir()` throws `userData directory not set`.
- **The stable message id is `mid`** (exposed as `Message.id`). The integer `messages.id` is an FTS5 `content_rowid` anchor only. **Every delete predicate is `WHERE mid = ?`.**
- **Never touch `messages_fts` by hand.** The `messages_ad` trigger reindexes on DELETE.
- **Copy is fixed:** the delete menu item reads exactly `Delete message`. `Dismiss locally` is retired.
- **`request<T>()` always parses JSON**, so the route must return a JSON body — never `204`.

---

## File Structure

**Create:**
- `src/renderer/features/message-actions/menuItems.ts` — the single `ContextMenuEntry[]` producer for both menus. Pure, no JSX, unit-testable.
- `src/renderer/features/message-actions/DeleteConfirmPopover.tsx` — anchored confirm, used by the conversation row and the search row.
- `tests/integration/storage/message-delete.test.ts`
- `tests/integration/inbound/message-delete-resurrection.test.ts`
- `tests/integration/api/messages-delete.test.ts`
- `tests/unit/renderer/features/message-menu-items.test.ts`
- `tests/component/delete-message.test.tsx`

**Modify:** `src/main/storage/db.ts`, `src/main/storage/messages.ts`, `src/main/state/holder.ts`, `src/main/events/bus.ts`, `src/main/server.ts`, `src/main/api/routes.ts`, `src/main/notifications/index.ts`, `src/shared/types.ts`, `src/renderer/lib/api.ts`, `src/renderer/lib/store.ts`, `src/renderer/app/wsHandlers.ts`, `src/renderer/components/MessageList.tsx`, `src/renderer/components/MessageItem.tsx`, `src/renderer/features/message-actions/MessageQuickBar.tsx`, `src/renderer/features/message-actions/OverflowMenu.tsx`, `src/renderer/panels/search/MessageRow.tsx`, `src/renderer/panels/search/index.tsx`, `tests/component/overflow-menu.test.tsx`

**Delete:** `src/renderer/panels/repeater-admin/MessagesTab.tsx` (orphaned — no importers, no matching tab id)

---

## Task 1: Storage — tombstone table and delete DAO

**Files:**
- Modify: `src/main/storage/db.ts` (append to the schema template literal, after line 100)
- Modify: `src/main/storage/messages.ts` (append to `messagesStore`, after `trimPerKey`)
- Test: `tests/integration/storage/message-delete.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `messagesStore.remove(ids: string[]): number` (count actually deleted) and `messagesStore.isDeleted(id: string): boolean`.

> **Note:** `.run()`'s return value is discarded everywhere else in this repo — `grep -rn "\.changes" src/` is currently empty. This task deliberately introduces the first read of it. `node:sqlite` returns `{ changes: number | bigint }`, hence the `Number(...)` wrapper in the reference implementation below (though the final code counts rows found instead, see Step 3).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/storage/message-delete.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import { searchMessages } from '../../../src/main/storage/search';
import type { Message } from '../../../src/shared/types';

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  key: 'ch:General',
  ts: 1_700_000_000_000,
  body: 'hello world',
  state: 'received',
  ...over,
});

const searchOpts = { contacts: [], blockRules: [], regexCache: new Map() };

describe('messagesStore.remove', () => {
  it('deletes the row by mid', () => {
    messagesStore.insert(msg());
    expect(messagesStore.remove(['m1'])).toBe(1);
    expect(messagesStore.findById('m1')).toBeNull();
  });

  it('drops the row from the FTS index', () => {
    messagesStore.insert(msg({ body: 'unmistakable phrase' }));
    expect(searchMessages({ query: 'unmistakable' }, searchOpts).messages).toHaveLength(1);
    messagesStore.remove(['m1']);
    expect(searchMessages({ query: 'unmistakable' }, searchOpts).messages).toHaveLength(0);
  });

  it('writes a tombstone so the id is recorded as deleted', () => {
    messagesStore.insert(msg());
    expect(messagesStore.isDeleted('m1')).toBe(false);
    messagesStore.remove(['m1']);
    expect(messagesStore.isDeleted('m1')).toBe(true);
  });

  it('returns 0 and writes no tombstone for an unknown mid', () => {
    expect(messagesStore.remove(['nope'])).toBe(0);
    expect(messagesStore.isDeleted('nope')).toBe(false);
  });

  it('returns 0 for an empty id list', () => {
    expect(messagesStore.remove([])).toBe(0);
  });

  it('deletes several ids at once and leaves others alone', () => {
    messagesStore.insert(msg({ id: 'a' }));
    messagesStore.insert(msg({ id: 'b' }));
    messagesStore.insert(msg({ id: 'c' }));
    expect(messagesStore.remove(['a', 'c'])).toBe(2);
    expect(messagesStore.findById('a')).toBeNull();
    expect(messagesStore.findById('b')).not.toBeNull();
    expect(messagesStore.findById('c')).toBeNull();
  });

  it('counts only the ids that existed', () => {
    messagesStore.insert(msg({ id: 'a' }));
    expect(messagesStore.remove(['a', 'ghost'])).toBe(1);
    expect(messagesStore.isDeleted('ghost')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration tests/integration/storage/message-delete.test.ts`
Expected: FAIL — `messagesStore.remove is not a function`.

- [ ] **Step 3: Add the tombstone table**

In `src/main/storage/db.ts`, inside the `db.exec(\`...\`)` template literal, insert **after** the line `    CREATE INDEX IF NOT EXISTS discovered_by_on_radio    ON discovered_contacts (on_radio);` and **before** the closing `` `); ``:

```sql

    -- Ids of messages the user deleted. Consulted on the inbound write path so
    -- a re-heard packet can't resurrect a deleted row: the library mints
    -- channel-message ids deterministically (chmsg-<key>-<ts>-<bodyhash>) and
    -- messagesStore.insert upserts on mid, so without this a second flood
    -- receipt silently re-creates the row. Kept forever — ~40 bytes each, and
    -- the library rebuilds its in-memory map each session so a process-scoped
    -- guard would let the message return on the next launch.
    -- Removed once andyshinn/meshcore-ts#2 lands a suppression API.
    CREATE TABLE IF NOT EXISTS deleted_messages (
      mid TEXT PRIMARY KEY,
      ts  INTEGER NOT NULL
    );
```

- [ ] **Step 4: Add the DAO methods**

In `src/main/storage/messages.ts`, insert **after** `trimPerKey`'s closing `  },` and **before** the object's closing `};`:

```ts
  /** Hard-delete messages by app-level id (`mid`) and tombstone exactly the
   *  ones that existed. The messages_ad trigger keeps messages_fts in sync —
   *  do not touch that table here. Returns the number of rows removed. */
  remove(ids: string[]): number {
    if (ids.length === 0) return 0;
    const db = openDb();
    const probe = ids.map(() => '?').join(', ');
    db.exec('BEGIN');
    try {
      const rows = db.prepare(`SELECT mid FROM messages WHERE mid IN (${probe})`).all(...ids) as unknown as {
        mid: string;
      }[];
      if (rows.length === 0) {
        db.exec('COMMIT');
        return 0;
      }
      const found = rows.map((r) => r.mid);
      const holes = found.map(() => '?').join(', ');
      db.prepare(`DELETE FROM messages WHERE mid IN (${holes})`).run(...found);
      const tombstone = db.prepare(`INSERT OR IGNORE INTO deleted_messages (mid, ts) VALUES (?, ?)`);
      const now = Date.now();
      for (const mid of found) tombstone.run(mid, now);
      db.exec('COMMIT');
      return found.length;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  /** True when the user deleted this id. Guards the inbound write path. */
  isDeleted(id: string): boolean {
    const db = openDb();
    const row = db.prepare(`SELECT 1 AS present FROM deleted_messages WHERE mid = ?`).get(id) as
      | { present: number }
      | undefined;
    return row != null;
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project integration tests/integration/storage/message-delete.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Format, typecheck, full integration suite**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run --project integration
```
Expected: all clean, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/main/storage/db.ts src/main/storage/messages.ts tests/integration/storage/message-delete.test.ts
git commit -m "feat(storage): hard-delete messages by mid with tombstones"
```

---

## Task 2: Holder façade and the resurrection guard

**Files:**
- Modify: `src/main/state/holder.ts` (add `removeMessages`; add a guard inside `recordLibMessage`)
- Test: `tests/integration/inbound/message-delete-resurrection.test.ts` (create)

**Interfaces:**
- Consumes: `messagesStore.remove(ids)`, `messagesStore.isDeleted(id)` from Task 1.
- Produces: `StateHolder.removeMessages(ids: string[]): number`.

> **Why only `recordLibMessage`:** it is the only path that *inserts* library-minted ids. `setMessageState` is a bare `UPDATE` that matches nothing once the row is gone; `appendMessagePath` returns `null` on a `findById` miss before reaching its insert; `insertMessage`'s two callers mint random `local-` / `proxy-` ids. `upsertMessage` has **zero production callers**. Do not add guards elsewhere.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/inbound/message-delete-resurrection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

// Deterministic channel id, exactly the shape @andyshinn/meshcore-ts mints:
// chmsg-<channel.key>-<timestampUnix>-<sha1(body)[0:12]>. Two flood receipts of
// one packet produce this same id, which is why a deleted row can come back.
const CHANNEL_MID = 'chmsg-ch:General-1700000000-abc123def456';

const channelMsg = (): Message => ({
  id: CHANNEL_MID,
  key: 'ch:General',
  ts: 1_700_000_000_000,
  body: 'anyone near the north ridge repeater',
  state: 'received',
  fromPublicKeyHex: 'name:nate',
});

describe('deleted messages do not come back', () => {
  it('drops a re-heard channel packet whose id was deleted', () => {
    const holder = stateHolder();
    holder.recordLibMessage(channelMsg());
    expect(messagesStore.findById(CHANNEL_MID)).not.toBeNull();

    expect(holder.removeMessages([CHANNEL_MID])).toBe(1);
    expect(messagesStore.findById(CHANNEL_MID)).toBeNull();

    // Same packet, second flood path — the library re-emits messageUpserted
    // with the identical deterministic id.
    holder.recordLibMessage(channelMsg());
    expect(messagesStore.findById(CHANNEL_MID)).toBeNull();
  });

  it('still records a genuinely new message after a delete', () => {
    const holder = stateHolder();
    holder.recordLibMessage(channelMsg());
    holder.removeMessages([CHANNEL_MID]);
    holder.recordLibMessage({ ...channelMsg(), id: 'radio-xyz-000001', body: 'different' });
    expect(messagesStore.findById('radio-xyz-000001')).not.toBeNull();
  });

  it('removeMessages returns 0 for an unknown id', () => {
    expect(stateHolder().removeMessages(['ghost'])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration tests/integration/inbound/message-delete-resurrection.test.ts`
Expected: FAIL — `holder.removeMessages is not a function`.

- [ ] **Step 3: Add the façade method**

In `src/main/state/holder.ts`, insert **after** `setMessageState`'s closing brace:

```ts
  setMessageState(id: string, state: Message['state']): void {
    messagesStore.markState(id, state);
  }
```

…the new method:

```ts
  /** Hard-delete messages and tombstone them. Returns the number removed, so
   *  the route can 404 on an unknown id. */
  removeMessages(ids: string[]): number {
    return messagesStore.remove(ids);
  }
```

- [ ] **Step 4: Add the resurrection guard**

In `src/main/state/holder.ts`, replace:

```ts
  recordLibMessage(message: Message): void {
    const isNew = !messagesStore.findById(message.id);
```

with:

```ts
  recordLibMessage(message: Message): void {
    // The user deleted this id — do not let a re-heard packet re-create it.
    // Channel-message ids are deterministic, and messagesStore.insert upserts
    // on mid. Guard runs before the block-rule bump below so a resurrect
    // attempt doesn't also inflate a rule's matchCount.
    // Removed once andyshinn/meshcore-ts#2 lands a suppression API.
    if (messagesStore.isDeleted(message.id)) return;
    const isNew = !messagesStore.findById(message.id);
```

> `const isNew = !messagesStore.findById(message.id);` appears **twice** in this file (also in `upsertMessage`). Include the `recordLibMessage` signature line in the match so the edit is unambiguous.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project integration tests/integration/inbound/message-delete-resurrection.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Format, typecheck, full integration suite**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run --project integration
```

- [ ] **Step 7: Commit**

```bash
git add src/main/state/holder.ts tests/integration/inbound/message-delete-resurrection.test.ts
git commit -m "feat(state): guard the inbound write path against deleted ids"
```

---

## Task 3: The `messagesDeleted` wire event

**Files:**
- Modify: `src/main/events/bus.ts` (emitter after `messagePathHeard`; `BusEvents` entry after `messagePathHeard`)
- Modify: `src/shared/types.ts` (`WsMessage` variant after the `messagePathHeard` variant)
- Modify: `src/main/server.ts` (handler const, `bus.on`, `bus.off`)

**Interfaces:**
- Consumes: nothing.
- Produces: `emit.messagesDeleted({ key: string; ids: string[] })`; bus event `'messagesDeleted'`; WS frame `{ type: 'messagesDeleted'; payload: { key: string; ids: string[] } }`.

> No test of its own — it is pure plumbing with no behaviour until Task 4 calls it, and Task 4's route test asserts the emission. Do not invent a test that only checks TypeScript compiles.

- [ ] **Step 1: Add the emitter**

In `src/main/events/bus.ts`, in the `emit` object, insert **after**:

```ts
  messagePathHeard: (payload: { id: string; path: MessagePath; state: MessageState }) =>
    bus.emit('messagePathHeard', payload),
```

the line:

```ts
  messagesDeleted: (payload: { key: string; ids: string[] }) => bus.emit('messagesDeleted', payload),
```

- [ ] **Step 2: Add the `BusEvents` entry**

In the same file, in `export type BusEvents = {`, insert **after**:

```ts
  messagePathHeard: (payload: { id: string; path: MessagePath; state: MessageState }) => void;
```

the line:

```ts
  messagesDeleted: (payload: { key: string; ids: string[] }) => void;
```

- [ ] **Step 3: Add the `WsMessage` variant**

In `src/shared/types.ts`, in the `WsMessage` union, insert **after**:

```ts
  | { type: 'messagePathHeard'; payload: { id: string; path: MessagePath; state: MessageState } }
```

the line:

```ts
  | { type: 'messagesDeleted'; payload: { key: string; ids: string[] } }
```

- [ ] **Step 4: Broadcast it**

In `src/main/server.ts`, insert **after**:

```ts
  const onMessagePathHeard = (payload: { id: string; path: MessagePath; state: MessageState }) =>
    broadcast({ type: 'messagePathHeard', payload });
```

the handler:

```ts
  const onMessagesDeleted = (payload: { key: string; ids: string[] }) =>
    broadcast({ type: 'messagesDeleted', payload });
```

Then insert **after** `  bus.on('messagePathHeard', onMessagePathHeard);`:

```ts
  bus.on('messagesDeleted', onMessagesDeleted);
```

And **after** `    bus.off('messagePathHeard', onMessagePathHeard);` (4-space indent, inside `close`):

```ts
    bus.off('messagesDeleted', onMessagesDeleted);
```

- [ ] **Step 5: Verify it compiles and nothing regressed**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```
Expected: typecheck clean; all three projects pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/events/bus.ts src/shared/types.ts src/main/server.ts
git commit -m "feat(events): add the messagesDeleted bus + WS event"
```

---

## Task 4: The DELETE route and badge recompute

**Files:**
- Modify: `src/main/api/routes.ts` (new route after `POST /api/messages/:key`)
- Modify: `src/main/notifications/index.ts` (badge registration after the `blockRules` line)
- Test: `tests/integration/api/messages-delete.test.ts` (create)

**Interfaces:**
- Consumes: `StateHolder.removeMessages(ids)` (Task 2), `emit.messagesDeleted(payload)` (Task 3).
- Produces: `DELETE /api/messages/:key/:id` → `200 {ok:true}` | `404 {error}` | `400 {error}`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/messages-delete.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { bus } from '../../../src/main/events/bus';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  key: 'ch:General',
  ts: 1_700_000_000_000,
  body: 'hello world',
  state: 'received',
  ...over,
});

afterEach(() => {
  bus.removeAllListeners('messagesDeleted');
  bus.removeAllListeners('messages');
});

describe('DELETE /api/messages/:key/:id', () => {
  it('deletes the message and returns ok', async () => {
    messagesStore.insert(msg());
    const res = await app().request('/api/messages/ch%3AGeneral/m1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(messagesStore.findById('m1')).toBeNull();
  });

  it('emits messagesDeleted with the key and ids', async () => {
    messagesStore.insert(msg());
    const seen: { key: string; ids: string[] }[] = [];
    bus.on('messagesDeleted', (payload: { key: string; ids: string[] }) => seen.push(payload));
    await app().request('/api/messages/ch%3AGeneral/m1', { method: 'DELETE' });
    expect(seen).toEqual([{ key: 'ch:General', ids: ['m1'] }]);
  });

  it('does not emit the full messages re-push', async () => {
    messagesStore.insert(msg());
    const onMessages = vi.fn();
    bus.on('messages', onMessages);
    await app().request('/api/messages/ch%3AGeneral/m1', { method: 'DELETE' });
    expect(onMessages).not.toHaveBeenCalled();
  });

  it('404s an unknown id', async () => {
    const res = await app().request('/api/messages/ch%3AGeneral/nope', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('400s a malformed conversation key', async () => {
    messagesStore.insert(msg());
    const res = await app().request('/api/messages/bogus/m1', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('handles a DM key', async () => {
    messagesStore.insert(msg({ id: 'd1', key: 'c:deadbeef' }));
    const res = await app().request('/api/messages/c%3Adeadbeef/d1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(messagesStore.findById('d1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration tests/integration/api/messages-delete.test.ts`
Expected: FAIL — 404 from Hono (no such route) on the happy-path test.

- [ ] **Step 3: Add the route**

In `src/main/api/routes.ts`, insert **after** the closing of `POST /api/messages/:key`:

```ts
    return c.json({ ok: true, id: result.id });
  });
```

the new route:

```ts

  // Local-only. MeshCore has no retract primitive, so unlike DELETE
  // /api/contacts/:key there is no radio round-trip to make and nothing to
  // desync with. A tombstone stops a re-heard packet resurrecting the row.
  api.delete('/api/messages/:key/:id', (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const id = c.req.param('id');
    if (!key.startsWith('ch:') && !key.startsWith('c:')) {
      return c.json({ error: 'key must be ch:<name> or c:<pubkey>' }, 400);
    }
    if (stateHolder().removeMessages([id]) === 0) return c.json({ error: 'not found' }, 404);
    emit.messagesDeleted({ key, ids: [id] });
    return c.json({ ok: true });
  });
```

`emit` and `stateHolder` are already imported in this file.

- [ ] **Step 4: Keep the dock badge correct**

In `src/main/notifications/index.ts`, insert **after** `  bus.on('blockRules', () => router.recomputeBadge());` and **before** `  router.recomputeBadge();`:

```ts
  // Deliberately not routed through router.handleMessages: that only ever
  // processes the tail of a list, so a re-push after deleting the newest
  // message could raise a fresh banner for an older one.
  bus.on('messagesDeleted', () => router.recomputeBadge());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project integration tests/integration/api/messages-delete.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Format, typecheck, full integration suite**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run --project integration
```

- [ ] **Step 7: Commit**

```bash
git add src/main/api/routes.ts src/main/notifications/index.ts tests/integration/api/messages-delete.test.ts
git commit -m "feat(api): DELETE /api/messages/:key/:id"
```

---

## Task 5: Renderer plumbing — api client, store, WS handler

**Files:**
- Modify: `src/renderer/lib/api.ts` (new entry after `sendMessage`)
- Modify: `src/renderer/lib/store.ts` (two interface entries, one initial value, two action impls)
- Modify: `src/renderer/app/wsHandlers.ts` (new `case`)
- Test: `tests/component/delete-message.test.tsx` (create — store-only tests for now)

**Interfaces:**
- Consumes: the route from Task 4; the `WsMessage` variant from Task 3.
- Produces:
  - `api.deleteMessage(c: ApiClient, key: string, id: string): Promise<{ ok: true }>`
  - `CoreState.removeMessages(key: string, ids: string[]): void`
  - `CoreState.pendingDeleteMessageId: string | null`
  - `CoreState.setPendingDeleteMessageId(id: string | null): void`

- [ ] **Step 1: Write the failing test**

Create `tests/component/delete-message.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import type { Message } from '../../src/shared/types';

const msg = (id: string): Message => ({ id, key: 'ch:x', fromPublicKeyHex: 'a3f9', body: id, ts: 0, state: 'received' });

beforeEach(() => {
  useStore.setState({
    messagesByKey: { 'ch:x': [msg('a'), msg('b'), msg('c')] },
    selectedMessageId: null,
    pendingJumpMid: null,
    pendingDeleteMessageId: null,
  });
});

describe('store.removeMessages', () => {
  it('removes the message from its conversation', () => {
    useStore.getState().removeMessages('ch:x', ['b']);
    expect(useStore.getState().messagesByKey['ch:x'].map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('leaves other conversations untouched', () => {
    useStore.setState({ messagesByKey: { 'ch:x': [msg('a')], 'ch:y': [msg('a')] } });
    useStore.getState().removeMessages('ch:x', ['a']);
    expect(useStore.getState().messagesByKey['ch:y']).toHaveLength(1);
  });

  it('is a no-op for an unknown conversation key', () => {
    useStore.getState().removeMessages('ch:nope', ['a']);
    expect(useStore.getState().messagesByKey['ch:x']).toHaveLength(3);
  });

  it('clears selectedMessageId when that message is deleted', () => {
    useStore.setState({ selectedMessageId: 'b' });
    useStore.getState().removeMessages('ch:x', ['b']);
    expect(useStore.getState().selectedMessageId).toBeNull();
  });

  it('keeps selectedMessageId when a different message is deleted', () => {
    useStore.setState({ selectedMessageId: 'a' });
    useStore.getState().removeMessages('ch:x', ['b']);
    expect(useStore.getState().selectedMessageId).toBe('a');
  });

  it('clears pendingJumpMid when that message is deleted', () => {
    useStore.setState({ pendingJumpMid: 'c' });
    useStore.getState().removeMessages('ch:x', ['c']);
    expect(useStore.getState().pendingJumpMid).toBeNull();
  });
});

describe('store.setPendingDeleteMessageId', () => {
  it('round-trips an id and clears back to null', () => {
    useStore.getState().setPendingDeleteMessageId('b');
    expect(useStore.getState().pendingDeleteMessageId).toBe('b');
    useStore.getState().setPendingDeleteMessageId(null);
    expect(useStore.getState().pendingDeleteMessageId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/delete-message.test.tsx`
Expected: FAIL — `removeMessages is not a function`.

- [ ] **Step 3a: Add the api client entry**

In `src/renderer/lib/api.ts`, insert **after** the `}),` that closes `sendMessage`:

```ts
  deleteMessage: (c: ApiClient, key: string, id: string) =>
    request<{ ok: true }>(c, `/api/messages/${encodeURIComponent(key)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
```

- [ ] **Step 3b: Declare the store members**

In `src/renderer/lib/store.ts`, in the `CoreState` interface, add next to the other message appliers (beside `applyMessages`):

```ts
  removeMessages: (key: string, ids: string[]) => void;
```

and in the transient block that holds `selectedMessageId` / `pendingJumpMid`:

```ts
  /** Message id whose delete confirmation is open. The row renders the
   *  confirm popover anchored to itself, so only an id is needed. */
  pendingDeleteMessageId: string | null;
  setPendingDeleteMessageId: (id: string | null) => void;
```

- [ ] **Step 3c: Add the initial value**

In the initial-value block (beside `messagesByKey: {}`):

```ts
  pendingDeleteMessageId: null,
```

- [ ] **Step 3d: Implement the actions**

Insert **after** the closing `}),` of `appendMessagePath` and before `applyChannels`:

```ts

  removeMessages: (key, ids) =>
    set((s) => {
      const list = s.messagesByKey[key];
      const drop = new Set(ids);
      const patch: Partial<CoreState> = {};
      if (list) patch.messagesByKey = { ...s.messagesByKey, [key]: list.filter((m) => !drop.has(m.id)) };
      // Both of these would otherwise dangle: the right rail resolves
      // selectedMessageId with a .find(), and MessageList's jump effect never
      // clears a pendingJumpMid it cannot resolve.
      if (s.selectedMessageId && drop.has(s.selectedMessageId)) patch.selectedMessageId = null;
      if (s.pendingJumpMid && drop.has(s.pendingJumpMid)) patch.pendingJumpMid = null;
      return patch;
    }),
```

Insert **after** `  setSelectedMessage: (id) => set(() => ({ selectedMessageId: id })),`:

```ts
  setPendingDeleteMessageId: (id) => set(() => ({ pendingDeleteMessageId: id })),
```

- [ ] **Step 3e: Handle the WS frame**

In `src/renderer/app/wsHandlers.ts`, insert **after** the `break;` closing `case 'messagePathHeard':` and before `case 'owner':`:

```ts
      case 'messagesDeleted':
        s.removeMessages(msg.payload.key, msg.payload.ids);
        break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/delete-message.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Format, typecheck, all projects**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/api.ts src/renderer/lib/store.ts src/renderer/app/wsHandlers.ts tests/component/delete-message.test.tsx
git commit -m "feat(renderer): wire message deletion through api, store and WS"
```

---

## Task 6: Extract the shared menu-item producer

**Files:**
- Create: `src/renderer/features/message-actions/menuItems.ts`
- Modify: `src/renderer/components/MessageList.tsx` (delete the local `BuildMenuOpts` + `buildMessageMenuItems`, import instead)

**Interfaces:**
- Consumes: `ContextMenuEntry`, `menuItem`, `menuSeparator`, `copyToClipboard` from `src/renderer/components/ContextMenu`; `BlockSenderDialogPrefill` from `src/renderer/components/BlockSenderDialog`.
- Produces — **the moved shape only**, identical to what `MessageList` declares today. Task 7 adds `isSelf` and `onDelete`; do not add them here:
  ```ts
  export interface BuildMessageMenuOpts {
    message: Message;
    onResend?: (m: Message) => void;
    onViewContact: (key: string) => void;
    onBlock: (prefill: BlockSenderDialogPrefill) => void;
    senderName: string | undefined;
  }
  export function buildMessageMenuItems(opts: BuildMessageMenuOpts): ContextMenuEntry[];
  ```

> **This task is a pure move.** Same items, same order, same behaviour — `isSelf`, `onDelete`, and the new items arrive in Task 7. Existing tests must pass untouched.

- [ ] **Step 1: Create the module as a verbatim move**

Create `src/renderer/features/message-actions/menuItems.ts`:

```ts
import { Copy, RotateCw, ShieldOff, User } from 'lucide-react';
import type { Message } from '../../../shared/types';
import type { BlockSenderDialogPrefill } from '../../components/BlockSenderDialog';
import { type ContextMenuEntry, copyToClipboard, menuItem, menuSeparator } from '../../components/ContextMenu';

export interface BuildMessageMenuOpts {
  message: Message;
  onResend?: (m: Message) => void;
  onViewContact: (key: string) => void;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  senderName: string | undefined;
}

/** The one item set behind both the right-click menu and the action-bar
 *  overflow menu. Two renderers, one list. */
export function buildMessageMenuItems({
  message,
  onResend,
  onViewContact,
  onBlock,
  senderName,
}: BuildMessageMenuOpts): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [menuItem('Copy text', () => copyToClipboard(message.body), { icon: Copy })];

  const pk = message.fromPublicKeyHex;
  if (pk && pk !== 'unknown' && !pk.startsWith('name:')) {
    items.push(menuItem('View contact', () => onViewContact(`c:${pk}`), { icon: User }));
  }

  if (message.state === 'failed' && onResend) {
    items.push(menuSeparator);
    items.push(menuItem('Re-send', () => onResend(message), { icon: RotateCw }));
  }

  items.push(menuSeparator);
  const originHop = message.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
  const rawPk = message.fromPublicKeyHex;
  const hasRealPubkey = rawPk != null && rawPk !== 'unknown' && !rawPk.startsWith('name:');
  // Origin hop pk would carry an advert-resolved pubkey, but the current
  // path-build pipeline never populates it for channel messages — it's always
  // null. Treat it as the authoritative source if a future change wires it.
  const pubkey = hasRealPubkey ? rawPk : (originHop?.pk ?? undefined);
  // Prefix is the first 4 hex chars of the real pubkey. originHop.shortId
  // is a 2-char name-derived display label (NOT hex), so we don't use it as
  // a pubkey prefix — that would silently create rules like pattern='sr'
  // that match by name lookalike, which is misleading.
  const prefix = hasRealPubkey ? rawPk.slice(0, 4) : (originHop?.pk?.slice(0, 4) ?? undefined);
  items.push(
    menuItem(
      'Block sender…',
      () => {
        onBlock({
          pubkey,
          pubkeyPrefix: prefix,
          name: senderName || undefined,
        });
      },
      { icon: ShieldOff },
    ),
  );

  return items;
}
```

- [ ] **Step 2: Remove the originals from `MessageList.tsx`**

Delete the `interface BuildMenuOpts { … }` block and the whole `function buildMessageMenuItems(…) { … }` (through the file's final `}`), then add the import alongside the other `features/` imports:

```ts
import { buildMessageMenuItems } from '../features/message-actions/menuItems';
```

Remove any now-unused icon imports (`Copy`, `RotateCw`, `ShieldOff`, `User`) and `menuItem` / `menuSeparator` / `copyToClipboard` from the `./ContextMenu` import **only if** nothing else in the file still uses them. Biome will flag unused imports.

- [ ] **Step 3: Verify nothing changed behaviourally**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```
Expected: all three projects pass with **no test changes** — this is a pure move.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/features/message-actions/menuItems.ts src/renderer/components/MessageList.tsx
git commit -m "refactor(message-actions): extract buildMessageMenuItems"
```

---

## Task 7: The unified item set

**Files:**
- Modify: `src/renderer/features/message-actions/menuItems.ts`
- Modify: `src/renderer/components/MessageList.tsx` (pass `isSelf` and `onDelete`)
- Test: `tests/unit/renderer/features/message-menu-items.test.ts` (create)

**Interfaces:**
- Consumes: `formatAllPathsHeard`, `formatFirstPathHeard` from `./paths`; `notify` from `../../lib/notify`.
- Produces: the final `BuildMessageMenuOpts` shape declared in Task 6's Interfaces block, now with `isSelf: boolean` and `onDelete: (message: Message) => void` required.

Target item set, in order — separators collapse when their group is empty:

```
Copy text
────────────
View contact              (real pubkey only)
Copy public key           (real pubkey only)
Copy first path heard     (if a path was heard)
Copy all paths heard      (if a path was heard)
────────────
Re-send                   (state === 'failed' && onResend)
Block sender…             (!isSelf)
────────────
Delete message            (danger)
```

> Faithful-port details: every copy entry toasts, `Copy text` included. This is a deliberate departure from the right-click menu it was ported from — the quick bar's own copy button already toasts `Copied message text` for the identical action, so a silent menu entry beside it read as a bug. `Copy all paths heard` renders whenever any path exists — `formatAllPathsHeard` returns non-null for `paths.length >= 1` — so it is *not* gated on `>1`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/features/message-menu-items.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildMessageMenuItems } from '../../../../src/renderer/features/message-actions/menuItems';
import type { Message } from '../../../../src/shared/types';

const received = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  key: 'ch:x',
  body: 'hi',
  ts: 0,
  state: 'received',
  fromPublicKeyHex: 'a3f9c1d8',
  ...over,
});

const own = (over: Partial<Message> = {}): Message => ({ id: 'm2', key: 'ch:x', body: 'yo', ts: 0, state: 'sent', ...over });

const opts = {
  senderName: 'nate',
  onViewContact: vi.fn(),
  onBlock: vi.fn(),
  onDelete: vi.fn(),
};

const labels = (entries: ReturnType<typeof buildMessageMenuItems>) =>
  entries.filter((e) => e.kind !== 'separator').map((e) => (e as { label: string }).label);

describe('buildMessageMenuItems', () => {
  it('offers Delete message on a received message', () => {
    expect(labels(buildMessageMenuItems({ ...opts, message: received(), isSelf: false }))).toContain('Delete message');
  });

  it('offers Delete message on your own message', () => {
    expect(labels(buildMessageMenuItems({ ...opts, message: own(), isSelf: true }))).toContain('Delete message');
  });

  it('puts Delete message last and marks it dangerous', () => {
    const entries = buildMessageMenuItems({ ...opts, message: received(), isSelf: false });
    const last = entries[entries.length - 1];
    expect(last.kind !== 'separator' && last.label).toBe('Delete message');
    expect(last.kind !== 'separator' && last.danger).toBe(true);
  });

  it('calls onDelete with the message', () => {
    const onDelete = vi.fn();
    const entries = buildMessageMenuItems({ ...opts, onDelete, message: received(), isSelf: false });
    const item = entries.find((e) => e.kind !== 'separator' && e.label === 'Delete message');
    if (item?.kind === 'separator' || !item) throw new Error('no delete item');
    item.onClick();
    expect(onDelete).toHaveBeenCalledWith(received());
  });

  it('omits Block sender on your own message', () => {
    expect(labels(buildMessageMenuItems({ ...opts, message: own(), isSelf: true }))).not.toContain('Block sender…');
  });

  it('offers Block sender on a received message', () => {
    expect(labels(buildMessageMenuItems({ ...opts, message: received(), isSelf: false }))).toContain('Block sender…');
  });

  it('offers the pubkey and contact items only for a real pubkey', () => {
    const named = labels(buildMessageMenuItems({ ...opts, message: received({ fromPublicKeyHex: 'name:nate' }), isSelf: false }));
    expect(named).not.toContain('View contact');
    expect(named).not.toContain('Copy public key');
  });

  it('offers both path items when a path was heard', () => {
    const withPath = received({
      meta: {
        paths: [{ id: 'p', hashMode: 1, finalSnr: 0, hops: [{ kind: 'origin', shortId: 'a3' }] }],
      },
    });
    const got = labels(buildMessageMenuItems({ ...opts, message: withPath, isSelf: false }));
    expect(got).toContain('Copy first path heard');
    expect(got).toContain('Copy all paths heard');
  });

  it('omits the path items when no path was heard', () => {
    const got = labels(buildMessageMenuItems({ ...opts, message: received(), isSelf: false }));
    expect(got).not.toContain('Copy first path heard');
  });

  it('offers Re-send only for a failed message with a handler', () => {
    const onResend = vi.fn();
    expect(labels(buildMessageMenuItems({ ...opts, message: own({ state: 'failed' }), isSelf: true, onResend }))).toContain(
      'Re-send',
    );
    expect(labels(buildMessageMenuItems({ ...opts, message: own({ state: 'failed' }), isSelf: true }))).not.toContain('Re-send');
  });

  it('never emits two adjacent separators', () => {
    const entries = buildMessageMenuItems({ ...opts, message: own(), isSelf: true });
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].kind === 'separator' && entries[i - 1].kind === 'separator').toBe(false);
    }
  });

  it('never starts or ends with a separator', () => {
    const entries = buildMessageMenuItems({ ...opts, message: own(), isSelf: true });
    expect(entries[0].kind).not.toBe('separator');
    expect(entries[entries.length - 1].kind).not.toBe('separator');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/features/message-menu-items.test.ts`
Expected: FAIL — no `Delete message` item; `isSelf` / `onDelete` are not accepted.

- [ ] **Step 3: Rewrite the producer**

Replace the whole body of `src/renderer/features/message-actions/menuItems.ts` with:

```ts
import { Copy, KeyRound, Radio, RotateCw, ShieldOff, Trash2, User, Waypoints } from 'lucide-react';
import type { Message } from '../../../shared/types';
import type { BlockSenderDialogPrefill } from '../../components/BlockSenderDialog';
import { type ContextMenuEntry, copyToClipboard, menuItem, menuSeparator } from '../../components/ContextMenu';
import { notify } from '../../lib/notify';
import { formatAllPathsHeard, formatFirstPathHeard } from './paths';

export interface BuildMessageMenuOpts {
  message: Message;
  isSelf: boolean;
  senderName: string | undefined;
  onViewContact: (key: string) => void;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  onDelete: (message: Message) => void;
  onResend?: (m: Message) => void;
}

/** Push `entry` only when the list doesn't already end with a separator, so a
 *  group whose items were all filtered out doesn't leave a double rule. */
function pushSeparator(items: ContextMenuEntry[]): void {
  if (items.length > 0 && items[items.length - 1].kind !== 'separator') items.push(menuSeparator);
}

/** The one item set behind both the right-click menu and the action-bar
 *  overflow menu. Two renderers, one list. */
export function buildMessageMenuItems({
  message,
  isSelf,
  senderName,
  onViewContact,
  onBlock,
  onDelete,
  onResend,
}: BuildMessageMenuOpts): ContextMenuEntry[] {
  const copy = (text: string, label: string) => copyToClipboard(text, () => notify.success(label));

  // Toasts like its siblings and like the quick bar's own copy button, which
  // fires the same 'Copied message text' for the same action.
  const items: ContextMenuEntry[] = [menuItem('Copy text', () => copy(message.body, 'Copied message text'), { icon: Copy })];

  const rawPk = message.fromPublicKeyHex;
  const hasRealPubkey = rawPk != null && rawPk !== 'unknown' && !rawPk.startsWith('name:');
  const firstPath = formatFirstPathHeard(message);
  const allPaths = formatAllPathsHeard(message);

  if (hasRealPubkey || firstPath || allPaths) pushSeparator(items);
  if (hasRealPubkey) {
    items.push(menuItem('View contact', () => onViewContact(`c:${rawPk}`), { icon: User }));
    items.push(menuItem('Copy public key', () => copy(rawPk, 'Copied public key'), { icon: KeyRound }));
  }
  if (firstPath) {
    items.push(menuItem('Copy first path heard', () => copy(firstPath, 'Copied first path'), { icon: Waypoints }));
  }
  if (allPaths) {
    items.push(menuItem('Copy all paths heard', () => copy(allPaths, 'Copied all paths'), { icon: Radio }));
  }

  const canResend = message.state === 'failed' && onResend != null;
  if (canResend || !isSelf) pushSeparator(items);
  if (canResend && onResend) {
    items.push(menuItem('Re-send', () => onResend(message), { icon: RotateCw }));
  }
  if (!isSelf) {
    // Origin hop pk would carry an advert-resolved pubkey, but the current
    // path-build pipeline never populates it for channel messages — it's always
    // null. Treat it as the authoritative source if a future change wires it.
    const originHop = message.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
    const pubkey = hasRealPubkey ? rawPk : (originHop?.pk ?? undefined);
    // Prefix is the first 4 hex chars of the real pubkey. originHop.shortId
    // is a 2-char name-derived display label (NOT hex), so we don't use it as
    // a pubkey prefix — that would silently create rules like pattern='sr'
    // that match by name lookalike, which is misleading.
    const prefix = hasRealPubkey ? rawPk.slice(0, 4) : (originHop?.pk?.slice(0, 4) ?? undefined);
    items.push(
      menuItem('Block sender…', () => onBlock({ pubkey, pubkeyPrefix: prefix, name: senderName || undefined }), {
        icon: ShieldOff,
      }),
    );
  }

  pushSeparator(items);
  items.push(
    menuItem('Delete message', () => onDelete(message), {
      icon: Trash2,
      danger: true,
      testid: 'delete-message-menu-item',
    }),
  );

  return items;
}
```

- [ ] **Step 4: Pass the two new args from `MessageList`**

`isSelf` is already computed in this file as `m.fromPublicKeyHex === undefined`. At the `buildMessageMenuItems({ … })` call site, add:

```ts
        isSelf: menu.message.fromPublicKeyHex === undefined,
        onDelete: (m) => {
          setMenu(null);
          useStore.getState().setPendingDeleteMessageId(m.id);
        },
```

`useStore` is already imported in `MessageList.tsx`. If the call site's local variable for the menu state is not named `menu`, use whatever `MessageList` already calls it — the object passed to `<ContextMenu items={…}>`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/features/message-menu-items.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Format, typecheck, all projects**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/message-actions/menuItems.ts src/renderer/components/MessageList.tsx tests/unit/renderer/features/message-menu-items.test.ts
git commit -m "feat(message-actions): one item set for both menus, with Delete message"
```

---

## Task 8: `OverflowMenu` renders the shared item set

**Files:**
- Modify: `src/renderer/features/message-actions/OverflowMenu.tsx`
- Modify: `src/renderer/features/message-actions/MessageQuickBar.tsx` (pass the new props)
- Modify: `tests/component/overflow-menu.test.tsx` (add cases)

**Interfaces:**
- Consumes: `buildMessageMenuItems` (Task 7); `setPendingDeleteMessageId` (Task 5).
- Produces: `OverflowMenu` props become `{ message, isSelf, senderName, onBlock, onResend?, open, onOpenChange, children }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/component/overflow-menu.test.tsx`, **after** the `});` that closes the `'view contact routes to the sender'` test and **before** the file's final `});`:

```tsx
  test('offers Delete message and stages it for confirmation', () => {
    useStore.setState({ pendingDeleteMessageId: null });
    render(
      <OverflowMenu message={message} isSelf={false} senderName="nate" onBlock={() => {}} open onOpenChange={() => {}}>
        <button type="button">⋯</button>
      </OverflowMenu>,
    );
    fireEvent.click(screen.getByText('Delete message'));
    expect(useStore.getState().pendingDeleteMessageId).toBe('m1');
  });

  test('no longer offers the retired Dismiss locally item', () => {
    render(
      <OverflowMenu message={message} isSelf={false} senderName="nate" onBlock={() => {}} open onOpenChange={() => {}}>
        <button type="button">⋯</button>
      </OverflowMenu>,
    );
    expect(screen.queryByText('Dismiss locally')).toBeNull();
  });

  test('omits Block sender on your own message', () => {
    const mine: Message = { id: 'm9', key: 'ch:x', body: 'yo', ts: 0, state: 'sent' };
    render(
      <OverflowMenu message={mine} isSelf senderName={undefined} onBlock={() => {}} open onOpenChange={() => {}}>
        <button type="button">⋯</button>
      </OverflowMenu>,
    );
    expect(screen.queryByText('Block sender…')).toBeNull();
    expect(screen.getByText('Delete message')).toBeTruthy();
  });
```

Also update the two existing `<OverflowMenu …>` renders in this file to pass the new required props — `isSelf={false} senderName="nate" onBlock={() => {}}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/overflow-menu.test.tsx`
Expected: FAIL — no `Delete message` text; TypeScript rejects the new props.

- [ ] **Step 3: Rewrite `OverflowMenu`**

Replace the whole of `src/renderer/features/message-actions/OverflowMenu.tsx` with:

```tsx
import type { ReactNode } from 'react';
import type { Message } from '../../../shared/types';
import type { BlockSenderDialogPrefill } from '../../components/BlockSenderDialog';
import type { ContextMenuEntry } from '../../components/ContextMenu';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { useStore } from '../../lib/store';
import { buildMessageMenuItems } from './menuItems';

interface Props {
  message: Message;
  isSelf: boolean;
  senderName: string | undefined;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  onResend?: (m: Message) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** The action bar's "…" dropdown. Renders the same ContextMenuEntry[] the
 *  right-click menu does — two renderers, one item list. */
export function OverflowMenu({ message, isSelf, senderName, onBlock, onResend, open, onOpenChange, children }: Props) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const setPendingDeleteMessageId = useStore((s) => s.setPendingDeleteMessageId);

  const close = () => onOpenChange(false);
  const items = buildMessageMenuItems({
    message,
    isSelf,
    senderName,
    onViewContact: (key) => setActiveKey(key),
    onBlock,
    onDelete: (m) => setPendingDeleteMessageId(m.id),
    onResend,
  });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[216px] border-cs-border-strong bg-cs-bg-2 p-1">
        {items.map((entry, i) =>
          entry.kind === 'separator' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: separators carry no identity
            <div key={`sep-${i}`} className="my-1 h-px bg-cs-border" />
          ) : (
            <MenuButton
              key={entry.label}
              entry={entry}
              onRun={() => {
                entry.onClick();
                close();
              }}
            />
          ),
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuButton({ entry, onRun }: { entry: Exclude<ContextMenuEntry, { kind: 'separator' }>; onRun: () => void }) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      disabled={entry.disabled}
      onClick={onRun}
      data-testid={entry.testid}
      className={[
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
        entry.disabled ? 'cursor-default opacity-45' : 'hover:bg-cs-bg-3',
        entry.danger ? 'text-cs-danger hover:bg-cs-danger/10' : 'text-cs-text',
      ].join(' ')}
    >
      <span className={entry.danger ? 'text-cs-danger' : 'text-cs-text-muted'}>{Icon ? <Icon size={15} /> : null}</span>
      <span className="flex-1">{entry.label}</span>
    </button>
  );
}
```

> If `ContextMenuEntry`'s item member is exported under a name (e.g. `ContextMenuItem`), import and use that instead of the inline `Exclude<…>`.

- [ ] **Step 4: Pass the new props from `MessageQuickBar`**

`MessageQuickBar` already receives `message`, `isSelf`, and `senderName`. It needs `onBlock` (and optionally `onResend`) threaded from `MessageItem` ← `MessageRow` ← `MessageList`, which already owns `setBlockPrefill`. Add an `onBlock: (prefill: BlockSenderDialogPrefill) => void` prop to `MessageQuickBar`, `MessageItem`, and `MessageRow`, wire it from `MessageList`'s existing block handler, then update the call site:

```tsx
            <OverflowMenu message={message} isSelf={isSelf} senderName={senderName} onBlock={onBlock} {...P('more')}>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/overflow-menu.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Format, typecheck, all projects**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/message-actions/OverflowMenu.tsx src/renderer/features/message-actions/MessageQuickBar.tsx src/renderer/components/MessageItem.tsx src/renderer/components/MessageRow.tsx src/renderer/components/MessageList.tsx tests/component/overflow-menu.test.tsx
git commit -m "feat(message-actions): render the overflow menu from the shared item set"
```

---

## Task 9: The confirmation popover

**Files:**
- Create: `src/renderer/features/message-actions/DeleteConfirmPopover.tsx`
- Modify: `src/renderer/components/MessageItem.tsx` (render it on the row wrapper)
- Modify: `src/renderer/components/MessageList.tsx` (clear `pendingDeleteMessageId` on conversation switch)
- Test: `tests/component/delete-message.test.tsx` (extend)

**Interfaces:**
- Consumes: `pendingDeleteMessageId`, `setPendingDeleteMessageId`, `api.deleteMessage` (Task 5).
- Produces: `<DeleteConfirmPopover messageId={string} conversationKey={string} preview={string} client={ApiClient | null} />` — renders nothing unless `pendingDeleteMessageId === messageId`.

- [ ] **Step 1: Write the failing test**

Append to `tests/component/delete-message.test.tsx`. Add these imports at the top of the file (the `vi.mock` must sit above the value imports):

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { DeleteConfirmPopover } from '@/features/message-actions/DeleteConfirmPopover';
import { type ApiClient, api } from '@/lib/api';
```

and append this suite:

```tsx
const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };

describe('DeleteConfirmPopover', () => {
  it('renders nothing until its message is staged', () => {
    useStore.setState({ pendingDeleteMessageId: null });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    expect(screen.queryByTestId('confirm-delete-message')).toBeNull();
  });

  it('deletes through the API when confirmed', async () => {
    const spy = vi.spyOn(api, 'deleteMessage').mockResolvedValue({ ok: true });
    useStore.setState({ pendingDeleteMessageId: 'b' });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    fireEvent.click(await screen.findByTestId('confirm-delete-message'));
    expect(spy).toHaveBeenCalledWith(client, 'ch:x', 'b');
  });

  it('does not delete when cancelled, and unstages the message', async () => {
    const spy = vi.spyOn(api, 'deleteMessage').mockResolvedValue({ ok: true });
    useStore.setState({ pendingDeleteMessageId: 'b' });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    fireEvent.click(await screen.findByTestId('cancel-delete-message'));
    expect(spy).not.toHaveBeenCalled();
    expect(useStore.getState().pendingDeleteMessageId).toBeNull();
  });

  it('says the delete is local only', async () => {
    useStore.setState({ pendingDeleteMessageId: 'b' });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    const panel = await screen.findByTestId('delete-confirm-panel');
    expect(panel.textContent).toMatch(/this device only/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/delete-message.test.tsx`
Expected: FAIL — cannot resolve `@/features/message-actions/DeleteConfirmPopover`.

- [ ] **Step 3: Create the component**

Create `src/renderer/features/message-actions/DeleteConfirmPopover.tsx`:

```tsx
import { Button } from '../../components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '../../components/ui/popover';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';

interface Props {
  messageId: string;
  conversationKey: string;
  /** Message body, shown truncated so the user sees what they're deleting. */
  preview: string;
  client: ApiClient | null;
}

const PREVIEW_MAX = 80;

/** Anchored delete confirmation, rendered by the message row itself. Living
 *  inside the row means Virtuoso recycling unmounts the confirm along with the
 *  row rather than orphaning a detached anchor — at the cost of dismissing the
 *  confirm when the message scrolls far out of view. */
export function DeleteConfirmPopover({ messageId, conversationKey, preview, client }: Props) {
  const open = useStore((s) => s.pendingDeleteMessageId === messageId);
  const setPendingDeleteMessageId = useStore((s) => s.setPendingDeleteMessageId);

  if (!open) return null;

  const snippet = preview.length > PREVIEW_MAX ? `${preview.slice(0, PREVIEW_MAX)}…` : preview;

  const confirm = async () => {
    setPendingDeleteMessageId(null);
    if (!client) return;
    try {
      await api.deleteMessage(client, conversationKey, messageId);
      notify.success('Message deleted');
    } catch (err) {
      notify.error(`Couldn’t delete message: ${(err as Error).message}`, err);
    }
  };

  return (
    <Popover open onOpenChange={(next) => !next && setPendingDeleteMessageId(null)}>
      <PopoverAnchor />
      <PopoverContent
        align="end"
        side="top"
        className="w-72 p-3"
        data-testid="delete-confirm-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[12.5px] text-cs-text">Delete this message?</p>
        <p className="mt-1 line-clamp-2 text-[12px] italic text-cs-text-muted">“{snippet}”</p>
        <p className="mt-2 text-[11.5px] text-cs-text-muted">
          This deletes it from this device only, and can’t be undone. It stays on other devices that received it.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" data-testid="cancel-delete-message" onClick={() => setPendingDeleteMessageId(null)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" data-testid="confirm-delete-message" onClick={confirm}>
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

> Cancel is first in DOM order so Radix's default open-focus lands on it: Escape dismisses, Enter cancels, Delete needs a deliberate click or Tab. Do **not** add `onOpenAutoFocus={(e) => e.preventDefault()}` — that is what leaves the macro-row confirm with no keyboard path.

- [ ] **Step 4: Render it from the row**

In `src/renderer/components/MessageItem.tsx`, inside the `className="group relative px-3 py-0.5"` wrapper, immediately after the `{interactive && onReact && (<MessageQuickBar … />)}` block:

```tsx
      {interactive && (
        <DeleteConfirmPopover
          messageId={message.id}
          conversationKey={message.key}
          preview={message.body}
          client={client ?? null}
        />
      )}
```

with `import { DeleteConfirmPopover } from '../features/message-actions/DeleteConfirmPopover';`.

> Gated on `interactive` only, **not** `onReact` — the repeater tab and any future caller that wires `onSelect` but no reactions still gets a working confirm for its right-click delete.

- [ ] **Step 5: Clear it on conversation switch**

In `src/renderer/components/MessageList.tsx`, in the effect that resets `menu` / `flashId` / `blockPrefill` on a conversation change, add:

```ts
    useStore.getState().setPendingDeleteMessageId(null);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/delete-message.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 7: Format, typecheck, all projects**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/features/message-actions/DeleteConfirmPopover.tsx src/renderer/components/MessageItem.tsx src/renderer/components/MessageList.tsx tests/component/delete-message.test.tsx
git commit -m "feat(message-actions): anchored delete confirmation"
```

---

## Task 10: Give own messages the overflow menu

**Files:**
- Modify: `src/renderer/features/message-actions/MessageQuickBar.tsx`
- Test: `tests/component/message-quick-bar.test.tsx` (extend)

**Interfaces:** consumes Task 8's `OverflowMenu` props. Produces no new API.

- [ ] **Step 1: Write the failing test**

Append to `tests/component/message-quick-bar.test.tsx` (match that file's existing `test`/`it` style and its existing render helper):

```tsx
  test('own messages get the overflow menu, not a bare Delete button', () => {
    renderBar(mine, true);
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  test('received messages still get the overflow menu', () => {
    renderBar(other, false);
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
  });
```

Use whatever render helper the file already defines; if it renders `<MessageQuickBar>` inline, copy that call and pass `isSelf`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/message-quick-bar.test.tsx`
Expected: FAIL — no `More` button on the own-message branch.

- [ ] **Step 3: Swap the stub for the menu**

In `src/renderer/features/message-actions/MessageQuickBar.tsx`, in the `isSelf` branch, replace:

```tsx
            <IconBtn label="Delete" soon className="text-cs-danger hover:bg-cs-danger/10 hover:text-cs-danger">
              <Trash2 size={16} aria-hidden="true" />
            </IconBtn>
```

with:

```tsx
            <OverflowMenu message={message} isSelf={isSelf} senderName={senderName} onBlock={onBlock} {...P('more')}>
              <button
                type="button"
                aria-label="More"
                className="flex h-8 w-8 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            </OverflowMenu>
```

Remove the now-unused `Trash2` import if nothing else in the file uses it. If `IconBtn`'s `soon` prop now has no users anywhere, leave it — it is a general-purpose affordance, not part of this feature.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/message-quick-bar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Format, typecheck, all projects**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/message-actions/MessageQuickBar.tsx tests/component/message-quick-bar.test.tsx
git commit -m "feat(message-actions): overflow menu on own messages"
```

---

## Task 11: Delete from search results

**Files:**
- Modify: `src/renderer/panels/search/MessageRow.tsx` (delete button + confirm)
- Modify: `src/renderer/panels/search/index.tsx` (drop deleted hits from local state)
- Test: `tests/component/delete-message.test.tsx` (extend)

**Interfaces:**
- Consumes: `DeleteConfirmPopover` (Task 9), `setPendingDeleteMessageId` (Task 5).
- Produces: the export is renamed `MessageRow` → `SearchMessageRow`, and its props go from
  `{ hit, channelName, senderName, onClick }` to
  `{ hit, channelName, senderName, onClick, client: ApiClient | null, onDeleted: (id: string) => void }`.

> **Two structural facts to respect.** The current root is `<li>` wrapping a single full-width
> `<button onClick=…>` — so the delete control must be a **sibling** of that button inside the `<li>`,
> never nested inside it (nested interactive elements are invalid HTML and break the a11y tree). Put
> `group relative` on the `<li>`. And `senderName` is currently `string`, not optional — keep it as-is.

> **Scope note:** `MainPane` renders either the search panel or a conversation view, never both, and the panel unmounts on navigation — so the only way to strand a hit in practice is deleting from within the panel itself, which `onDeleted` covers. A second WS client deleting while this panel is open leaves a stale hit until the next query; that is an accepted limitation, not a bug to plumb around.

- [ ] **Step 1: Write the failing test**

Append to `tests/component/delete-message.test.tsx`:

```tsx
describe('search result delete', () => {
  it('exposes a delete affordance per hit and stages it', async () => {
    const { SearchMessageRow } = await import('@/panels/search/MessageRow');
    useStore.setState({ pendingDeleteMessageId: null });
    render(
      <SearchMessageRow
        hit={{ id: 'h1', key: 'ch:x', ts: 0, fromPublicKeyHex: null, body: 'found me', snippet: 'found <mark>me</mark>', score: 1 }}
        channelName="x"
        senderName="nate"
        onClick={() => {}}
        client={client}
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('search-delete-message'));
    expect(useStore.getState().pendingDeleteMessageId).toBe('h1');
  });

  it('reports the deletion so the panel can drop the hit', async () => {
    const { SearchMessageRow } = await import('@/panels/search/MessageRow');
    const spy = vi.spyOn(api, 'deleteMessage').mockResolvedValue({ ok: true });
    const onDeleted = vi.fn();
    useStore.setState({ pendingDeleteMessageId: 'h1' });
    render(
      <SearchMessageRow
        hit={{ id: 'h1', key: 'ch:x', ts: 0, fromPublicKeyHex: null, body: 'found me', snippet: 'found me', score: 1 }}
        channelName="x"
        senderName="nate"
        onClick={() => {}}
        client={client}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(await screen.findByTestId('confirm-delete-message'));
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(client, 'ch:x', 'h1'));
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith('h1'));
  });
});
```

> The component in `panels/search/MessageRow.tsx` is currently named `MessageRow`, colliding with `components/MessageRow.tsx`. Rename the export to `SearchMessageRow` as part of this task and update `ResultsList.tsx`; the collision has already caused confusion once.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/delete-message.test.tsx`
Expected: FAIL — no `SearchMessageRow` export, no `search-delete-message` testid.

- [ ] **Step 3: Add the affordance to the search row**

In `src/renderer/panels/search/MessageRow.tsx`: rename the export to `SearchMessageRow`, add `client: ApiClient | null` and `onDeleted: (id: string) => void` props, put `className="group relative"` on the root `<li>`, and add the following **as siblings of the existing `<button>`, inside the `<li>`** — not nested within it:

```tsx
      <button
        type="button"
        aria-label="Delete message"
        data-testid="search-delete-message"
        onClick={(e) => {
          e.stopPropagation();
          setPendingDeleteMessageId(hit.id);
        }}
        className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-danger/10 hover:text-cs-danger group-hover:flex"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
      <DeleteConfirmPopover
        messageId={hit.id}
        conversationKey={hit.key}
        preview={hit.body}
        client={client}
        onDeleted={() => onDeleted(hit.id)}
      />
```

Use `hit.body`, **not** `hit.snippet` — the snippet carries `<mark>` tags meant for `dangerouslySetInnerHTML`.

Then update `src/renderer/panels/search/ResultsList.tsx`: change the import and the JSX tag to `SearchMessageRow`, and thread `client` and `onDeleted` through. The rename also resolves a real name collision with `src/renderer/components/MessageRow.tsx`.

- [ ] **Step 4: Add the `onDeleted` callback to the confirm**

In `src/renderer/features/message-actions/DeleteConfirmPopover.tsx`, add an optional prop and fire it after a successful delete:

```tsx
  /** Called after the server confirms the delete. The conversation views need
   *  nothing here (the messagesDeleted WS event updates the store), but the
   *  search panel holds its hits in local state and must splice its own. */
  onDeleted?: () => void;
```

and in `confirm()`, immediately after `notify.success('Message deleted');`:

```tsx
      onDeleted?.();
```

- [ ] **Step 5: Splice the panel's local state**

In `src/renderer/panels/search/index.tsx`, pass a handler down through `ResultsList` to each row:

```tsx
  const handleDeleted = useCallback((id: string) => {
    setMessages((prev) => prev.filter((h) => h.id !== id));
    setTotalMessages((prev) => Math.max(0, prev - 1));
  }, []);
```

Thread `client` and `onDeleted={handleDeleted}` through `ResultsList` to `SearchMessageRow`. `useCallback` is likely already imported; add it if not.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/delete-message.test.tsx`
Expected: PASS, 13 tests.

- [ ] **Step 7: Format, typecheck, all projects**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/panels/search src/renderer/features/message-actions/DeleteConfirmPopover.tsx tests/component/delete-message.test.tsx
git commit -m "feat(search): delete a message from its search result"
```

---

## Task 12: Virtuoso removal branch and dead-code removal

**Files:**
- Modify: `src/renderer/components/MessageList.tsx` (explicit removal branch)
- Delete: `src/renderer/panels/repeater-admin/MessagesTab.tsx`
- Test: `tests/component/delete-message.test.tsx` (extend)

**Interfaces:** none new.

- [ ] **Step 1: Confirm the file really is orphaned**

```bash
grep -rn "MessagesTab" src/ tests/
```
Expected: exactly one hit — its own `export function MessagesTab` line. If anything else appears, **stop** and report; the spec's claim would be wrong.

- [ ] **Step 2: Write the failing test**

Append to `tests/component/delete-message.test.tsx`:

```tsx
describe('removeMessages and the rendered list', () => {
  it('leaves an empty array when the last message goes', () => {
    useStore.setState({ messagesByKey: { 'ch:x': [msg('only')] } });
    useStore.getState().removeMessages('ch:x', ['only']);
    expect(useStore.getState().messagesByKey['ch:x']).toEqual([]);
  });

  it('preserves order of the remaining messages', () => {
    useStore.setState({ messagesByKey: { 'ch:x': [msg('a'), msg('b'), msg('c'), msg('d')] } });
    useStore.getState().removeMessages('ch:x', ['b', 'c']);
    expect(useStore.getState().messagesByKey['ch:x'].map((m) => m.id)).toEqual(['a', 'd']);
  });
});
```

- [ ] **Step 3: Run test to verify it passes or fails**

Run: `npx vitest run --project dom tests/component/delete-message.test.tsx`
Expected: PASS — Task 5's `removeMessages` already satisfies these. They exist to pin the contract the Virtuoso branch depends on. If either fails, fix `removeMessages` before continuing.

> **Known coverage gap.** The spec asked for a test that deleting the last message of an *open*
> conversation renders an empty state. That requires mounting `MessageList` with
> `@virtuoso.dev/message-list` under jsdom and driving its imperative handle — no existing test does
> this, and the library's measurement path is unreliable there. These two store-level tests pin the
> input contract instead; the actual empty-state rendering is covered by step 1 of the manual smoke
> test in Final Verification. If you find a way to mount Virtuoso reliably, replace these.

- [ ] **Step 4: Add the explicit removal branch**

In `src/renderer/components/MessageList.tsx`'s Virtuoso sync effect, before the final fallback `replace`, add a branch for "same key, strictly fewer messages, and every surviving id was already present":

```ts
    // A deletion shrinks the array. Without this it lands on the fallback
    // replace below, which works but rebuilds the whole list for one row.
    if (next.length < prev.length && next.every((m) => prevIds.has(m.id))) {
      ref.current?.data.replace(buildItems(next, computeFirstUnreadIdx(next, cutoff)));
      prevRef.current = next;
      return;
    }
```

Adapt the identifiers to whatever the effect already uses for the Virtuoso handle, the previous list, and the unread cutoff — do not introduce new names. If the effect has no `prevIds` set, derive one: `const prevIds = new Set(prev.map((m) => m.id));`.

- [ ] **Step 5: Delete the orphaned file**

```bash
git rm src/renderer/panels/repeater-admin/MessagesTab.tsx
```

- [ ] **Step 6: Format, typecheck, all projects, lint**

```bash
npx biome check --write src tests
npx tsc --noEmit
npx vitest run
```
Expected: all three projects pass; no unused-import errors from the deletion.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/MessageList.tsx tests/component/delete-message.test.tsx
git commit -m "feat(renderer): explicit list-removal branch; drop orphaned MessagesTab"
```

---

## Final verification

- [ ] **Full suite, typecheck, lint**

```bash
npx tsc --noEmit
npx biome check src tests
npx vitest run
```

- [ ] **Manual smoke test in the real app**

```bash
npx electron-forge package
```
Then launch with `CORESENSE_FAKE_TRANSPORT` and a seeded `messages.db`, and confirm by hand:
1. Right-click a channel message → **Delete message** → confirm → the row disappears.
2. Hover a message → **…** → **Delete message** → cancel → nothing is deleted.
3. Your own message offers **…** with **Delete message** and **no** Block sender.
4. Search for a message, delete it from the result row, and confirm the hit disappears and the count drops.
5. Delete the newest message in a channel and confirm **no** OS notification appears for the previous one.
6. Restart the app and confirm the deleted message has not returned.

> Per project memory: quit the installed CoreSense app first — it steals loopback `:7654` on macOS.
