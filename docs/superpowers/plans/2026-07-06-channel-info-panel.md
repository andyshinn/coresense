# Channel Info Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the right-rail Channel info panel into four collapsible sections (Channel info, Activity, People, Share) backed by a new SQLite channel-stats endpoint, a `Channel.createdAt` field, a reusable `<ColoredUsername>` component, and a `meshcore://` channel QR share.

**Architecture:** Aggregate stats come from a new `messagesStore.statsByKey` query surfaced through `stateHolder().getChannelStats` and a Hono route `GET /api/channels/:key/stats`, fetched lazily by a `useChannelStats` hook that only runs when its section is expanded (the rail's `Collapsible` mounts children only when open). Presentational logic lives in pure `*Body` components tested directly with props; thin container sections wire the hooks. The `meshcore://channel/add?name=…&secret=…` URI is built by a pure helper and rendered as an inline-SVG QR via `react-qr-code` (CSP-safe).

**Tech Stack:** Electron + React 19, Zustand store, Hono API, `node:sqlite` (`DatabaseSync`), Vitest 4 (projects: `unit`/`integration` node, `dom` jsdom), Biome 2.5, Tailwind v4 with `cs-*` design tokens, pnpm.

## Global Constraints

- Package manager is **pnpm**. Run everything from repo root `/Users/andy/GitHub/andyshinn/coresense`.
- Test runner is **Vitest 4** with three projects. `globals` is OFF — every test file imports `describe/it/test/expect/vi` from `vitest`. Path alias `@` → `src/renderer` (works in all projects); unit tests use relative source imports, component tests may use `@`.
- No `@testing-library/jest-dom` — assert with `.toBeTruthy()`, `screen.getByText`, `container.querySelector*`, `.toBe(...)`. NOT `toBeInTheDocument`.
- Component tests live in `tests/component/**/*.test.tsx` (`dom` project, jsdom). Store mocking is `useStore.setState({...})` from `@/lib/store`. `cleanup()` + `matchMedia` stub are global (`tests/component/setup.ts`).
- Integration (SQLite) tests live in `tests/integration/**/*.test.ts` (`node` project). `tests/integration/setup.ts` gives each test a fresh temp userData dir + reset DB automatically — no per-file DB boilerplate.
- Lint MUST be scoped: `pnpm exec biome check src tests` (repo-wide `pnpm lint` fails on build artifacts). Biome uses the `recommended` preset — `noArrayIndexKey` and `useExhaustiveDependencies` are active; suppress with a reasoned `// biome-ignore lint/<rule>: <reason>` (see SignalBars.tsx / Composer.tsx precedents). Biome errors on *unused* suppressions, so only add an ignore where the rule actually fires.
- Biome formatting: single quotes, double JSX quotes, trailing commas all, semicolons always, 2-space indent, print width 125.
- Typecheck: `pnpm typecheck` (= `tsc --noEmit`).
- `Date.now()` / `new Date()` are allowed in app + main code (this is NOT a workflow script).
- CSP allows only inline SVG / `data:` / `blob:` images — the QR must render as inline `<svg>` (`react-qr-code`), never an external image service.
- **Do NOT migrate `MentionPill`** to `<ColoredUsername>` — it stays intentionally neutral. **Do NOT add pinning** controls.
- Every `git commit` message ends with the trailer (shown once; append it to every commit in this plan):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- All work happens on the existing branch `feat/channel-info-panel`.

---

## File Structure

**Shared**
- `src/shared/types.ts` — add `Channel.createdAt?: number`; add `ChannelSenderStat` + `ChannelStats` interfaces.

**Main process**
- `src/main/storage/messages.ts` — add `statsByKey(key, now?)`.
- `src/main/state/holder.ts` — add `getChannelStats(key)`.
- `src/main/api/routes.ts` — add `GET /api/channels/:key/stats`.
- `src/main/protocol/mergeChannels.ts` — stamp/preserve `createdAt`.

**Renderer — libs/hooks**
- `src/renderer/lib/api.ts` — add `getChannelStats`.
- `src/renderer/lib/time.ts` — add `fmtDate`.
- `src/renderer/lib/channelShare.ts` — NEW `buildChannelShareUri`.
- `src/renderer/hooks/useChannelStats.ts` — NEW hook.
- `src/renderer/components/AddChannelPopover.tsx` — stamp `createdAt`.

**Renderer — components**
- `src/renderer/components/ColoredUsername.tsx` — NEW.
- `src/renderer/components/SenderLabel.tsx` — DELETE after migration.
- `src/renderer/components/MessageItem.tsx` — migrate 2 usages.
- `src/renderer/components/Sparkline.tsx` — NEW.
- `src/renderer/components/SecretField.tsx` — NEW.

**Renderer — rail sections**
- `src/renderer/shell/rightrail/sections/ChannelInfo.tsx` — rewrite (Overview).
- `src/renderer/shell/rightrail/sections/ChannelActivity.tsx` — NEW.
- `src/renderer/shell/rightrail/sections/ChannelPeople.tsx` — NEW.
- `src/renderer/shell/rightrail/sections/ChannelShare.tsx` — NEW.
- `src/renderer/shell/rightrail/sectionsFor.tsx` — register four sections.

**Deps**
- `package.json` — add `react-qr-code`.

---

## Task 1: `Channel.createdAt` field + stamping

**Files:**
- Modify: `src/shared/types.ts` (Channel interface, lines 68-83)
- Modify: `src/main/protocol/mergeChannels.ts:33`
- Modify: `src/renderer/components/AddChannelPopover.tsx:165,206-229`
- Test: `tests/unit/main/protocol/mergeChannels.test.ts`

**Interfaces:**
- Produces: `Channel.createdAt?: number` (epoch ms). `mergeSyncedChannels(prev, incoming)` now sets `createdAt: existing?.createdAt ?? Date.now()`.

- [ ] **Step 1: Add the field to the type.** In `src/shared/types.ts`, inside the `Channel` interface (after the `order?` field, before the closing `}` at line ~83), add:

```ts
  /** App-owned: epoch ms when this channel was first added (user create or
   *  first radio-sync). Absent on channels created before this field existed. */
  createdAt?: number;
```

- [ ] **Step 2: Write the failing test** at `tests/unit/main/protocol/mergeChannels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Channel } from '../../../../src/shared/types';
import { mergeSyncedChannels } from '../../../../src/main/protocol/mergeChannels';

const ch = (over: Partial<Channel> = {}): Channel => ({
  key: 'ch:General',
  name: 'General',
  kind: 'hashtag',
  ...over,
});

describe('mergeSyncedChannels createdAt', () => {
  it('stamps createdAt on a first-seen radio channel', () => {
    const before = Date.now();
    const [merged] = mergeSyncedChannels([], [ch()]);
    expect(typeof merged.createdAt).toBe('number');
    expect(merged.createdAt as number).toBeGreaterThanOrEqual(before);
  });

  it('preserves an existing createdAt across a re-sync', () => {
    const prev = [ch({ createdAt: 1000 })];
    const [merged] = mergeSyncedChannels(prev, [ch({ name: 'General renamed' })]);
    expect(merged.createdAt).toBe(1000);
    expect(merged.name).toBe('General renamed'); // radio-owned field still updates
  });

  it('carries a not-re-enumerated channel through untouched', () => {
    const prev = [ch({ key: 'ch:Only', name: 'Only', createdAt: 2000 })];
    const merged = mergeSyncedChannels(prev, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].createdAt).toBe(2000);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/main/protocol/mergeChannels.test.ts`
Expected: FAIL — first test's `merged.createdAt` is `undefined` (`typeof` is `'undefined'`, not `'number'`).

- [ ] **Step 4: Implement the stamp.** In `src/main/protocol/mergeChannels.ts`, in the `.map` return object (currently lines 29-36), add the `createdAt` line alongside `muted`/`pinned`:

```ts
    return {
      ...ch,
      order: existing?.order ?? ch.idx,
      muted: existing?.muted,
      pinned: existing?.pinned,
      createdAt: existing?.createdAt ?? Date.now(),
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/main/protocol/mergeChannels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Stamp createdAt on renderer-created channels.** In `src/renderer/components/AddChannelPopover.tsx`, add `createdAt: Date.now()` to **every** `Channel` literal. The `onAdd` block (lines ~213-222) becomes:

```tsx
    if (formView.type === 'create-private') {
      channel = { key, name, kind: 'private', secretHex: generate16ByteHex(), createdAt: Date.now() };
    } else if (formView.type === 'join-private') {
      channel = { key, name, kind: 'private', secretHex: normalizeHex(formView.secretHex), createdAt: Date.now() };
    } else if (formView.type === 'join-hashtag') {
      channel = { key, name, kind: 'hashtag', createdAt: Date.now() };
    } else {
      channel = { key: 'ch:Public', name: 'Public', kind: 'public', createdAt: Date.now() };
    }
```

And the one-tap public path at line ~165:

```tsx
              const channel: Channel = { key: 'ch:Public', name: 'Public', kind: 'public', createdAt: Date.now() };
```

- [ ] **Step 7: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: no errors. (The renderer stamps are covered by typecheck + the merge test; they're trivial literal additions verified end-to-end in Task 16.)

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/protocol/mergeChannels.ts src/renderer/components/AddChannelPopover.tsx tests/unit/main/protocol/mergeChannels.test.ts
git commit -m "feat(channels): add Channel.createdAt stamped on create + first sync"
```

---

## Task 2: `ChannelStats` types + `messagesStore.statsByKey`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/storage/messages.ts` (add method inside `messagesStore`, after `byKey` ~line 87)
- Test: `tests/integration/storage/channel-stats.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ChannelSenderStat { fromPk: string | null; count: number; lastTs: number; }
  interface ChannelStats {
    count: number; firstTs: number | null; lastTs: number | null;
    count24h: number; count7d: number; distinctSenders: number;
    roster: ChannelSenderStat[]; // grouped by from_pk, ordered lastTs DESC
    perDay: number[]; // 7 local-day buckets, oldest→newest, index 6 = today
  }
  ```
  `messagesStore.statsByKey(key: string, now?: number): ChannelStats`

- [ ] **Step 1: Add the shared types.** In `src/shared/types.ts` (near the `Message` types, anywhere at module scope), add:

```ts
export interface ChannelSenderStat {
  /** Raw from_pk: null=self, 'name:<n>'=channel poster, 'unknown', or hex pubkey. */
  fromPk: string | null;
  count: number;
  lastTs: number;
}

export interface ChannelStats {
  count: number;
  firstTs: number | null;
  lastTs: number | null;
  count24h: number;
  count7d: number;
  /** Distinct identifiable non-self senders (excludes null self and 'unknown'). */
  distinctSenders: number;
  /** Grouped per sender, ordered by most-recently-active first. */
  roster: ChannelSenderStat[];
  /** 7 local-day message-count buckets, oldest→newest; index 6 is today. */
  perDay: number[];
}
```

- [ ] **Step 2: Write the failing test** at `tests/integration/storage/channel-stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const seed = (key: string, ts: number, from: string | undefined, body: string) =>
  messagesStore.insert({ id: `${key}-${ts}-${body}`, key, ts, body, state: 'received', fromPublicKeyHex: from } as Message);

describe('messagesStore.statsByKey', () => {
  it('aggregates counts, windows, roster and distinct senders', () => {
    const noon = new Date(1_700_000_000_000);
    noon.setHours(12, 0, 0, 0);
    const now = noon.getTime();
    seed('ch:Stats', now - 1 * HOUR, undefined, 'a'); // self
    seed('ch:Stats', now - 2 * HOUR, 'name:alice', 'b');
    seed('ch:Stats', now - 2 * DAY, 'name:bob', 'c');
    seed('ch:Stats', now - 6 * DAY, 'name:alice', 'd');
    seed('ch:Other', now, 'name:zed', 'x'); // different channel, must be excluded

    const s = messagesStore.statsByKey('ch:Stats', now);
    expect(s.count).toBe(4);
    expect(s.firstTs).toBe(now - 6 * DAY);
    expect(s.lastTs).toBe(now - 1 * HOUR);
    expect(s.count24h).toBe(2); // the two hour-old messages
    expect(s.count7d).toBe(4);
    expect(s.distinctSenders).toBe(2); // alice + bob; self excluded
    expect(s.roster.map((r) => r.fromPk)).toEqual([null, 'name:alice', 'name:bob']); // by lastTs desc
    const alice = s.roster.find((r) => r.fromPk === 'name:alice');
    expect(alice?.count).toBe(2);
  });

  it('buckets messages into 7 local-day sparkline buckets', () => {
    const noon = new Date(1_700_000_000_000);
    noon.setHours(12, 0, 0, 0);
    const now = noon.getTime();
    seed('ch:Spark', now, 'name:a', '0'); // today -> index 6
    seed('ch:Spark', now - 2 * DAY, 'name:a', '2'); // -> index 4
    seed('ch:Spark', now - 6 * DAY, 'name:a', '6'); // -> index 0

    const s = messagesStore.statsByKey('ch:Spark', now);
    expect(s.perDay).toEqual([1, 0, 0, 0, 1, 0, 1]);
  });

  it('returns an empty-shaped struct for an unknown key', () => {
    const s = messagesStore.statsByKey('ch:Nope', 1_700_000_000_000);
    expect(s).toEqual({
      count: 0,
      firstTs: null,
      lastTs: null,
      count24h: 0,
      count7d: 0,
      distinctSenders: 0,
      roster: [],
      perDay: [0, 0, 0, 0, 0, 0, 0],
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/storage/channel-stats.test.ts`
Expected: FAIL — `messagesStore.statsByKey is not a function`.

- [ ] **Step 4: Implement `statsByKey`.** In `src/main/storage/messages.ts`, add this property to the `messagesStore` object immediately after the `byKey` method (after its closing `},` at line ~87). Add the type import to the existing import line at the top:

```ts
import type { ChannelStats, Message, MessageMeta, MessageState } from '../../shared/types';
```

```ts
  statsByKey(key: string, now: number = Date.now()): ChannelStats {
    const db = openDb();
    const DAY = 86_400_000;
    const since24h = now - DAY;
    const since7d = now - 7 * DAY;

    const agg = db
      .prepare(`SELECT COUNT(*) AS count, MIN(ts) AS firstTs, MAX(ts) AS lastTs FROM messages WHERE key = ?`)
      .get(key) as unknown as { count: number; firstTs: number | null; lastTs: number | null };

    const win = db
      .prepare(
        `SELECT
           SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS c24,
           SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS c7
         FROM messages WHERE key = ?`,
      )
      .get(since24h, since7d, key) as unknown as { c24: number | null; c7: number | null };

    const senderRows = db
      .prepare(
        `SELECT from_pk AS fromPk, COUNT(*) AS count, MAX(ts) AS lastTs
         FROM messages WHERE key = ? GROUP BY from_pk ORDER BY lastTs DESC`,
      )
      .all(key) as unknown as Array<{ fromPk: string | null; count: number; lastTs: number }>;

    const roster = senderRows.map((r) => ({ fromPk: r.fromPk, count: r.count, lastTs: r.lastTs }));
    const distinctSenders = roster.filter((r) => r.fromPk !== null && r.fromPk !== 'unknown').length;

    // Bucket the last 7 calendar days (local tz), index 6 = today.
    const perDay = [0, 0, 0, 0, 0, 0, 0];
    const tsRows = db
      .prepare(`SELECT ts FROM messages WHERE key = ? AND ts >= ?`)
      .all(key, since7d) as unknown as Array<{ ts: number }>;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();
    for (const { ts } of tsRows) {
      const bucket = 6 + Math.floor((ts - startMs) / DAY);
      if (bucket >= 0 && bucket < 7) perDay[bucket] += 1;
    }

    return {
      count: agg.count,
      firstTs: agg.firstTs,
      lastTs: agg.lastTs,
      count24h: win.c24 ?? 0,
      count7d: win.c7 ?? 0,
      distinctSenders,
      roster,
      perDay,
    };
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/storage/channel-stats.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/storage/messages.ts tests/integration/storage/channel-stats.test.ts
git commit -m "feat(channels): add messagesStore.statsByKey aggregate + ChannelStats type"
```

---

## Task 3: `holder.getChannelStats` + `GET /api/channels/:key/stats`

**Files:**
- Modify: `src/main/state/holder.ts` (after `getMessagesForKey`, ~line 223)
- Modify: `src/main/api/routes.ts` (channels route block, after the `GET /api/channels` at ~line 437)
- Test: `tests/integration/storage/channel-stats.test.ts` (append a holder test)

**Interfaces:**
- Consumes: `messagesStore.statsByKey` (Task 2).
- Produces: `stateHolder().getChannelStats(key: string): ChannelStats`; route `GET /api/channels/:key/stats`.

- [ ] **Step 1: Write the failing test.** Append to `tests/integration/storage/channel-stats.test.ts`:

```ts
import { stateHolder } from '../../../src/main/state/holder';

describe('stateHolder().getChannelStats', () => {
  it('delegates to statsByKey for a channel', () => {
    const ts = 1_700_000_000_000;
    seed('ch:Holder', ts, 'name:alice', 'h1');
    seed('ch:Holder', ts - 1000, undefined, 'h2');
    const s = stateHolder().getChannelStats('ch:Holder');
    expect(s.count).toBe(2);
    expect(s.roster).toHaveLength(2);
    expect(s.firstTs).toBe(ts - 1000);
    expect(s.lastTs).toBe(ts);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/storage/channel-stats.test.ts -t "delegates to statsByKey"`
Expected: FAIL — `stateHolder(...).getChannelStats is not a function`.

- [ ] **Step 3: Implement the holder method.** In `src/main/state/holder.ts`, add immediately after `getMessagesForKey` (~line 223). Add the type import at the top of the file's type imports (find the existing `import type { ... } from '../../shared/types';` and add `ChannelStats`):

```ts
  getChannelStats(key: string): ChannelStats {
    return messagesStore.statsByKey(key);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/storage/channel-stats.test.ts -t "delegates to statsByKey"`
Expected: PASS.

- [ ] **Step 5: Add the route.** In `src/main/api/routes.ts`, in the channels block (right after the `api.get('/api/channels', ...)` handler at ~line 437), add:

```ts
  api.get('/api/channels/:key/stats', (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    return c.json(stateHolder().getChannelStats(key));
  });
```

- [ ] **Step 6: Verify typecheck + full route file compiles**

Run: `pnpm typecheck`
Expected: no errors. (The route is a thin delegation exercised end-to-end in Task 16's manual verification via `curl`.)

- [ ] **Step 7: Commit**

```bash
git add src/main/state/holder.ts src/main/api/routes.ts tests/integration/storage/channel-stats.test.ts
git commit -m "feat(channels): expose getChannelStats via holder + GET /api/channels/:key/stats"
```

---

## Task 4: `api.getChannelStats` client method

**Files:**
- Modify: `src/renderer/lib/api.ts` (inside the `api` object; add `ChannelStats` to type imports)
- Test: `tests/unit/renderer/lib/api-channel-stats.test.ts`

**Interfaces:**
- Produces: `api.getChannelStats(c: ApiClient, key: string): Promise<ChannelStats>`.

- [ ] **Step 1: Write the failing test** at `tests/unit/renderer/lib/api-channel-stats.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiClient } from '../../../../src/renderer/lib/api';
import type { ChannelStats } from '../../../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://localhost:9999', apiKey: 'k' };
const STATS: ChannelStats = {
  count: 3, firstTs: 1, lastTs: 9, count24h: 1, count7d: 3,
  distinctSenders: 2, roster: [], perDay: [0, 0, 0, 0, 0, 0, 3],
};

afterEach(() => vi.unstubAllGlobals());

describe('api.getChannelStats', () => {
  it('GETs the encoded stats path and returns parsed ChannelStats', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(STATS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getChannelStats(client, 'ch:General');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9999/api/channels/ch%3AGeneral/stats');
    expect(result).toEqual(STATS);
  });

  it('throws the server error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 })));
    await expect(api.getChannelStats(client, 'ch:x')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/renderer/lib/api-channel-stats.test.ts`
Expected: FAIL — `api.getChannelStats is not a function`.

- [ ] **Step 3: Implement the method.** In `src/renderer/lib/api.ts`, add `ChannelStats` to the shared-types import, then add this property inside the `api` object (next to `getMessages`, ~line 149):

```ts
  getChannelStats: (c: ApiClient, key: string) =>
    request<ChannelStats>(c, `/api/channels/${encodeURIComponent(key)}/stats`),
```

(If `api.ts` imports types inline rather than at the top, use `request<import('../../shared/types').ChannelStats>(...)` to match the file's existing style — e.g. the `putChannel` line uses `import('../../shared/types').Channel`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/renderer/lib/api-channel-stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/api.ts tests/unit/renderer/lib/api-channel-stats.test.ts
git commit -m "feat(channels): add api.getChannelStats client method"
```

---

## Task 5: `useChannelStats` hook

**Files:**
- Create: `src/renderer/hooks/useChannelStats.ts`
- Test: `tests/component/use-channel-stats.test.tsx`

**Interfaces:**
- Consumes: `api.getChannelStats` (Task 4), `useStore` `messagesByKey`.
- Produces: `useChannelStats(key: string, client: ApiClient | null): { stats: ChannelStats | null; loading: boolean; error: string | null }`. Fetches on mount; refetches when `messagesByKey[key]` changes.

- [ ] **Step 1: Write the failing test** at `tests/component/use-channel-stats.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelStats } from '../../src/shared/types';

const getChannelStats = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = (await orig()) as typeof import('@/lib/api');
  return { ...actual, api: { ...actual.api, getChannelStats: (...a: unknown[]) => getChannelStats(...a) } };
});

import { useStore } from '@/lib/store';
import { useChannelStats } from '@/hooks/useChannelStats';
import type { Message } from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const stats = (count: number): ChannelStats => ({
  count, firstTs: 1, lastTs: 2, count24h: 0, count7d: count,
  distinctSenders: 0, roster: [], perDay: [0, 0, 0, 0, 0, 0, 0],
});
const msg = (id: string): Message => ({ id, key: 'ch:X', ts: 1, body: 'b', state: 'received' });

beforeEach(() => {
  getChannelStats.mockReset();
  useStore.setState({ messagesByKey: {} });
});

describe('useChannelStats', () => {
  it('fetches on mount and returns stats', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    const { result } = renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(result.current.stats?.count).toBe(3));
    expect(getChannelStats).toHaveBeenCalledTimes(1);
  });

  it('refetches when messagesByKey[key] changes', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(getChannelStats).toHaveBeenCalledTimes(1));
    act(() => useStore.setState({ messagesByKey: { 'ch:X': [msg('m1')] } }));
    await waitFor(() => expect(getChannelStats).toHaveBeenCalledTimes(2));
  });

  it('does not fetch without a client', () => {
    renderHook(() => useChannelStats('ch:X', null));
    expect(getChannelStats).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/use-channel-stats.test.tsx`
Expected: FAIL — cannot resolve `@/hooks/useChannelStats`.

- [ ] **Step 3: Implement the hook** at `src/renderer/hooks/useChannelStats.ts`:

```ts
import { useEffect, useState } from 'react';
import type { ChannelStats } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

/** Fetches channel stats lazily (the rail only mounts a section's body when it
 *  is expanded) and refetches whenever this channel's message list changes. */
export function useChannelStats(
  key: string,
  client: ApiClient | null,
): { stats: ChannelStats | null; loading: boolean; error: string | null } {
  const messages = useStore((s) => s.messagesByKey[key]);
  const [stats, setStats] = useState<ChannelStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messagesByKey[key] is the refetch trigger, not read inside the effect
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getChannelStats(client, key).then(
      (s) => {
        if (!cancelled) {
          setStats(s);
          setLoading(false);
        }
      },
      (e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, key, messages]);

  return { stats, loading, error };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/component/use-channel-stats.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useChannelStats.ts tests/component/use-channel-stats.test.tsx
git commit -m "feat(channels): add useChannelStats lazy-fetch hook"
```

---

## Task 6: `buildChannelShareUri` helper

**Files:**
- Create: `src/renderer/lib/channelShare.ts`
- Test: `tests/unit/renderer/lib/channelShare.test.ts`

**Interfaces:**
- Produces: `buildChannelShareUri(channel: Channel): string | null` — `meshcore://channel/add?name=<url-encoded>&secret=<hex>`, or `null` when no `secretHex`.

- [ ] **Step 1: Write the failing test** at `tests/unit/renderer/lib/channelShare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Channel } from '../../../../src/shared/types';
import { buildChannelShareUri } from '../../../../src/renderer/lib/channelShare';

const ch = (over: Partial<Channel> = {}): Channel => ({ key: 'ch:worldcup', name: 'worldcup', kind: 'hashtag', ...over });

describe('buildChannelShareUri', () => {
  it('builds the official channel/add URI with the hex secret', () => {
    const uri = buildChannelShareUri(ch({ secretHex: 'd5786cc7bcee5a48d5786cc7bcee5a48' }));
    expect(uri).toBe('meshcore://channel/add?name=worldcup&secret=d5786cc7bcee5a48d5786cc7bcee5a48');
  });

  it('url-encodes the channel name', () => {
    const uri = buildChannelShareUri(ch({ name: 'My Chan', secretHex: 'abcd' }));
    expect(uri).toBe('meshcore://channel/add?name=My%20Chan&secret=abcd');
  });

  it('returns null when the channel has no secret', () => {
    expect(buildChannelShareUri(ch())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/renderer/lib/channelShare.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement** at `src/renderer/lib/channelShare.ts`:

```ts
import type { Channel } from '../../shared/types';

/** Build the official MeshCore channel-share URI (docs.meshcore.io/qr_codes):
 *  `meshcore://channel/add?name=<url-encoded>&secret=<32-hex>`. Returns null
 *  when the channel carries no secret, so callers can hide the share UI. */
export function buildChannelShareUri(channel: Channel): string | null {
  if (!channel.secretHex) return null;
  return `meshcore://channel/add?name=${encodeURIComponent(channel.name)}&secret=${channel.secretHex}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/renderer/lib/channelShare.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/channelShare.ts tests/unit/renderer/lib/channelShare.test.ts
git commit -m "feat(channels): add buildChannelShareUri helper"
```

---

## Task 7: `fmtDate` calendar formatter

**Files:**
- Modify: `src/renderer/lib/time.ts`
- Test: `tests/unit/renderer/lib/time-fmtDate.test.ts`

**Interfaces:**
- Produces: `fmtDate(ts: number): string` — locale medium date (e.g. "Nov 14, 2023").

- [ ] **Step 1: Write the failing test** at `tests/unit/renderer/lib/time-fmtDate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fmtDate } from '../../../../src/renderer/lib/time';

describe('fmtDate', () => {
  it('formats a timestamp as a medium calendar date including the year', () => {
    const out = fmtDate(1_700_000_000_000); // 2023
    expect(out).toContain('2023');
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/renderer/lib/time-fmtDate.test.ts`
Expected: FAIL — `fmtDate` is not exported.

- [ ] **Step 3: Implement.** Append to `src/renderer/lib/time.ts`:

```ts
// Calendar date without time — "Nov 14, 2023". Used for durable "Added on" /
// "First seen" anchors where a relative label would read oddly.
export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/renderer/lib/time-fmtDate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/time.ts tests/unit/renderer/lib/time-fmtDate.test.ts
git commit -m "feat(time): add fmtDate medium calendar formatter"
```

---

## Task 8: `<ColoredUsername>` component + retire `SenderLabel`

**Files:**
- Create: `src/renderer/components/ColoredUsername.tsx`
- Modify: `src/renderer/components/MessageItem.tsx` (imports + lines 88, 118)
- Delete: `src/renderer/components/SenderLabel.tsx`
- Test: `tests/component/colored-username.test.tsx`

**Interfaces:**
- Consumes: `getNameColor` (`lib/contactColor`), `deriveSenderName` + `cn` (`lib/utils`).
- Produces: `<ColoredUsername name?: string; sender?: string; variant?: 'text'|'pill'; size?: 'sm'|'md'; selfLabel?: string; onClick?: () => void; className?: string />`. `name` wins if given; else `sender` (raw from_pk) is decoded via `deriveSenderName`; self/unknown render neutral (dim, uncolored).

- [ ] **Step 1: Write the failing test** at `tests/component/colored-username.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColoredUsername } from '@/components/ColoredUsername';

describe('ColoredUsername', () => {
  it('colors a given name with getNameColor', () => {
    render(<ColoredUsername name="alice" />);
    const el = screen.getByText('alice');
    expect(el.style.color).toBeTruthy();
    // jsdom may normalize hsl(...) — assert a color was set, not the exact string.
  });

  it('decodes a name-based sender', () => {
    render(<ColoredUsername sender="name:bob" />);
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('renders self neutrally as the selfLabel when no name/sender', () => {
    render(<ColoredUsername />);
    const el = screen.getByText('You');
    expect(el.style.color).toBe(''); // neutral: no inline color
  });

  it('renders an unknown sender as "Unknown", neutral', () => {
    render(<ColoredUsername sender="unknown" />);
    const el = screen.getByText('Unknown');
    expect(el.style.color).toBe('');
  });

  it('pill variant sets a background', () => {
    render(<ColoredUsername name="carol" variant="pill" />);
    const el = screen.getByText('carol');
    expect(el.style.backgroundColor).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/colored-username.test.tsx`
Expected: FAIL — cannot resolve `@/components/ColoredUsername`.

- [ ] **Step 3: Implement** at `src/renderer/components/ColoredUsername.tsx`:

```tsx
import { getNameColor } from '../lib/contactColor';
import { cn, deriveSenderName } from '../lib/utils';

interface Props {
  /** Already-resolved display name (wins over `sender`). */
  name?: string;
  /** Raw from_pk: undefined/null=self, 'name:<n>', 'unknown', or hex pubkey. */
  sender?: string;
  variant?: 'text' | 'pill';
  size?: 'sm' | 'md';
  selfLabel?: string;
  onClick?: () => void;
  className?: string;
}

export function ColoredUsername({ name, sender, variant = 'text', size = 'md', selfLabel = 'You', onClick, className }: Props) {
  let display: string;
  let neutral = false;
  if (name !== undefined) {
    display = name;
  } else if (sender === undefined || sender === null) {
    display = selfLabel;
    neutral = true;
  } else {
    const derived = deriveSenderName(sender); // '' for self / 'unknown'
    if (derived === '') {
      display = 'Unknown';
      neutral = true;
    } else {
      display = derived;
    }
  }

  const color = neutral ? null : getNameColor(display);
  const sizeCls = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const base = cn('font-medium leading-tight', sizeCls, neutral && 'text-cs-text-dim', className);

  if (variant === 'pill') {
    return (
      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5', base)} style={{ color: color?.fg, backgroundColor: color?.pillBg }}>
        {onClick ? (
          <button type="button" onClick={onClick} className="bg-transparent">
            {display}
          </button>
        ) : (
          display
        )}
      </span>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, 'bg-transparent text-left')} style={{ color: color?.fg }}>
        {display}
      </button>
    );
  }
  return (
    <span className={base} style={{ color: color?.fg }}>
      {display}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/component/colored-username.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Migrate `MessageItem`.** In `src/renderer/components/MessageItem.tsx`: replace the import `import { SenderLabel } from './SenderLabel';` (line 9) with `import { ColoredUsername } from './ColoredUsername';`, then replace both usages — line ~88 `<SenderLabel name={senderName} />` and line ~118 `<SenderLabel name={senderName} />` — with `<ColoredUsername name={senderName} />`. (Default `variant="text" size="md"` renders identical `text-xs font-medium leading-tight` styling to the old `SenderLabel`.)

- [ ] **Step 6: Confirm `SenderLabel` has no other importers, then delete it**

Run: `grep -rn "SenderLabel" src tests`
Expected: no matches remain (only the deleted references). Then:

```bash
git rm src/renderer/components/SenderLabel.tsx
```

- [ ] **Step 7: Verify typecheck + the message-item tests still pass**

Run: `pnpm typecheck && pnpm vitest run tests/component/colored-username.test.tsx`
Expected: no type errors; component tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/ColoredUsername.tsx src/renderer/components/MessageItem.tsx tests/component/colored-username.test.tsx
git commit -m "feat(ui): add ColoredUsername, retire SenderLabel"
```

---

## Task 9: `<Sparkline>` component

**Files:**
- Create: `src/renderer/components/Sparkline.tsx`
- Test: `tests/component/sparkline.test.tsx`

**Interfaces:**
- Produces: `<Sparkline data: number[]; className?: string />` — inline `<svg>` of `data.length` bars using `currentColor`.

- [ ] **Step 1: Write the failing test** at `tests/component/sparkline.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '@/components/Sparkline';

describe('Sparkline', () => {
  it('renders one bar per data point', () => {
    const { container } = render(<Sparkline data={[0, 1, 2, 3, 0, 4, 1]} />);
    expect(container.querySelectorAll('rect')).toHaveLength(7);
  });

  it('scales the tallest bar to full height and keeps zeros at zero height', () => {
    const { container } = render(<Sparkline data={[0, 4]} />);
    const rects = Array.from(container.querySelectorAll('rect'));
    expect(Number(rects[0].getAttribute('height'))).toBe(0);
    expect(Number(rects[1].getAttribute('height'))).toBeGreaterThan(0);
  });

  it('renders an svg even when all values are zero', () => {
    const { container } = render(<Sparkline data={[0, 0, 0]} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelectorAll('rect')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/sparkline.test.tsx`
Expected: FAIL — cannot resolve `@/components/Sparkline`.

- [ ] **Step 3: Implement** at `src/renderer/components/Sparkline.tsx`:

```tsx
interface Props {
  data: number[];
  className?: string;
}

const W = 4;
const GAP = 2;
const H = 24;

/** Tiny inline-SVG bar chart. Color follows `currentColor`, so set it via a
 *  text-color class on `className` (e.g. `text-cs-accent`). */
export function Sparkline({ data, className }: Props) {
  const max = Math.max(1, ...data);
  return (
    <svg
      className={className}
      width={data.length * (W + GAP)}
      height={H}
      viewBox={`0 0 ${data.length * (W + GAP)} ${H}`}
      role="img"
      aria-label="activity over the last 7 days"
    >
      {data.map((v, i) => {
        const barH = Math.round((v / max) * H);
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional day gauge (see SignalBars.tsx)
        return <rect key={i} x={i * (W + GAP)} y={H - barH} width={W} height={barH} rx={1} fill="currentColor" />;
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/component/sparkline.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Sparkline.tsx tests/component/sparkline.test.tsx
git commit -m "feat(ui): add Sparkline inline-svg bar chart"
```

---

## Task 10: `<SecretField>` reveal + copy

**Files:**
- Create: `src/renderer/components/SecretField.tsx`
- Test: `tests/component/secret-field.test.tsx`

**Interfaces:**
- Consumes: `CopyButton` (`components/CopyButton`), `cn` (`lib/utils`).
- Produces: `<SecretField secretHex: string />` — masked by default, `Eye`/`EyeOff` toggle reveals, `CopyButton` copies the full hex.

- [ ] **Step 1: Write the failing test** at `tests/component/secret-field.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecretField } from '@/components/SecretField';

const SECRET = 'deadbeefdeadbeefdeadbeefdeadbeef';

describe('SecretField', () => {
  it('masks the secret by default and reveals on click', () => {
    render(<SecretField secretHex={SECRET} />);
    expect(screen.queryByText(SECRET)).toBeNull();
    fireEvent.click(screen.getByLabelText('Reveal secret'));
    expect(screen.getByText(SECRET)).toBeTruthy();
  });

  it('offers a copy control', () => {
    render(<SecretField secretHex={SECRET} />);
    expect(screen.getByTitle('Copy secret')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/secret-field.test.tsx`
Expected: FAIL — cannot resolve `@/components/SecretField`.

- [ ] **Step 3: Implement** at `src/renderer/components/SecretField.tsx` (mirrors the reveal pattern in `settings/ApiKeySection.tsx`):

```tsx
import { Copy, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';
import { CopyButton } from './CopyButton';

/** A channel/API secret shown masked by default, with reveal + copy. Never
 *  renders the full hex until the user explicitly reveals it. */
export function SecretField({ secretHex }: { secretHex: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code className={cn('font-mono text-[11px] text-cs-text', revealed ? 'break-all' : 'truncate')}>
        {revealed ? secretHex : '•'.repeat(12)}
      </code>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? 'Hide secret' : 'Reveal secret'}
        title={revealed ? 'Hide secret' : 'Reveal secret'}
        className="text-cs-text-dim hover:text-cs-text"
      >
        {revealed ? <EyeOff className="size-3" aria-hidden="true" /> : <Eye className="size-3" aria-hidden="true" />}
      </button>
      <CopyButton value={secretHex} title="Copy secret" className="text-cs-text-dim hover:text-cs-text">
        <Copy className="size-3" aria-hidden="true" />
      </CopyButton>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/component/secret-field.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SecretField.tsx tests/component/secret-field.test.tsx
git commit -m "feat(ui): add SecretField reveal/copy control"
```

---

## Task 11: Channel info (Overview) section rewrite

**Files:**
- Modify: `src/renderer/shell/rightrail/sections/ChannelInfo.tsx`
- Test: `tests/component/channel-info-section.test.tsx`

**Interfaces:**
- Consumes: `SecretField` (T10), `KeyValueRow`, `RelativeTime`, `fmtDate` (T7), `useStore`, `api.putChannel`, `Placeholder`.
- Produces: `ChannelInfoSection({ channel: Channel | null; client: ApiClient | null })` (container) and `ChannelInfoBody({ channel: Channel; lastActiveTs: number | null; muted: boolean; onToggleMuted: () => void })` (pure, exported for tests).

- [ ] **Step 1: Write the failing test** at `tests/component/channel-info-section.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../src/shared/types';
import { ChannelInfoBody } from '@/shell/rightrail/sections/ChannelInfo';

const ch = (over: Partial<Channel> = {}): Channel => ({
  key: 'ch:worldcup', name: 'worldcup', kind: 'hashtag', secretHex: 'd5786cc7bcee5a48d5786cc7bcee5a48', idx: 3, ...over,
});

describe('ChannelInfoBody', () => {
  it('renders kind, slot and a masked secret', () => {
    render(<ChannelInfoBody channel={ch()} lastActiveTs={null} muted={false} onToggleMuted={() => {}} />);
    expect(screen.getByText('hashtag')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByLabelText('Reveal secret')).toBeTruthy();
  });

  it('shows "not synced" when the radio slot is unknown', () => {
    render(<ChannelInfoBody channel={ch({ idx: undefined })} lastActiveTs={null} muted={false} onToggleMuted={() => {}} />);
    expect(screen.getByText('not synced')).toBeTruthy();
  });

  it('shows "unknown" for a channel with no createdAt', () => {
    render(<ChannelInfoBody channel={ch()} lastActiveTs={null} muted={false} onToggleMuted={() => {}} />);
    expect(screen.getByText('unknown')).toBeTruthy();
  });

  it('toggles mute', () => {
    const onToggle = vi.fn();
    render(<ChannelInfoBody channel={ch({ muted: false })} lastActiveTs={null} muted={false} onToggleMuted={onToggle} />);
    fireEvent.click(screen.getByText('no'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/channel-info-section.test.tsx`
Expected: FAIL — `ChannelInfoBody` is not exported.

- [ ] **Step 3: Implement** — replace the whole of `src/renderer/shell/rightrail/sections/ChannelInfo.tsx`:

```tsx
import type { Channel } from '../../../../shared/types';
import { RelativeTime } from '../../../components/RelativeTime';
import { SecretField } from '../../../components/SecretField';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { type ApiClient, api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { fmtDate } from '../../../lib/time';
import { Placeholder } from '../atoms';

/** Pure presentational Overview body. */
export function ChannelInfoBody({
  channel,
  lastActiveTs,
  muted,
  onToggleMuted,
}: {
  channel: Channel;
  lastActiveTs: number | null;
  muted: boolean;
  onToggleMuted: () => void;
}) {
  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <KeyValueRow label="Name" value={channel.name} />
      <KeyValueRow label="Kind" value={channel.kind} mono />
      {channel.secretHex && <KeyValueRow label="Secret" value={<SecretField secretHex={channel.secretHex} />} />}
      <KeyValueRow
        label="Muted"
        value={
          <button type="button" onClick={onToggleMuted} className="text-cs-text hover:text-cs-accent">
            {muted ? 'yes' : 'no'}
          </button>
        }
      />
      <KeyValueRow label="Slot" value={typeof channel.idx === 'number' ? channel.idx : 'not synced'} mono />
      <KeyValueRow
        label="Added"
        value={channel.createdAt ? <RelativeTime ts={channel.createdAt} /> : 'unknown'}
        title={channel.createdAt ? fmtDate(channel.createdAt) : undefined}
      />
      <KeyValueRow label="Last active" value={lastActiveTs ? <RelativeTime ts={lastActiveTs} /> : '—'} />
    </div>
  );
}

/** Container: resolves last-active from the store and wires the mute toggle. */
export function ChannelInfoSection({ channel, client }: { channel: Channel | null; client: ApiClient | null }) {
  const messages = useStore((s) => (channel ? s.messagesByKey[channel.key] : undefined));
  if (!channel) return <Placeholder label="unknown channel" />;
  const lastActiveTs = messages && messages.length > 0 ? messages[messages.length - 1].ts : null;
  const onToggleMuted = () => {
    if (!client) return;
    api
      .putChannel(client, { ...channel, muted: !channel.muted })
      .catch((err) => notify.error(`Couldn't update channel: ${(err as Error).message}`, err));
  };
  return <ChannelInfoBody channel={channel} lastActiveTs={lastActiveTs} muted={!!channel.muted} onToggleMuted={onToggleMuted} />;
}
```

Note: confirm the `notify` import path resolves (it's used the same way in `sections/NeighboursRail.tsx`). If the repo's toast module differs, match that file's import.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/component/channel-info-section.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/rightrail/sections/ChannelInfo.tsx tests/component/channel-info-section.test.tsx
git commit -m "feat(rail): rewrite Channel info Overview (secret reveal, mute toggle, added/last-active)"
```

---

## Task 12: Activity section

**Files:**
- Create: `src/renderer/shell/rightrail/sections/ChannelActivity.tsx`
- Test: `tests/component/channel-activity-section.test.tsx`

**Interfaces:**
- Consumes: `useChannelStats` (T5), `useUnreadByKey` (`hooks/useUnreads`), `Sparkline` (T9), `fmtDate` (T7), `useStore` `markAllRead`.
- Produces: `ChannelActivitySection({ channel: Channel; client: ApiClient | null })` (container) and `ChannelActivityBody({ stats: ChannelStats | null; loading: boolean; unread: number; muted: boolean; onMarkAllRead: () => void })` (pure, exported).

- [ ] **Step 1: Write the failing test** at `tests/component/channel-activity-section.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelStats } from '../../src/shared/types';
import { ChannelActivityBody } from '@/shell/rightrail/sections/ChannelActivity';

const stats = (over: Partial<ChannelStats> = {}): ChannelStats => ({
  count: 47, firstTs: 1_700_000_000_000, lastTs: 1_700_400_000_000,
  count24h: 12, count7d: 47, distinctSenders: 7, roster: [], perDay: [1, 2, 0, 3, 5, 4, 2], ...over,
});

describe('ChannelActivityBody', () => {
  it('renders 24h/7d volume and a sparkline', () => {
    const { container } = render(<ChannelActivityBody stats={stats()} loading={false} unread={0} muted={false} onMarkAllRead={() => {}} />);
    expect(screen.getByText('12 in 24h · 47 in 7d')).toBeTruthy();
    expect(container.querySelectorAll('rect')).toHaveLength(7);
  });

  it('shows unread count with a Mark all read action', () => {
    const onMark = vi.fn();
    render(<ChannelActivityBody stats={stats()} loading={false} unread={4} muted={false} onMarkAllRead={onMark} />);
    expect(screen.getByText('4 unread')).toBeTruthy();
    fireEvent.click(screen.getByText('Mark all read'));
    expect(onMark).toHaveBeenCalledTimes(1);
  });

  it('shows "muted — not counted" for a muted channel', () => {
    render(<ChannelActivityBody stats={stats()} loading={false} unread={0} muted={true} onMarkAllRead={() => {}} />);
    expect(screen.getByText('muted — not counted')).toBeTruthy();
  });

  it('renders a placeholder while loading with no stats yet', () => {
    render(<ChannelActivityBody stats={null} loading={true} unread={0} muted={false} onMarkAllRead={() => {}} />);
    expect(screen.getByText('loading…')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/channel-activity-section.test.tsx`
Expected: FAIL — cannot resolve the module / export.

- [ ] **Step 3: Implement** at `src/renderer/shell/rightrail/sections/ChannelActivity.tsx`:

```tsx
import type { Channel, ChannelStats } from '../../../../shared/types';
import { Sparkline } from '../../../components/Sparkline';
import { useChannelStats } from '../../../hooks/useChannelStats';
import { useUnreadByKey } from '../../../hooks/useUnreads';
import type { ApiClient } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import { fmtDate } from '../../../lib/time';
import { Placeholder } from '../atoms';

const DAY = 86_400_000;

export function ChannelActivityBody({
  stats,
  loading,
  unread,
  muted,
  onMarkAllRead,
}: {
  stats: ChannelStats | null;
  loading: boolean;
  unread: number;
  muted: boolean;
  onMarkAllRead: () => void;
}) {
  if (!stats) return <Placeholder label={loading ? 'loading…' : 'no activity yet'} />;

  const spanDays = stats.firstTs && stats.lastTs ? Math.max(1, Math.round((stats.lastTs - stats.firstTs) / DAY)) : 0;
  const perDayAvg = spanDays ? (stats.count / spanDays).toFixed(1) : '0';

  return (
    <div className="flex flex-col gap-2 text-cs-text-muted">
      <div className="flex items-center justify-between text-[11px]">
        <span>{muted ? 'muted — not counted' : `${unread} unread`}</span>
        {!muted && unread > 0 && (
          <button type="button" onClick={onMarkAllRead} className="text-cs-accent hover:underline">
            Mark all read
          </button>
        )}
      </div>
      <div className="text-cs-text">{`${stats.count24h} in 24h · ${stats.count7d} in 7d`}</div>
      <Sparkline data={stats.perDay} className="text-cs-accent" />
      <div className="text-[10px] text-cs-text-dim">
        {stats.firstTs ? `First seen ${fmtDate(stats.firstTs)} · ${spanDays}d · ~${perDayAvg}/day` : 'no history'}
      </div>
    </div>
  );
}

export function ChannelActivitySection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats, loading } = useChannelStats(channel.key, client);
  const unread = useUnreadByKey()[channel.key] ?? 0;
  const markAllRead = useStore((s) => s.markAllRead);
  return (
    <ChannelActivityBody
      stats={stats}
      loading={loading}
      unread={unread}
      muted={!!channel.muted}
      onMarkAllRead={() => markAllRead(channel.key)}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/component/channel-activity-section.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/rightrail/sections/ChannelActivity.tsx tests/component/channel-activity-section.test.tsx
git commit -m "feat(rail): add channel Activity section (volume, sparkline, unread)"
```

---

## Task 13: People section

**Files:**
- Create: `src/renderer/shell/rightrail/sections/ChannelPeople.tsx`
- Test: `tests/component/channel-people-section.test.tsx`

**Interfaces:**
- Consumes: `useChannelStats` (T5), `ColoredUsername` (T8), `RelativeTime`, `Placeholder`.
- Produces: `ChannelPeopleSection({ channel: Channel; client: ApiClient | null })` (container) and `ChannelPeopleBody({ stats: ChannelStats | null; loading: boolean })` (pure, exported).

- [ ] **Step 1: Write the failing test** at `tests/component/channel-people-section.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChannelStats } from '../../src/shared/types';
import { ChannelPeopleBody } from '@/shell/rightrail/sections/ChannelPeople';

const stats = (): ChannelStats => ({
  count: 4, firstTs: 1, lastTs: 2, count24h: 0, count7d: 4, distinctSenders: 2,
  roster: [
    { fromPk: null, count: 1, lastTs: 1_700_000_000_000 },
    { fromPk: 'name:alice', count: 3, lastTs: 1_700_000_000_000 },
  ],
  perDay: [0, 0, 0, 0, 0, 0, 0],
});

describe('ChannelPeopleBody', () => {
  it('renders the distinct-sender count and a roster row per sender', () => {
    render(<ChannelPeopleBody stats={stats()} loading={false} />);
    expect(screen.getByText('2 people seen')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // alice's message count
  });

  it('uses the singular for one person', () => {
    const s = stats();
    s.distinctSenders = 1;
    render(<ChannelPeopleBody stats={s} loading={false} />);
    expect(screen.getByText('1 person seen')).toBeTruthy();
  });

  it('renders a placeholder while loading', () => {
    render(<ChannelPeopleBody stats={null} loading={true} />);
    expect(screen.getByText('loading…')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/channel-people-section.test.tsx`
Expected: FAIL — cannot resolve the module / export.

- [ ] **Step 3: Implement** at `src/renderer/shell/rightrail/sections/ChannelPeople.tsx`:

```tsx
import type { Channel, ChannelStats } from '../../../../shared/types';
import { ColoredUsername } from '../../../components/ColoredUsername';
import { RelativeTime } from '../../../components/RelativeTime';
import { useChannelStats } from '../../../hooks/useChannelStats';
import type { ApiClient } from '../../../lib/api';
import { Placeholder } from '../atoms';

export function ChannelPeopleBody({ stats, loading }: { stats: ChannelStats | null; loading: boolean }) {
  if (!stats) return <Placeholder label={loading ? 'loading…' : 'nobody seen yet'} />;
  const noun = stats.distinctSenders === 1 ? 'person' : 'people';
  return (
    <div className="flex flex-col gap-2 text-cs-text-muted">
      <div className="text-[11px] text-cs-text-dim">{`${stats.distinctSenders} ${noun} seen`}</div>
      <div className="max-h-40 overflow-y-auto">
        {stats.roster.map((r) => (
          <div key={r.fromPk ?? 'self'} className="flex items-center justify-between gap-2 py-1">
            <ColoredUsername sender={r.fromPk ?? undefined} size="sm" />
            <span className="flex shrink-0 items-center gap-2 text-[10px] text-cs-text-dim">
              <span className="tabular-nums">{r.count}</span>
              <RelativeTime ts={r.lastTs} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChannelPeopleSection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats, loading } = useChannelStats(channel.key, client);
  return <ChannelPeopleBody stats={stats} loading={loading} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/component/channel-people-section.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/rightrail/sections/ChannelPeople.tsx tests/component/channel-people-section.test.tsx
git commit -m "feat(rail): add channel People roster section"
```

---

## Task 14: Share section + `react-qr-code`

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/renderer/shell/rightrail/sections/ChannelShare.tsx`
- Test: `tests/component/channel-share-section.test.tsx`

**Interfaces:**
- Consumes: `buildChannelShareUri` (T6), `CopyButton`, `Placeholder`, `react-qr-code` (default export `QRCode`).
- Produces: `ChannelShareSection({ channel: Channel })`.

- [ ] **Step 1: Add the dependency** (needs network — run outside the sandbox if it is blocked):

Run: `pnpm add react-qr-code`
Expected: `react-qr-code` appears in `package.json` `dependencies`.

- [ ] **Step 2: Write the failing test** at `tests/component/channel-share-section.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Channel } from '../../src/shared/types';
import { ChannelShareSection } from '@/shell/rightrail/sections/ChannelShare';

const ch = (over: Partial<Channel> = {}): Channel => ({ key: 'ch:worldcup', name: 'worldcup', kind: 'hashtag', ...over });

describe('ChannelShareSection', () => {
  it('renders a QR svg and copy controls when a secret is present', () => {
    const { container } = render(<ChannelShareSection channel={ch({ secretHex: 'd5786cc7bcee5a48d5786cc7bcee5a48' })} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('Copy link')).toBeTruthy();
    expect(screen.getByText('Copy secret')).toBeTruthy();
  });

  it('shows a placeholder when the channel has no secret', () => {
    render(<ChannelShareSection channel={ch()} />);
    expect(screen.getByText('secret unavailable — cannot generate a share code')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/component/channel-share-section.test.tsx`
Expected: FAIL — cannot resolve the section module.

- [ ] **Step 4: Implement** at `src/renderer/shell/rightrail/sections/ChannelShare.tsx`:

```tsx
import QRCode from 'react-qr-code';
import type { Channel } from '../../../../shared/types';
import { CopyButton } from '../../../components/CopyButton';
import { buildChannelShareUri } from '../../../lib/channelShare';
import { Placeholder } from '../atoms';

export function ChannelShareSection({ channel }: { channel: Channel }) {
  const uri = buildChannelShareUri(channel);
  if (!uri || !channel.secretHex) {
    return <Placeholder label="secret unavailable — cannot generate a share code" />;
  }
  return (
    <div className="flex flex-col gap-2 text-cs-text-muted">
      <div className="flex items-center gap-3">
        <div className="rounded bg-white p-1.5">
          <QRCode value={uri} size={72} />
        </div>
        <div className="flex flex-col gap-1 text-[11px]">
          <CopyButton value={uri} title="Copy channel link" className="text-cs-accent hover:underline">
            Copy link
          </CopyButton>
          <CopyButton value={channel.secretHex} title="Copy secret" className="text-cs-text-dim hover:text-cs-text">
            Copy secret
          </CopyButton>
        </div>
      </div>
      <p className="text-[10px] text-cs-text-dim">Anyone with this code can read and post to the channel.</p>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/component/channel-share-section.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/shell/rightrail/sections/ChannelShare.tsx tests/component/channel-share-section.test.tsx
git commit -m "feat(rail): add channel Share section with meshcore QR (react-qr-code)"
```

---

## Task 15: Register the four sections in `sectionsFor`

**Files:**
- Modify: `src/renderer/shell/rightrail/sectionsFor.tsx` (`case 'channel'` block, lines ~172-183; imports)
- Test: `tests/component/rail-sections-channel.test.tsx`

**Interfaces:**
- Consumes: `ChannelInfoSection` (T11), `ChannelActivitySection` (T12), `ChannelPeopleSection` (T13), `ChannelShareSection` (T14).
- Produces: `sectionsFor('ch:*', data, actions)` returns four sections `rail.channel.{info,activity,people,share}`.

- [ ] **Step 1: Write the failing test** at `tests/component/rail-sections-channel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import type { Channel } from '../../src/shared/types';
import { type RailData, sectionsFor } from '@/shell/rightrail/sectionsFor';

const channel: Channel = { key: 'ch:worldcup', name: 'worldcup', kind: 'hashtag' };
const data = (over: Partial<RailData> = {}): RailData => ({
  channel, contact: null, selectedMessage: null, mentionedContact: null,
  repeaters: [], repeaterAdminActiveTab: null, cardPublicKeyHex: null, ...over,
});
const actions = { clearMentionedContact: () => {}, client: null };

describe('sectionsFor channel view', () => {
  it('returns the four channel sections in order', () => {
    const ids = sectionsFor('ch:worldcup', data(), actions).map((s) => s.id);
    expect(ids).toEqual(['rail.channel.info', 'rail.channel.activity', 'rail.channel.people', 'rail.channel.share']);
  });

  it('falls back to a single info section when the channel is missing', () => {
    const ids = sectionsFor('ch:worldcup', data({ channel: null }), actions).map((s) => s.id);
    expect(ids).toEqual(['rail.channel.info']);
  });

  it('defaults Activity/People/Share collapsed', () => {
    const sections = sectionsFor('ch:worldcup', data(), actions);
    const activity = sections.find((s) => s.id === 'rail.channel.activity');
    expect(activity?.defaultOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/rail-sections-channel.test.tsx`
Expected: FAIL — only `rail.channel.info` is returned.

- [ ] **Step 3: Implement.** In `src/renderer/shell/rightrail/sectionsFor.tsx`, update the imports to add the new sections and change the `ChannelInfoSection` import to include the client prop usage. Add:

```tsx
import { ChannelActivitySection } from './sections/ChannelActivity';
import { ChannelPeopleSection } from './sections/ChannelPeople';
import { ChannelShareSection } from './sections/ChannelShare';
```

Then replace the `case 'channel':` block (lines ~172-183) with:

```tsx
    case 'channel': {
      const ch = data.channel;
      const channelSections: RailSection[] = ch
        ? [
            {
              id: 'rail.channel.info',
              label: 'Channel info',
              defaultOpen: baseDefaultOpen,
              body: () => <ChannelInfoSection channel={ch} client={actions.client} />,
            },
            {
              id: 'rail.channel.activity',
              label: 'Activity',
              defaultOpen: false,
              body: () => <ChannelActivitySection channel={ch} client={actions.client} />,
            },
            {
              id: 'rail.channel.people',
              label: 'People',
              defaultOpen: false,
              body: () => <ChannelPeopleSection channel={ch} client={actions.client} />,
            },
            {
              id: 'rail.channel.share',
              label: 'Share this channel',
              defaultOpen: false,
              body: () => <ChannelShareSection channel={ch} />,
            },
          ]
        : [
            {
              id: 'rail.channel.info',
              label: 'Channel info',
              defaultOpen: baseDefaultOpen,
              body: () => <ChannelInfoSection channel={null} client={actions.client} />,
            },
          ];
      return [...mentionedSections, ...messageSections, ...channelSections];
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/component/rail-sections-channel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/rightrail/sectionsFor.tsx tests/component/rail-sections-channel.test.tsx
git commit -m "feat(rail): register four collapsible channel sections"
```

---

## Task 16: Full verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: all three projects (`unit`, `integration`, `dom`) PASS, including every new test.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Lint (scoped)**

Run: `pnpm exec biome check src tests`
Expected: no errors. (If Biome auto-fixes formatting, run `pnpm exec biome check --write src tests`, review, and amend the last commit.)

- [ ] **Step 4: Manual smoke — the stats route**

Start the app (`pnpm start`), then with the app running find its API port/key (the app logs them; or reuse the running server) and hit the endpoint for an existing channel:

```bash
curl -s -H "Authorization: Bearer <apiKey>" "http://127.0.0.1:<port>/api/channels/ch%3AworldCup/stats"
```

Expected: a JSON `ChannelStats` object with `count`, `firstTs`, `lastTs`, `count24h`, `count7d`, `distinctSenders`, `roster`, `perDay` (7 numbers).

- [ ] **Step 5: Manual smoke — the panel** (use the `run` / `verify` skill or drive the app):

Select the `#worldcup` channel and confirm the right rail shows four collapsible sections: **Channel info** (open — Name, Kind, Secret with a working reveal/copy, Muted toggle flips and persists, Slot, Added, Last active), **Activity** (expands, shows volume + sparkline + first-seen), **People** (expands, shows "N people seen" + a scrollable roster with colored names, per-name counts, last-seen), **Share this channel** (expands, shows a scannable QR + Copy link / Copy secret). Confirm the message list still renders colored sender names (ColoredUsername migration intact).

- [ ] **Step 6: Final confirmation** — report results with the actual command output (all tests green, typecheck clean, lint clean, route + panel verified).

---

## Self-Review (completed during authoring)

- **Spec coverage:** Four sections (T11-T15) ✓; `createdAt` (T1) ✓; SQLite stats route (T2-T4) ✓; `useChannelStats` lazy hook (T5) ✓; `ColoredUsername` + SenderLabel retire, MentionPill untouched (T8) ✓; People roster with inline counts, recency order, no top-poster pills, no caption (T13) ✓; `meshcore://` QR via `react-qr-code` (T6, T14) ✓; secret reveal/copy (T10) ✓; mute toggle + slot + last-active (T11) ✓; sparkline (T9) ✓. Deferred items (send-health, RF stats, URI import, sidebar/search recolor, pinning) are explicitly out of scope per the spec.
- **Placeholder scan:** every code + test step contains full source; no TBD/TODO.
- **Type consistency:** `ChannelStats`/`ChannelSenderStat` shape is identical across T2 (source), T4 (client), T5 (hook), T12/T13 (bodies), and every test fixture; `statsByKey(key, now?)`, `getChannelStats(key)`, `getChannelStats(c, key)`, `useChannelStats(key, client)`, `buildChannelShareUri(channel)`, and the `ColoredUsername`/`*Body` prop names match their consumers.
- **Import paths verified:** the `notify` path `'../../../lib/notify'` in T11 matches every existing sections file (`NeighboursRail.tsx`, `ContactDetail.tsx`, `ContactManagerRail.tsx`); all new relative/`@` import paths were checked against the file's directory depth.
