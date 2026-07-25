# Channel Activity "Cadence" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the channel right-rail Activity section with the "Cadence" design — a lead volume number with a trend chip vs the previous equal period, a labelled 24h/7d/30d bar chart with hover read-outs, a rhythm footer, and a width-driven collapsed mode.

**Architecture:** A new `GET /api/channels/:key/activity` endpoint computes all three windows plus rhythm bands from one SQLite read, so switching tabs is instant client-side. The renderer section splits into a folder of small presentational components fed by a `useChannelActivity` hook; pure bucketing/labelling/formatting helpers live in `activity.ts` and get node unit tests. Width mode is derived from `ui.rightWidth`, already in the zustand store.

**Tech Stack:** Electron + React 19 + TypeScript, Hono HTTP server in main (not IPC), `node:sqlite`, zustand, Tailwind v4 with `cs-*` tokens, shadcn/Radix (`ToggleGroup`, `Tooltip`), lucide-react, Vitest (3 projects), Biome.

**Spec:** `docs/superpowers/specs/2026-07-25-channel-activity-cadence-design.md`
**Design handoff:** `docs/design/channel-activity-cadence/README.md`

## Global Constraints

- **This is a git worktree.** Work in `/Users/andy/GitHub/andyshinn/coresense/.claude/worktrees/channel-activity-cadence`. Do not `cd` to the main checkout.
- **Run tooling via `npx`, not `pnpm <script>`.** `npx vitest run --project unit|integration|dom [path]`, `npx tsc --noEmit`, `npx biome check src tests`. The `pnpm` wrappers fail on a pre-run deps check in worktrees.
- **`git add` / `git commit` need the sandbox disabled** in this worktree. Never use bare `git stash` / `git stash pop` — the stash stack is shared with other sessions.
- **Biome:** 2-space indent, **lineWidth 125**, single quotes in JS, double quotes in JSX, semicolons, trailing commas. Import ordering is enforced (`organizeImports`). Run `npx biome check --write <files>` before every commit.
- **`tsconfig` sets `noUnusedLocals` / `noUnusedParameters`** — unused code fails `tsc` even though Biome only warns.
- **`@testing-library/jest-dom` is NOT installed.** Use `expect(...).toBeTruthy()` and attribute reads. Never `toBeInTheDocument()`.
- **The `dom` vitest project does not set `globals: true`** — `tests/component/setup.ts` calls `afterEach(cleanup)` explicitly. Import `describe/it/expect/vi` from `vitest`.
- **Every `biome-ignore` needs a one-line justification.** House style, e.g. `// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional bar chart`.
- **Import style:** app code under `src/renderer` uses **relative** imports (`'../../../../shared/types'`); `components/ui/*` and tests use the `@/` alias. Tests import shared types relatively (`'../../src/shared/types'`).
- **Every `<button>` needs an explicit `type="button"`.**
- Exact colour token values are given verbatim in Task 7. Do not substitute "close enough" hexes — they were chosen by contrast measurement.

---

## File Structure

**Create:**
| path | responsibility |
|---|---|
| `src/renderer/shell/rightrail/sections/channel-activity/index.tsx` | `ActivityBody` (presentational) + `ChannelActivitySection` (fetching wrapper) |
| `src/renderer/shell/rightrail/sections/channel-activity/activity.ts` | pure helpers: `trendPct`, `bucketStart`, `axisTicks`, `bucketLabel`, `fmtBand`, `chartAriaLabel`, `COLLAPSE_WIDTH` |
| `src/renderer/shell/rightrail/sections/channel-activity/TrendChip.tsx` | ▲/▼ percentage chip |
| `src/renderer/shell/rightrail/sections/channel-activity/VolumeChart.tsx` | flex-div bars, axis ticks, per-bar tooltips |
| `src/renderer/shell/rightrail/sections/channel-activity/WindowTabs.tsx` | 24h/7d/30d ToggleGroup |
| `src/renderer/shell/rightrail/sections/channel-activity/RhythmFooter.tsx` | peak · quiet · last-msg line |
| `src/renderer/hooks/useChannelActivity.ts` | fetch + refetch-on-message + 5-min timer |
| `tests/integration/storage/channel-activity.test.ts` | `activityByKey` |
| `tests/unit/renderer/lib/time-fmtAgoShort.test.ts` | `fmtAgoShort` |
| `tests/unit/renderer/shell/rightrail/channel-activity.test.ts` | `activity.ts` helpers |

**Modify:**
| path | change |
|---|---|
| `src/shared/types.ts` | `ActivityWindow`, `ActivityBand`, `ChannelActivity`, `ActivityWindowKey`; `channelActivityWindow` on `UiState` + `DEFAULT_UI_STATE` |
| `src/main/storage/messages.ts` | add `activityByKey` |
| `src/main/state/holder.ts:225` | add `getChannelActivity` passthrough |
| `src/main/api/routes.ts:443` | add the `/activity` route |
| `src/renderer/lib/api.ts:152` | add `getChannelActivity` |
| `src/renderer/lib/store.ts` | `setChannelActivityWindow` type + impl |
| `src/renderer/index.css` | `--cs-trend-up` / `--cs-trend-down` in `:root`, `:root:not(.dark)`, `@theme` |
| `src/renderer/lib/time.ts` | add `fmtAgoShort` |
| `src/renderer/panels/DMView.tsx` | delete private `fmtAgo`, use `fmtAgoShort` |
| `src/renderer/shell/rightrail/sectionsFor.tsx:8` | import path |
| `tests/component/channel-activity-section.test.tsx` | rewritten |
| `tests/integration/api/routes.test.ts` | add `/activity` route cases |

**Delete:**
- `src/renderer/shell/rightrail/sections/ChannelActivity.tsx`
- `src/renderer/components/Sparkline.tsx`
- `tests/component/sparkline.test.tsx`

---

## Task 1: Activity types and window bucketing

**Files:**
- Modify: `src/shared/types.ts` (add after `ChannelStats`, ~line 229)
- Modify: `src/main/storage/messages.ts` (add after `statsByKey`, ~line 141)
- Test: `tests/integration/storage/channel-activity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ActivityWindow`, `ActivityBand`, `ChannelActivity`, `ActivityWindowKey` from `src/shared/types`; `messagesStore.activityByKey(key: string, now?: number): ChannelActivity`.

- [ ] **Step 1: Add the shared types**

Append to `src/shared/types.ts` immediately after the `ChannelStats` interface:

```ts
/** One window of the channel Activity chart. `total` is always the sum of `buckets`,
 *  so the lead number can never disagree with the bars drawn under it. */
export interface ActivityWindow {
  /** Bucket counts, oldest→newest. Length is 24 (hourly), 7 or 30 (daily). */
  buckets: number[];
  /** Sum of `buckets`. */
  total: number;
  /** Count over the same-length immediately-preceding period. 0 when no prior history. */
  prevTotal: number;
  /** Epoch ms of the first bucket's start edge, so the renderer can label the axis
   *  from real edges instead of re-deriving them from a possibly-drifted clock. */
  startMs: number;
}

/** Hour-of-day band, local time. `startHour` inclusive, `endHour` exclusive and
 *  modulo 24 — so `endHour <= startHour` means the band wraps past midnight. */
export interface ActivityBand {
  startHour: number;
  endHour: number;
}

export type ActivityWindowKey = '24h' | '7d' | '30d';

export interface ChannelActivity {
  windows: Record<ActivityWindowKey, ActivityWindow>;
  /** Busiest 3h band over the trailing 168h. null when too sparse to name. */
  peakBand: ActivityBand | null;
  /** Calmest 4h band over the trailing 168h. null when too sparse to name. */
  quietBand: ActivityBand | null;
  /** Epoch ms of the most recent message in this channel; null if it has none. */
  lastTs: number | null;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/storage/channel-activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const seed = (key: string, ts: number, from: string | undefined, body: string) =>
  messagesStore.insert({ id: `${key}-${ts}-${body}`, key, ts, body, state: 'received', fromPublicKeyHex: from } as Message);

/** Local noon on the day containing `ms`. Pinning to noon keeps day-bucketing
 *  stable regardless of the runner's timezone or a DST transition. */
const noonOf = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
};

describe('messagesStore.activityByKey', () => {
  it('returns a zero-shaped struct for a channel with no messages', () => {
    const a = messagesStore.activityByKey('ch:Nothing', noonOf(1_700_000_000_000));
    expect(a.lastTs).toBe(null);
    expect(a.windows['24h'].buckets).toHaveLength(24);
    expect(a.windows['7d'].buckets).toHaveLength(7);
    expect(a.windows['30d'].buckets).toHaveLength(30);
    expect(a.windows['24h'].total).toBe(0);
    expect(a.windows['30d'].prevTotal).toBe(0);
  });

  it('buckets the trailing 24h hourly, with the current hour last', () => {
    const now = noonOf(1_700_000_000_000);
    seed('ch:Hourly', now - 30 * 60_000, 'name:a', 'this-hour');
    seed('ch:Hourly', now - 1 * HOUR, 'name:a', 'prev-hour-1');
    seed('ch:Hourly', now - 1 * HOUR - 60_000, 'name:a', 'prev-hour-2');

    const w = messagesStore.activityByKey('ch:Hourly', now).windows['24h'];
    expect(w.buckets).toHaveLength(24);
    expect(w.buckets[23]).toBe(1); // current partial hour
    expect(w.buckets[22]).toBe(2); // the hour before it
    expect(w.total).toBe(3);
    expect(w.total).toBe(w.buckets.reduce((x, y) => x + y, 0));
  });

  it('counts prevTotal from the immediately preceding equal period', () => {
    const now = noonOf(1_700_000_000_000);
    seed('ch:Prev', now - 2 * HOUR, 'name:a', 'in-window');
    seed('ch:Prev', now - 30 * HOUR, 'name:a', 'in-prev');
    seed('ch:Prev', now - 40 * HOUR, 'name:a', 'in-prev-2');

    const w = messagesStore.activityByKey('ch:Prev', now).windows['24h'];
    expect(w.total).toBe(1);
    expect(w.prevTotal).toBe(2);
  });

  it('buckets 7d and 30d by local calendar day with today last', () => {
    const now = noonOf(1_700_000_000_000);
    seed('ch:Daily', now, 'name:a', 'today');
    seed('ch:Daily', now - 1 * DAY, 'name:a', 'yesterday-1');
    seed('ch:Daily', now - 1 * DAY, 'name:a', 'yesterday-2');
    seed('ch:Daily', now - 6 * DAY, 'name:a', 'six-days');
    seed('ch:Daily', now - 20 * DAY, 'name:a', 'twenty-days');

    const a = messagesStore.activityByKey('ch:Daily', now);
    expect(a.windows['7d'].buckets[6]).toBe(1); // today
    expect(a.windows['7d'].buckets[5]).toBe(2); // yesterday
    expect(a.windows['7d'].buckets[0]).toBe(1); // six days back
    expect(a.windows['7d'].total).toBe(4);
    expect(a.windows['30d'].buckets[29]).toBe(1); // today
    expect(a.windows['30d'].buckets[9]).toBe(1); // twenty days back
    expect(a.windows['30d'].total).toBe(5);
    expect(a.lastTs).toBe(now);
  });

  it('excludes other channels', () => {
    const now = noonOf(1_700_000_000_000);
    seed('ch:Mine', now - 1 * HOUR, 'name:a', 'mine');
    seed('ch:Yours', now - 1 * HOUR, 'name:b', 'yours');
    expect(messagesStore.activityByKey('ch:Mine', now).windows['24h'].total).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project integration tests/integration/storage/channel-activity.test.ts`
Expected: FAIL — `messagesStore.activityByKey is not a function`.

- [ ] **Step 4: Implement `activityByKey`**

In `src/main/storage/messages.ts`, add these module-level helpers above `export const messagesStore` (near the existing top-level constants):

```ts
const HOUR_MS = 3_600_000;

/** Local-midnight edges for `n` calendar days ending with the day containing `now`.
 *  Returns n+1 timestamps: edges[i] opens bucket i, edges[n] closes the last one.
 *  Stepped with setDate() rather than ms arithmetic so DST days stay one bucket. */
function localDayEdges(now: number, n: number): number[] {
  const edges: number[] = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i <= n; i++) {
    edges.push(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return edges;
}

/** Index of the bucket containing `ts`, or -1 if outside. `edges` is ascending. */
function edgeIndex(edges: number[], ts: number): number {
  if (ts < edges[0] || ts >= edges[edges.length - 1]) return -1;
  let lo = 0;
  let hi = edges.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (ts < edges[mid]) hi = mid;
    else lo = mid;
  }
  return lo;
}
```

Then add this method to `messagesStore`, immediately after `statsByKey`:

```ts
  activityByKey(key: string, now: number = Date.now()): ChannelActivity {
    const db = openDb();

    // Hourly window: 24 buckets ending with the current (partial) hour.
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const h24Start = hourStart.getTime() - 23 * HOUR_MS;
    const h24End = h24Start + 24 * HOUR_MS;

    const d7 = localDayEdges(now, 7);
    const d30 = localDayEdges(now, 30);

    // Previous equal periods. The 30d one is the oldest cutoff we need to read.
    const prev24Start = h24Start - 24 * HOUR_MS;
    const prev7Start = localDayEdges(d7[0] - 1, 7)[0];
    const prev30Start = localDayEdges(d30[0] - 1, 30)[0];
    const since = Math.min(prev24Start, prev7Start, prev30Start);

    const rows = db.prepare(`SELECT ts FROM messages WHERE key = ? AND ts >= ?`).all(key, since) as unknown as Array<{
      ts: number;
    }>;

    const b24 = new Array<number>(24).fill(0);
    const b7 = new Array<number>(7).fill(0);
    const b30 = new Array<number>(30).fill(0);
    let prev24 = 0;
    let prev7 = 0;
    let prev30 = 0;

    for (const { ts } of rows) {
      if (ts >= h24Start && ts < h24End) b24[Math.floor((ts - h24Start) / HOUR_MS)] += 1;
      else if (ts >= prev24Start && ts < h24Start) prev24 += 1;

      const i7 = edgeIndex(d7, ts);
      if (i7 >= 0) b7[i7] += 1;
      else if (ts >= prev7Start && ts < d7[0]) prev7 += 1;

      const i30 = edgeIndex(d30, ts);
      if (i30 >= 0) b30[i30] += 1;
      else if (ts >= prev30Start && ts < d30[0]) prev30 += 1;
    }

    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const lastRow = db.prepare(`SELECT MAX(ts) AS lastTs FROM messages WHERE key = ?`).get(key) as unknown as {
      lastTs: number | null;
    };

    return {
      windows: {
        '24h': { buckets: b24, total: sum(b24), prevTotal: prev24, startMs: h24Start },
        '7d': { buckets: b7, total: sum(b7), prevTotal: prev7, startMs: d7[0] },
        '30d': { buckets: b30, total: sum(b30), prevTotal: prev30, startMs: d30[0] },
      },
      peakBand: null,
      quietBand: null,
      lastTs: lastRow.lastTs ?? null,
    };
  },
```

Add `ChannelActivity` to the existing `import type { … } from '../../shared/types'` at the top of `messages.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project integration tests/integration/storage/channel-activity.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/shared/types.ts src/main/storage/messages.ts tests/integration/storage/channel-activity.test.ts
git add src/shared/types.ts src/main/storage/messages.ts tests/integration/storage/channel-activity.test.ts
git commit -m "feat(activity): ChannelActivity types and window bucketing"
```

---

## Task 2: Rhythm bands (peak / quiet)

**Files:**
- Modify: `src/main/storage/messages.ts` (`activityByKey`)
- Test: `tests/integration/storage/channel-activity.test.ts`

**Interfaces:**
- Consumes: `ActivityBand`, `messagesStore.activityByKey` from Task 1.
- Produces: `activityByKey(...).peakBand` and `.quietBand` populated (`ActivityBand | null`).

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/storage/channel-activity.test.ts`, inside the same `describe`:

```ts
  it('nulls both bands when the trailing 168h is too sparse to name one', () => {
    const now = noonOf(1_700_000_000_000);
    for (let i = 0; i < 7; i++) seed('ch:Sparse', now - i * HOUR, 'name:a', `s${i}`);
    const a = messagesStore.activityByKey('ch:Sparse', now);
    expect(a.peakBand).toBe(null);
    expect(a.quietBand).toBe(null);
  });

  it('picks the busiest 3h peak band and calmest 4h quiet band', () => {
    const now = noonOf(1_700_000_000_000);
    // 20:00-22:59 gets 4 messages/hour on each of the last 3 days; the rest of
    // the clock gets a thin baseline so the total clears the sparsity guard.
    let n = 0;
    for (let day = 0; day < 3; day++) {
      for (const hour of [20, 21, 22]) {
        for (let k = 0; k < 4; k++) {
          const d = new Date(now);
          d.setDate(d.getDate() - day);
          d.setHours(hour, k * 10, 0, 0);
          seed('ch:Bands', d.getTime(), 'name:a', `peak${n++}`);
        }
      }
      for (const hour of [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 23]) {
        const d = new Date(now);
        d.setDate(d.getDate() - day);
        d.setHours(hour, 5, 0, 0);
        seed('ch:Bands', d.getTime(), 'name:a', `base${n++}`);
      }
    }

    const a = messagesStore.activityByKey('ch:Bands', now);
    expect(a.peakBand).toEqual({ startHour: 20, endHour: 23 });
    // Hours 0-8 are completely empty; the calmest 4h run starts at the
    // earliest such hour because ties break toward the earlier start.
    expect(a.quietBand).toEqual({ startHour: 0, endHour: 4 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration tests/integration/storage/channel-activity.test.ts`
Expected: FAIL — the two band tests get `null` / wrong values (the sparse test may already pass since Task 1 hardcodes `null`; the band test must fail).

- [ ] **Step 3: Implement the band search**

Add these module-level helpers to `src/main/storage/messages.ts`, beside `localDayEdges`:

```ts
/** Below this many messages in the trailing 168h, naming a "peak" is noise. */
const BAND_MIN_SAMPLES = 8;

/** Best contiguous `width`-hour band on a 24-slot hour-of-day histogram, searched
 *  circularly so a band may wrap midnight. Strict comparison means ties break
 *  toward the earlier start hour, which keeps the result deterministic. */
function bestBand(hist: number[], width: number, pick: 'max' | 'min'): ActivityBand {
  let bestStart = 0;
  let bestSum = pick === 'max' ? -1 : Number.POSITIVE_INFINITY;
  for (let start = 0; start < 24; start++) {
    let s = 0;
    for (let k = 0; k < width; k++) s += hist[(start + k) % 24];
    if (pick === 'max' ? s > bestSum : s < bestSum) {
      bestSum = s;
      bestStart = start;
    }
  }
  return { startHour: bestStart, endHour: (bestStart + width) % 24 };
}
```

Add `ActivityBand` to the shared-types import in `messages.ts`.

Inside `activityByKey`, build the histogram in the existing row loop. Add before the loop:

```ts
    const bandSince = now - 168 * HOUR_MS;
    const hourHist = new Array<number>(24).fill(0);
    let bandSamples = 0;
```

Add inside the `for (const { ts } of rows)` loop, at the end of the body:

```ts
      if (ts >= bandSince && ts <= now) {
        hourHist[new Date(ts).getHours()] += 1;
        bandSamples += 1;
      }
```

Replace the `peakBand: null, quietBand: null,` lines in the returned object with:

```ts
      peakBand: bandSamples >= BAND_MIN_SAMPLES ? bestBand(hourHist, 3, 'max') : null,
      quietBand: bandSamples >= BAND_MIN_SAMPLES ? bestBand(hourHist, 4, 'min') : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project integration tests/integration/storage/channel-activity.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/main/storage/messages.ts tests/integration/storage/channel-activity.test.ts
git add src/main/storage/messages.ts tests/integration/storage/channel-activity.test.ts
git commit -m "feat(activity): peak and quiet rhythm bands with sparsity guard"
```

---

## Task 3: Holder passthrough and HTTP route

**Files:**
- Modify: `src/main/state/holder.ts` (after `getChannelStats`, ~line 227)
- Modify: `src/main/api/routes.ts` (after the `/stats` route, ~line 447)
- Test: `tests/integration/api/routes.test.ts`

**Interfaces:**
- Consumes: `messagesStore.activityByKey`, `ChannelActivity` from Tasks 1–2.
- Produces: `stateHolder().getChannelActivity(key: string): ChannelActivity`; `GET /api/channels/:key/activity`.

- [ ] **Step 1: Write the failing test**

In `tests/integration/api/routes.test.ts`, append a new `describe` block after the existing `describe('GET /api/channels/:key/stats', …)`. It uses the file's existing `app()` helper (there is no `request` helper) and seeds inline with `messagesStore.insert`, exactly as the stats test does. `tests/integration/setup.ts` gives every `it()` a fresh temp userData dir, so the DB starts empty each time.

```ts
describe('GET /api/channels/:key/activity', () => {
  it('rejects a non-channel key with 400', async () => {
    const res = await app().request('/api/channels/c%3Aabcd/activity');
    expect(res.status).toBe(400);
  });

  it('returns ChannelActivity for a channel key', async () => {
    messagesStore.insert({
      id: 'ca1',
      key: 'ch:Act',
      ts: Date.now() - 3_600_000,
      body: 'hi',
      state: 'received',
      fromPublicKeyHex: 'name:alice',
    } as Message);
    const res = await app().request('/api/channels/ch%3AAct/activity');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChannelActivity;
    expect(body.windows['24h'].buckets).toHaveLength(24);
    expect(body.windows['7d'].buckets).toHaveLength(7);
    expect(body.windows['30d'].buckets).toHaveLength(30);
    expect(body.windows['24h'].total).toBe(1);
    expect(body.lastTs).toBeTruthy();
  });
});
```

Add `ChannelActivity` to that file's shared-types import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration tests/integration/api/routes.test.ts`
Expected: FAIL — the activity request 404s.

- [ ] **Step 3: Add the holder passthrough**

In `src/main/state/holder.ts`, directly after `getChannelStats`:

```ts
  getChannelActivity(key: string): ChannelActivity {
    return messagesStore.activityByKey(key);
  }
```

Add `ChannelActivity` to the shared-types import in that file.

- [ ] **Step 4: Add the route**

In `src/main/api/routes.ts`, directly after the `/api/channels/:key/stats` route:

```ts
  api.get('/api/channels/:key/activity', (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    if (!key.startsWith('ch:')) return c.json({ error: 'not a channel key' }, 400);
    return c.json(stateHolder().getChannelActivity(key));
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project integration tests/integration/api/routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/main/state/holder.ts src/main/api/routes.ts tests/integration/api/routes.test.ts
git add src/main/state/holder.ts src/main/api/routes.ts tests/integration/api/routes.test.ts
git commit -m "feat(activity): expose channel activity over HTTP"
```

---

## Task 4: API client and `useChannelActivity` hook

**Files:**
- Modify: `src/renderer/lib/api.ts:152`
- Create: `src/renderer/hooks/useChannelActivity.ts`
- Test: `tests/component/use-channel-activity.test.tsx`

**Interfaces:**
- Consumes: `ChannelActivity` from Task 1; `GET /api/channels/:key/activity` from Task 3.
- Produces: `api.getChannelActivity(c: ApiClient, key: string): Promise<ChannelActivity>`; `useChannelActivity(key: string, client: ApiClient | null): { activity: ChannelActivity | null; loading: boolean; error: string | null }`.

- [ ] **Step 1: Write the failing test**

First read `tests/component/use-channel-stats.test.tsx` — it is the exact template for mocking `@/lib/api` and driving zustand. Create `tests/component/use-channel-activity.test.tsx` mirroring it:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelActivity } from '@/hooks/useChannelActivity';
import { useStore } from '@/lib/store';
import type { ChannelActivity } from '../../src/shared/types';

const emptyWindow = (len: number) => ({ buckets: new Array(len).fill(0), total: 0, prevTotal: 0, startMs: 0 });
const payload = (): ChannelActivity => ({
  windows: { '24h': emptyWindow(24), '7d': emptyWindow(7), '30d': emptyWindow(30) },
  peakBand: null,
  quietBand: null,
  lastTs: 1_700_000_000_000,
});

const getChannelActivity = vi.fn(async () => payload());
vi.mock('@/lib/api', () => ({
  api: {
    getChannelActivity: (...args: unknown[]) => getChannelActivity(...(args as [])),
  },
}));

const client = {} as never;

describe('useChannelActivity', () => {
  beforeEach(() => {
    getChannelActivity.mockClear();
  });

  it('fetches on mount and exposes the payload', async () => {
    const { result } = renderHook(() => useChannelActivity('ch:Test', client));
    await waitFor(() => expect(result.current.activity).toBeTruthy());
    expect(result.current.loading).toBe(false);
    expect(result.current.activity?.windows['30d'].buckets).toHaveLength(30);
  });

  it('refetches when the channel message list changes', async () => {
    renderHook(() => useChannelActivity('ch:Test', client));
    await waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(1));
    act(() => {
      useStore.setState((s) => ({ messagesByKey: { ...s.messagesByKey, 'ch:Test': [] } }));
    });
    await waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(2));
  });

  it('surfaces a fetch error', async () => {
    getChannelActivity.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useChannelActivity('ch:Test', client));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/use-channel-activity.test.tsx`
Expected: FAIL — cannot resolve `@/hooks/useChannelActivity`.

- [ ] **Step 3: Add the API client method**

In `src/renderer/lib/api.ts`, directly after the `getChannelStats` line:

```ts
  getChannelActivity: (c: ApiClient, key: string) =>
    request<ChannelActivity>(c, `/api/channels/${encodeURIComponent(key)}/activity`),
```

Add `ChannelActivity` to that file's shared-types import.

- [ ] **Step 4: Write the hook**

Create `src/renderer/hooks/useChannelActivity.ts`:

```ts
import { useEffect, useState } from 'react';
import type { ChannelActivity } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

/** Nothing in the app invalidates on wall-clock rollover, so an idle channel's
 *  trailing window would drift stale indefinitely. Re-poll coarsely. */
const REFRESH_MS = 300_000;

/** Fetches the channel activity histogram lazily (the rail only mounts a section's
 *  body when it is expanded) and refetches whenever this channel's message list
 *  changes or the refresh interval elapses. */
export function useChannelActivity(
  key: string,
  client: ApiClient | null,
): { activity: ChannelActivity | null; loading: boolean; error: string | null } {
  const messages = useStore((s) => s.messagesByKey[key]);
  const [activity, setActivity] = useState<ChannelActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messagesByKey[key] and tick are refetch triggers, not read inside the effect
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getChannelActivity(client, key).then(
      (a) => {
        if (!cancelled) {
          setActivity(a);
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
  }, [client, key, messages, tick]);

  return { activity, loading, error };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/use-channel-activity.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/renderer/lib/api.ts src/renderer/hooks/useChannelActivity.ts tests/component/use-channel-activity.test.tsx
git add src/renderer/lib/api.ts src/renderer/hooks/useChannelActivity.ts tests/component/use-channel-activity.test.tsx
git commit -m "feat(activity): api client and useChannelActivity hook"
```

---

## Task 5: `fmtAgoShort` time utility

**Files:**
- Modify: `src/renderer/lib/time.ts`
- Modify: `src/renderer/panels/DMView.tsx:99,140-147`
- Test: `tests/unit/renderer/lib/time-fmtAgoShort.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `fmtAgoShort(ts: number, now?: number): string` exported from `src/renderer/lib/time`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/time-fmtAgoShort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fmtAgoShort } from '../../../../src/renderer/lib/time';

const NOW = 1_700_000_000_000;

describe('fmtAgoShort', () => {
  it('reports sub-minute ages as "just now"', () => {
    expect(fmtAgoShort(NOW, NOW)).toBe('just now');
    expect(fmtAgoShort(NOW - 59_000, NOW)).toBe('just now');
  });

  it('reports minutes, hours and days compactly', () => {
    expect(fmtAgoShort(NOW - 60_000, NOW)).toBe('1m ago');
    expect(fmtAgoShort(NOW - 59 * 60_000, NOW)).toBe('59m ago');
    expect(fmtAgoShort(NOW - 60 * 60_000, NOW)).toBe('1h ago');
    expect(fmtAgoShort(NOW - 23 * 3_600_000, NOW)).toBe('23h ago');
    expect(fmtAgoShort(NOW - 24 * 3_600_000, NOW)).toBe('1d ago');
    expect(fmtAgoShort(NOW - 400 * 3_600_000, NOW)).toBe('16d ago');
  });

  it('clamps future timestamps to "just now" rather than emitting a negative age', () => {
    expect(fmtAgoShort(NOW + 60_000, NOW)).toBe('just now');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/lib/time-fmtAgoShort.test.ts`
Expected: FAIL — `fmtAgoShort` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/renderer/lib/time.ts`:

```ts
/** Compact age for dense UI: "just now" / "3m ago" / "5h ago" / "2d ago".
 *  `fmtRelative` produces the long Intl form ("3 minutes ago"), which is too
 *  wide for the rail. Future timestamps clamp to "just now" — clock skew
 *  between the radio and the host should never render as a negative age. */
export function fmtAgoShort(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/lib/time-fmtAgoShort.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Retire DMView's private copy**

In `src/renderer/panels/DMView.tsx`:
1. Delete the whole `function fmtAgo(ms: number): string { … }` block at lines 140-147.
2. Change the call at line 99 from `fmtAgo(contact.lastSeenMs)` to `fmtAgoShort(contact.lastSeenMs)`.
3. Add `fmtAgoShort` to the existing import from `../lib/time` (create the import if the file has none).

The semantics are identical — the old `fmtAgo` used the same `m < 1` / `m < 60` / `h < 24` ladder and read `Date.now()` internally, which is now the parameter default.

- [ ] **Step 6: Verify nothing else referenced it**

Run: `grep -rn "fmtAgo\b" src/`
Expected: no hits (only `fmtAgoShort` remains).

- [ ] **Step 7: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/renderer/lib/time.ts src/renderer/panels/DMView.tsx tests/unit/renderer/lib/time-fmtAgoShort.test.ts
git add src/renderer/lib/time.ts src/renderer/panels/DMView.tsx tests/unit/renderer/lib/time-fmtAgoShort.test.ts
git commit -m "feat(time): shared fmtAgoShort, retiring DMView's private copy"
```

---

## Task 6: Pure presentation helpers (`activity.ts`)

**Files:**
- Create: `src/renderer/shell/rightrail/sections/channel-activity/activity.ts`
- Test: `tests/unit/renderer/shell/rightrail/channel-activity.test.ts`

**Interfaces:**
- Consumes: `ActivityWindow`, `ActivityBand`, `ActivityWindowKey` from Task 1.
- Produces, all from `channel-activity/activity`:
  - `COLLAPSE_WIDTH: 304`
  - `type ActivityMode = 'collapsed' | 'full'`
  - `trendPct(total: number, prevTotal: number): number | null`
  - `bucketStart(win: ActivityWindowKey, startMs: number, i: number): number`
  - `axisTicks(win: ActivityWindowKey, startMs: number, len: number): string[]`
  - `bucketLabel(win: ActivityWindowKey, startMs: number, i: number, len: number): string`
  - `fmtBand(band: ActivityBand): string`
  - `chartAriaLabel(win: ActivityWindowKey, data: ActivityWindow): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/shell/rightrail/channel-activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  axisTicks,
  bucketLabel,
  chartAriaLabel,
  fmtBand,
  trendPct,
} from '../../../../../src/renderer/shell/rightrail/sections/channel-activity/activity';

/** 2023-11-14 00:00 local. Fixed local midnight keeps hour/day labels stable. */
const midnight = (() => {
  const d = new Date(1_700_000_000_000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

describe('trendPct', () => {
  it('rounds the percentage change against the previous period', () => {
    expect(trendPct(123, 104)).toBe(18);
    expect(trendPct(412, 498)).toBe(-17);
  });

  it('returns null when there is no previous period to compare against', () => {
    expect(trendPct(50, 0)).toBe(null);
  });

  it('reports a total collapse as -100 rather than dividing by zero', () => {
    expect(trendPct(0, 40)).toBe(-100);
  });
});

describe('axisTicks', () => {
  it('labels 24h at the quarter hours and always ends with "now"', () => {
    const ticks = axisTicks('24h', midnight, 24);
    expect(ticks).toHaveLength(24);
    expect(ticks[0]).toBe('12a');
    expect(ticks[6]).toBe('6a');
    expect(ticks[12]).toBe('12p');
    expect(ticks[18]).toBe('6p');
    expect(ticks[23]).toBe('now');
    expect(ticks[1]).toBe('');
  });

  it('derives 7d weekday initials from the real dates, not a fixed M-T-W string', () => {
    const ticks = axisTicks('7d', midnight, 7);
    expect(ticks).toHaveLength(7);
    const expected = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(midnight);
      d.setDate(d.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: 'short' }).charAt(0);
    });
    expect(ticks).toEqual(expected);
  });

  it('labels 30d at four sparse positions', () => {
    const ticks = axisTicks('30d', midnight, 30);
    expect(ticks).toHaveLength(30);
    expect(ticks[0]).toBe('30d');
    expect(ticks[10]).toBe('20d');
    expect(ticks[20]).toBe('10d');
    expect(ticks[29]).toBe('now');
    expect(ticks[5]).toBe('');
  });
});

describe('bucketLabel', () => {
  it('names hours, weekdays and day offsets', () => {
    expect(bucketLabel('24h', midnight, 18, 24)).toBe('6 PM');
    expect(bucketLabel('24h', midnight, 0, 24)).toBe('12 AM');
    expect(bucketLabel('30d', midnight, 29, 30)).toBe('today');
    expect(bucketLabel('30d', midnight, 21, 30)).toBe('8d ago');
    const d = new Date(midnight);
    expect(bucketLabel('7d', midnight, 0, 7)).toBe(d.toLocaleDateString(undefined, { weekday: 'short' }));
  });
});

describe('fmtBand', () => {
  it('shares the meridiem when both ends agree', () => {
    expect(fmtBand({ startHour: 19, endHour: 22 })).toBe('7–10 PM');
    expect(fmtBand({ startHour: 2, endHour: 6 })).toBe('2–6 AM');
  });

  it('spells out both when the band crosses noon or midnight', () => {
    expect(fmtBand({ startHour: 23, endHour: 2 })).toBe('11 PM–2 AM');
    expect(fmtBand({ startHour: 10, endHour: 13 })).toBe('10 AM–1 PM');
  });
});

describe('chartAriaLabel', () => {
  it('summarises the window for screen readers', () => {
    const buckets = new Array(24).fill(0);
    buckets[18] = 14;
    const label = chartAriaLabel('24h', { buckets, total: 14, prevTotal: 0, startMs: midnight });
    expect(label).toContain('last 24 hours');
    expect(label).toContain('14 messages');
    expect(label).toContain('6 PM');
  });

  it('says so when the window is empty', () => {
    const buckets = new Array(7).fill(0);
    const label = chartAriaLabel('7d', { buckets, total: 0, prevTotal: 0, startMs: midnight });
    expect(label).toContain('No messages');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/shell/rightrail/channel-activity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/shell/rightrail/sections/channel-activity/activity.ts`:

```ts
import type { ActivityBand, ActivityWindow, ActivityWindowKey } from '../../../../../shared/types';

/** Rail widths below this drop the section to number + trend + bare sparkline.
 *  Measured against the rail's OUTER width (ui.rightWidth), which is what the
 *  design reference measured. Rail bounds are 240 / 320 default / 640. */
export const COLLAPSE_WIDTH = 304;

export type ActivityMode = 'collapsed' | 'full';

const HOUR_MS = 3_600_000;

/** Percentage change vs the previous equal period, or null when there is no
 *  previous period — a channel's first week has nothing to compare against and
 *  must not render NaN% or Infinity%. */
export function trendPct(total: number, prevTotal: number): number | null {
  if (prevTotal <= 0) return null;
  return Math.round(((total - prevTotal) / prevTotal) * 100);
}

/** Start edge of bucket `i`. Daily windows step calendar days via setDate() so a
 *  DST day stays one bucket; the hourly window is plain ms arithmetic. */
export function bucketStart(win: ActivityWindowKey, startMs: number, i: number): number {
  if (win === '24h') return startMs + i * HOUR_MS;
  const d = new Date(startMs);
  d.setDate(d.getDate() + i);
  return d.getTime();
}

function hour12(h: number): { n: number; ap: 'AM' | 'PM' } {
  const ap: 'AM' | 'PM' = h < 12 ? 'AM' : 'PM';
  const n = h % 12 === 0 ? 12 : h % 12;
  return { n, ap };
}

/** Sparse axis labels, one entry per bucket so they align with the flex-1 bars.
 *  Positions are computed from real bucket edges — hardcoding "M T W T F S S"
 *  would be wrong on any day that is not a Sunday. */
export function axisTicks(win: ActivityWindowKey, startMs: number, len: number): string[] {
  const out = new Array<string>(len).fill('');
  if (win === '24h') {
    for (let i = 0; i < len; i++) {
      const h = new Date(bucketStart(win, startMs, i)).getHours();
      if (h === 0) out[i] = '12a';
      else if (h === 6) out[i] = '6a';
      else if (h === 12) out[i] = '12p';
      else if (h === 18) out[i] = '6p';
    }
  } else if (win === '7d') {
    for (let i = 0; i < len; i++) {
      out[i] = new Date(bucketStart(win, startMs, i)).toLocaleDateString(undefined, { weekday: 'short' }).charAt(0);
    }
    return out;
  } else {
    if (len > 0) out[0] = '30d';
    if (len > 10) out[10] = '20d';
    if (len > 20) out[20] = '10d';
  }
  if (len > 0) out[len - 1] = 'now';
  return out;
}

/** Tooltip bucket name: "6 PM", "Mon", "8d ago", "today". */
export function bucketLabel(win: ActivityWindowKey, startMs: number, i: number, len: number): string {
  const at = new Date(bucketStart(win, startMs, i));
  if (win === '24h') {
    const { n, ap } = hour12(at.getHours());
    return `${n} ${ap}`;
  }
  if (win === '7d') return at.toLocaleDateString(undefined, { weekday: 'short' });
  const back = len - 1 - i;
  return back === 0 ? 'today' : `${back}d ago`;
}

/** "7–10 PM" when both ends share a meridiem, "11 PM–2 AM" when they do not. */
export function fmtBand(band: ActivityBand): string {
  const s = hour12(band.startHour);
  const e = hour12(band.endHour);
  return s.ap === e.ap ? `${s.n}–${e.n} ${s.ap}` : `${s.n} ${s.ap}–${e.n} ${e.ap}`;
}

const WINDOW_PHRASE: Record<ActivityWindowKey, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
};

/** The chart is a role="img" whose bars are decorative, so this label is the
 *  entire read-out for assistive tech — it has to carry the shape, not just
 *  the title. Hover tooltips are a pointer-only enhancement. */
export function chartAriaLabel(win: ActivityWindowKey, data: ActivityWindow): string {
  const unit = win === '24h' ? 'hour' : 'day';
  const head = `Message volume by ${unit}, ${WINDOW_PHRASE[win]}.`;
  if (data.total === 0) return `${head} No messages.`;
  let peak = 0;
  for (let i = 1; i < data.buckets.length; i++) if (data.buckets[i] > data.buckets[peak]) peak = i;
  const at = bucketLabel(win, data.startMs, peak, data.buckets.length);
  return `${head} ${data.total} messages, busiest ${data.buckets[peak]} at ${at}.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/shell/rightrail/channel-activity.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/renderer/shell/rightrail/sections/channel-activity/activity.ts tests/unit/renderer/shell/rightrail/channel-activity.test.ts
git add src/renderer/shell/rightrail/sections/channel-activity/activity.ts tests/unit/renderer/shell/rightrail/channel-activity.test.ts
git commit -m "feat(activity): pure bucketing, labelling and formatting helpers"
```

---

## Task 7: Trend tokens and `TrendChip`

**Files:**
- Modify: `src/renderer/index.css` (`:root` ~line 31, `:root:not(.dark)` ~line 58, `@theme` ~line 100)
- Create: `src/renderer/shell/rightrail/sections/channel-activity/TrendChip.tsx`
- Test: `tests/component/activity-trend-chip.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `TrendChip({ pct, showVsPrev }: { pct: number; showVsPrev: boolean })`. The caller is responsible for not rendering it when `trendPct` returned `null`.

- [ ] **Step 1: Add the tokens**

These values were chosen by measuring the chip's text against **its own 13% fill** composited over `cs-bg`, `cs-bg-2` and `cs-bg-3` — not against the page, which overstates by ~1 point. Do not substitute other hexes.

In `src/renderer/index.css`, inside `:root` (after `--cs-danger: 220 38 38;`):

```css
  /* Trend chip. Deliberately not --cs-online/--cs-danger: those fail AA at a 13%
     fill in dark (3.20 for danger), and danger is the destructive-action red —
     a quiet channel is not an error. Contrast measured against the chip's own
     fill over bg/bg-2/bg-3, per the --cs-hash-* note below. */
  --cs-trend-up: 132 204 22; /* #84CC16 — 8.21 / 7.41 / 6.71 */
  --cs-trend-down: 232 117 107; /* #E8756B — 5.83 / 5.29 / 4.81 */
```

In the `:root:not(.dark)` block (after the three `--cs-hash-*` overrides):

```css
  --cs-trend-up: 54 83 20; /* #365314 — 6.75 / 6.21 / 5.37 */
  --cs-trend-down: 139 37 32; /* #8B2520 — 6.70 / 6.16 / 5.33 */
```

In the `@theme` block (after `--color-cs-danger`):

```css
  --color-cs-trend-up: rgb(var(--cs-trend-up));
  --color-cs-trend-down: rgb(var(--cs-trend-down));
```

- [ ] **Step 2: Write the failing test**

Create `tests/component/activity-trend-chip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendChip } from '@/shell/rightrail/sections/channel-activity/TrendChip';

describe('TrendChip', () => {
  it('renders an upward chip with the vs-prev suffix', () => {
    const { container } = render(<TrendChip pct={18} showVsPrev={true} />);
    expect(screen.getByText('18%')).toBeTruthy();
    expect(screen.getByText('vs prev')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-up')).toBeTruthy();
  });

  it('renders a downward chip with the sign stripped from the number', () => {
    const { container } = render(<TrendChip pct={-17} showVsPrev={true} />);
    expect(screen.getByText('17%')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-down')).toBeTruthy();
  });

  it('omits the vs-prev suffix in mini form', () => {
    render(<TrendChip pct={18} showVsPrev={false} />);
    expect(screen.queryByText('vs prev')).toBe(null);
  });

  it('names the direction for assistive tech, since the arrow is decorative', () => {
    render(<TrendChip pct={-17} showVsPrev={false} />);
    expect(screen.getByText('down', { exact: false })).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/activity-trend-chip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `TrendChip`**

Create `src/renderer/shell/rightrail/sections/channel-activity/TrendChip.tsx`:

```tsx
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../../../../lib/utils';

/** Δ vs the previous equal period. Direction only — green/coral are a sign, not a
 *  verdict, so there is deliberately no alarm styling on a decline. Render this
 *  only when trendPct() returned a number; a null trend has no chip at all. */
export function TrendChip({ pct, showVsPrev }: { pct: number; showVsPrev: boolean }) {
  const up = pct >= 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'ml-auto inline-flex items-center gap-[3px] whitespace-nowrap rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        up ? 'bg-cs-trend-up/13 text-cs-trend-up' : 'bg-cs-trend-down/13 text-cs-trend-down',
      )}
    >
      <Icon aria-hidden="true" className="size-2.5" />
      <span className="sr-only">{up ? 'up ' : 'down '}</span>
      {/* Own element so the percentage is a single matchable text node. */}
      <span>{Math.abs(pct)}%</span>
      {showVsPrev && <span className="ml-px font-normal opacity-70">vs prev</span>}
    </span>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/activity-trend-chip.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/renderer/index.css src/renderer/shell/rightrail/sections/channel-activity/TrendChip.tsx tests/component/activity-trend-chip.test.tsx
git add src/renderer/index.css src/renderer/shell/rightrail/sections/channel-activity/TrendChip.tsx tests/component/activity-trend-chip.test.tsx
git commit -m "feat(activity): themed trend tokens and TrendChip"
```

---

## Task 8: `VolumeChart`

**Files:**
- Create: `src/renderer/shell/rightrail/sections/channel-activity/VolumeChart.tsx`
- Test: `tests/component/activity-volume-chart.test.tsx`

**Interfaces:**
- Consumes: `axisTicks`, `bucketLabel`, `chartAriaLabel`, `ActivityMode` from Task 6; `ActivityWindow`, `ActivityWindowKey` from Task 1.
- Produces: `VolumeChart({ winKey, data, mode }: { winKey: ActivityWindowKey; data: ActivityWindow; mode: ActivityMode })`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/activity-volume-chart.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VolumeChart } from '@/shell/rightrail/sections/channel-activity/VolumeChart';
import type { ActivityWindow } from '../../src/shared/types';

const midnight = (() => {
  const d = new Date(1_700_000_000_000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

const win = (len: number, fill = 0): ActivityWindow => ({
  buckets: new Array(len).fill(fill),
  total: len * fill,
  prevTotal: 0,
  startMs: midnight,
});

const renderChart = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('VolumeChart', () => {
  it('renders one bar per bucket with an axis in full mode', () => {
    const { container } = renderChart(<VolumeChart winKey="24h" data={win(24, 3)} mode="full" />);
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBeTruthy();
  });

  it('drops the axis and shortens the plot in collapsed mode', () => {
    const { container } = renderChart(<VolumeChart winKey="24h" data={win(24, 3)} mode="collapsed" />);
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBe(null);
    const plot = container.querySelector('[role="img"]') as HTMLElement;
    expect(plot.style.height).toBe('30px');
  });

  it('renders 7 and 30 bar variants', () => {
    const seven = renderChart(<VolumeChart winKey="7d" data={win(7, 2)} mode="full" />);
    expect(seven.container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(7);
    const thirty = renderChart(<VolumeChart winKey="30d" data={win(30, 2)} mode="full" />);
    expect(thirty.container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(30);
  });

  it('normalises bar heights to the window max', () => {
    const data: ActivityWindow = { buckets: [0, 5, 10], total: 15, prevTotal: 0, startMs: midnight };
    const { container } = renderChart(<VolumeChart winKey="7d" data={data} mode="full" />);
    const bars = container.querySelectorAll<HTMLElement>('[data-testid="activity-bar"]');
    expect(bars[2].style.height).toContain('100%');
    expect(bars[1].style.height).toContain('50%');
  });

  it('draws a flat baseline for an all-zero window instead of dividing by zero', () => {
    const { container } = renderChart(<VolumeChart winKey="7d" data={win(7, 0)} mode="full" />);
    const bars = container.querySelectorAll<HTMLElement>('[data-testid="activity-bar"]');
    for (const bar of bars) expect(bar.style.height).toContain('0%');
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('No messages');
  });

  it('exposes the chart to assistive tech as a single labelled image', () => {
    const { container } = renderChart(<VolumeChart winKey="24h" data={win(24, 3)} mode="full" />);
    const plot = container.querySelector('[role="img"]');
    expect(plot?.getAttribute('aria-label')).toContain('last 24 hours');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/activity-volume-chart.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `VolumeChart`**

Create `src/renderer/shell/rightrail/sections/channel-activity/VolumeChart.tsx`:

```tsx
import type { ActivityWindow, ActivityWindowKey } from '../../../../../shared/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { type ActivityMode, axisTicks, bucketLabel, chartAriaLabel } from './activity';

const CELL = 'flex h-full flex-1 items-end rounded-t-[2px] hover:bg-cs-accent/9';
const BAR =
  'min-h-[2px] w-full rounded-t-[2px] bg-cs-accent transition-[height] duration-[180ms] ease-out motion-reduce:transition-none';

/** Plain flex-div bars — no charting library, per the design handoff. The plot is
 *  a single role="img" with a generated label; individual bars are decorative, so
 *  hover tooltips stay a pointer-only enhancement rather than 30 tab stops. */
export function VolumeChart({
  winKey,
  data,
  mode,
}: {
  winKey: ActivityWindowKey;
  data: ActivityWindow;
  mode: ActivityMode;
}) {
  const full = mode === 'full';
  // Guard the divisor so an all-zero window draws a flat baseline rather than NaN.
  const max = Math.max(1, ...data.buckets);
  const ticks = full ? axisTicks(winKey, data.startMs, data.buckets.length) : null;

  return (
    <div className="mt-3">
      <div
        role="img"
        aria-label={chartAriaLabel(winKey, data)}
        className="flex items-end gap-0.5"
        style={{ height: full ? 74 : 30 }}
      >
        {data.buckets.map((v, i) => {
          const style = { height: `${(v / max) * 100}%` };
          if (!full) {
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional bar chart; the index is the identity
            return (
              <div key={i} className={CELL}>
                <div data-testid="activity-bar" className={BAR} style={style} />
              </div>
            );
          }
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional bar chart; the index is the identity
            <Tooltip key={i}>
              {/* asChild needs a real DOM child so Radix can attach its ref. */}
              <TooltipTrigger asChild>
                <div className={CELL}>
                  <div data-testid="activity-bar" className={BAR} style={style} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                {`${v} msg${v === 1 ? '' : 's'} · ${bucketLabel(winKey, data.startMs, i, data.buckets.length)}`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {ticks && (
        <div data-testid="activity-axis" className="mt-1.5 flex gap-0.5">
          {ticks.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional axis, one tick per bar
            <span key={`${winKey}-tick-${i}`} className="flex-1 text-center font-mono text-[8.5px] text-cs-text-dim">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note the `min-h-[2px]` on the bar is what makes a zero bucket visible as a baseline, so the inline height is a plain percentage. The two-`div` cell appears twice because `TooltipTrigger asChild` must wrap a real DOM element (a function component would need to forward the ref Radix attaches); the class strings are hoisted to `CELL`/`BAR` so there is no literal duplication.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/activity-volume-chart.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/renderer/shell/rightrail/sections/channel-activity/VolumeChart.tsx tests/component/activity-volume-chart.test.tsx
git add src/renderer/shell/rightrail/sections/channel-activity/VolumeChart.tsx tests/component/activity-volume-chart.test.tsx
git commit -m "feat(activity): VolumeChart with axis ticks and hover read-outs"
```

---

## Task 9: `WindowTabs` and the persisted window preference

**Files:**
- Modify: `src/shared/types.ts` (`UiState` ~line 788, `DEFAULT_UI_STATE` ~line 842)
- Modify: `src/renderer/lib/store.ts` (action type ~line 421, impl ~line 889)
- Create: `src/renderer/shell/rightrail/sections/channel-activity/WindowTabs.tsx`
- Test: `tests/component/activity-window-tabs.test.tsx`

**Interfaces:**
- Consumes: `ActivityWindowKey` from Task 1.
- Produces: `UiState.channelActivityWindow: ActivityWindowKey`; `useStore().setChannelActivityWindow(w: ActivityWindowKey)`; `WindowTabs({ value, onChange }: { value: ActivityWindowKey; onChange: (w: ActivityWindowKey) => void })`.

- [ ] **Step 1: Add the persisted preference**

In `src/shared/types.ts`, in the `UiState` interface, directly after the `packetLogFilter` line:

```ts
  /** Selected window in the channel rail's Activity section. Global rather than
   *  per-channel: it is a reading habit, and a per-channel map would grow one
   *  entry per channel ever opened. */
  channelActivityWindow: ActivityWindowKey;
```

In `DEFAULT_UI_STATE`, directly after the `packetLogFilter` default:

```ts
  channelActivityWindow: '24h',
```

In `src/renderer/lib/store.ts`, add to the actions interface after `setPacketLogFilter`:

```ts
  setChannelActivityWindow: (w: ActivityWindowKey) => void;
```

and the implementation after the `setPacketLogFilter` impl:

```ts
  setChannelActivityWindow: (w) => set((s) => ({ ui: { ...s.ui, channelActivityWindow: w } })),
```

Add `ActivityWindowKey` to the store's shared-types import. No persistence plumbing is needed — the debounced effect in `App.tsx:187-198` writes the whole `ui` object, and `mergeDefaults` in `src/main/storage/settings.ts:174-190` is recursive, so existing installs pick up `'24h'` automatically. Deliberately do **not** add it to the synced subset in `applyUiState` (`store.ts:762-769`); like `rightWidth` it is write-through only.

- [ ] **Step 2: Write the failing test**

Create `tests/component/activity-window-tabs.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WindowTabs } from '@/shell/rightrail/sections/channel-activity/WindowTabs';

describe('WindowTabs', () => {
  it('renders the three windows and marks the selected one', () => {
    render(<WindowTabs value="7d" onChange={() => {}} />);
    expect(screen.getByText('24h')).toBeTruthy();
    expect(screen.getByText('30d')).toBeTruthy();
    expect(screen.getByLabelText('Last 7 days').getAttribute('data-state')).toBe('on');
    expect(screen.getByLabelText('Last 24 hours').getAttribute('data-state')).toBe('off');
  });

  it('reports the newly selected window', () => {
    const onChange = vi.fn();
    render(<WindowTabs value="24h" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Last 30 days'));
    expect(onChange).toHaveBeenCalledWith('30d');
  });

  it('ignores a deselect click on the active tab rather than clearing the window', () => {
    const onChange = vi.fn();
    render(<WindowTabs value="24h" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Last 24 hours'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/activity-window-tabs.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `WindowTabs`**

Create `src/renderer/shell/rightrail/sections/channel-activity/WindowTabs.tsx`:

```tsx
import type { ActivityWindowKey } from '../../../../../shared/types';
import { ToggleGroup, ToggleGroupItem } from '../../../../components/ui/toggle-group';

/** "24h" alone is not comprehensible read aloud, so each item carries a spelled-out
 *  label for assistive tech while the visible text stays compact. */
const OPTIONS: Array<{ value: ActivityWindowKey; label: string; aria: string }> = [
  { value: '24h', label: '24h', aria: 'Last 24 hours' },
  { value: '7d', label: '7d', aria: 'Last 7 days' },
  { value: '30d', label: '30d', aria: 'Last 30 days' },
];

/** Radix ToggleGroup gives arrow-key roving focus for free; the className overrides
 *  strip its shadcn defaults (h-8, rounded-none/first:rounded-l-md, bg-accent when
 *  on, flex-1 stretching) down to the compact segmented control the design calls for. */
export function WindowTabs({
  value,
  onChange,
}: {
  value: ActivityWindowKey;
  onChange: (w: ActivityWindowKey) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Radix emits '' when the active item is clicked again; keep the window pinned.
      onValueChange={(v) => {
        if (v) onChange(v as ActivityWindowKey);
      }}
      aria-label="Activity window"
      className="mb-3 inline-flex w-fit gap-0.5 rounded-[7px] border border-cs-border bg-cs-bg-3 p-0.5"
    >
      {OPTIONS.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          aria-label={o.aria}
          className="h-auto min-w-0 flex-none rounded-[5px] px-[9px] py-1 font-mono text-[10.5px] font-medium text-cs-text-muted hover:bg-transparent hover:text-cs-text data-[state=on]:bg-cs-bg data-[state=on]:text-cs-accent data-[state=on]:shadow-[0_1px_0_rgba(0,0,0,0.3)]"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/activity-window-tabs.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/shared/types.ts src/renderer/lib/store.ts src/renderer/shell/rightrail/sections/channel-activity/WindowTabs.tsx tests/component/activity-window-tabs.test.tsx
git add src/shared/types.ts src/renderer/lib/store.ts src/renderer/shell/rightrail/sections/channel-activity/WindowTabs.tsx tests/component/activity-window-tabs.test.tsx
git commit -m "feat(activity): window tabs with a persisted window preference"
```

---

## Task 10: `RhythmFooter`

**Files:**
- Create: `src/renderer/shell/rightrail/sections/channel-activity/RhythmFooter.tsx`
- Test: `tests/component/activity-rhythm-footer.test.tsx`

**Interfaces:**
- Consumes: `fmtBand` and `ActivityMode` from Task 6; `fmtAgoShort` from Task 5; `ActivityBand` from Task 1.
- Produces: `RhythmFooter({ peak, quiet, lastTs, mode, now }: { peak: ActivityBand | null; quiet: ActivityBand | null; lastTs: number | null; mode: ActivityMode; now: number })`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/activity-rhythm-footer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RhythmFooter } from '@/shell/rightrail/sections/channel-activity/RhythmFooter';

const NOW = 1_700_000_000_000;
const peak = { startHour: 19, endHour: 22 };
const quiet = { startHour: 2, endHour: 6 };

describe('RhythmFooter', () => {
  it('renders peak, quiet and last message in full mode', () => {
    const { container } = render(
      <RhythmFooter peak={peak} quiet={quiet} lastTs={NOW - 180_000} mode="full" now={NOW} />,
    );
    expect(container.textContent).toContain('7–10 PM');
    expect(container.textContent).toContain('2–6 AM');
    expect(container.textContent).toContain('3m ago');
  });

  it('drops the quiet band in collapsed mode', () => {
    const { container } = render(
      <RhythmFooter peak={peak} quiet={quiet} lastTs={NOW - 180_000} mode="collapsed" now={NOW} />,
    );
    expect(container.textContent).toContain('7–10 PM');
    expect(container.textContent).not.toContain('2–6 AM');
    expect(container.textContent).toContain('3m ago');
  });

  it('degrades to just the last message when the channel is too sparse for bands', () => {
    const { container } = render(<RhythmFooter peak={null} quiet={null} lastTs={NOW - 180_000} mode="full" now={NOW} />);
    expect(container.textContent).toContain('3m ago');
    expect(container.textContent).not.toContain('Peak');
  });

  it('renders nothing when there is neither a band nor a last message', () => {
    const { container } = render(<RhythmFooter peak={null} quiet={null} lastTs={null} mode="full" now={NOW} />);
    expect(container.querySelector('[data-testid="activity-rhythm"]')).toBe(null);
  });

  it('omits the last-message clause but keeps the bands when lastTs is null', () => {
    render(<RhythmFooter peak={peak} quiet={quiet} lastTs={null} mode="full" now={NOW} />);
    expect(screen.getByText('7–10 PM')).toBeTruthy();
    expect(screen.queryByText(/last msg/)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/activity-rhythm-footer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `RhythmFooter`**

Create `src/renderer/shell/rightrail/sections/channel-activity/RhythmFooter.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { ActivityBand } from '../../../../../shared/types';
import { fmtAgoShort } from '../../../../lib/time';
import { type ActivityMode, fmtBand } from './activity';

function Value({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-cs-text">{children}</span>;
}

/** One muted line describing the channel's habit. The bands come from a fixed
 *  trailing-168h histogram, so they do not change when the window tab does —
 *  they describe the channel, not the selected period. */
export function RhythmFooter({
  peak,
  quiet,
  lastTs,
  mode,
  now,
}: {
  peak: ActivityBand | null;
  quiet: ActivityBand | null;
  lastTs: number | null;
  mode: ActivityMode;
  now: number;
}) {
  const parts: Array<{ id: string; node: ReactNode }> = [];
  if (peak) {
    parts.push({
      id: 'peak',
      node: (
        <>
          Peak <Value>{fmtBand(peak)}</Value>
        </>
      ),
    });
  }
  if (mode === 'full' && quiet) {
    parts.push({
      id: 'quiet',
      node: (
        <>
          quiet <Value>{fmtBand(quiet)}</Value>
        </>
      ),
    });
  }
  if (lastTs != null) {
    parts.push({
      id: 'last',
      node: (
        <>
          last msg <Value>{fmtAgoShort(lastTs, now)}</Value>
        </>
      ),
    });
  }
  if (parts.length === 0) return null;

  return (
    <p data-testid="activity-rhythm" className="mt-[13px] text-[11px] text-cs-text-muted">
      {parts.map((part, i) => (
        <span key={part.id}>
          {i > 0 && <span className="mx-[5px] text-cs-text-dim">·</span>}
          {part.node}
        </span>
      ))}
    </p>
  );
}
```

If the nested-key expression trips Biome or reads badly, simplify by building `parts` as an array of `{ id: string; node: ReactNode }` and keying on `id` — the behaviour must stay identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/activity-rhythm-footer.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
npx tsc --noEmit
npx biome check --write src/renderer/shell/rightrail/sections/channel-activity/RhythmFooter.tsx tests/component/activity-rhythm-footer.test.tsx
git add src/renderer/shell/rightrail/sections/channel-activity/RhythmFooter.tsx tests/component/activity-rhythm-footer.test.tsx
git commit -m "feat(activity): rhythm footer"
```

---

## Task 11: Assemble the section, wire it up, and remove the old code

**Files:**
- Create: `src/renderer/shell/rightrail/sections/channel-activity/index.tsx`
- Modify: `src/renderer/shell/rightrail/sectionsFor.tsx:8`
- Delete: `src/renderer/shell/rightrail/sections/ChannelActivity.tsx`, `src/renderer/components/Sparkline.tsx`, `tests/component/sparkline.test.tsx`
- Test: `tests/component/channel-activity-section.test.tsx` (rewritten)

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: `ActivityBody(props)` and `ChannelActivitySection({ channel, client })` from `channel-activity`.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/component/channel-activity-section.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActivityBody } from '@/shell/rightrail/sections/channel-activity';
import type { ActivityWindow, ChannelActivity } from '../../src/shared/types';

const NOW = 1_700_000_000_000;
const midnight = (() => {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

const w = (len: number, total: number, prevTotal: number): ActivityWindow => ({
  buckets: new Array(len).fill(Math.floor(total / len)),
  total,
  prevTotal,
  startMs: midnight,
});

const activity = (over: Partial<ChannelActivity> = {}): ChannelActivity => ({
  windows: { '24h': w(24, 123, 104), '7d': w(7, 412, 498), '30d': w(30, 1637, 1290) },
  peakBand: { startHour: 19, endHour: 22 },
  quietBand: { startHour: 2, endHour: 6 },
  lastTs: NOW - 180_000,
  ...over,
});

const body = (props: Partial<React.ComponentProps<typeof ActivityBody>> = {}) =>
  render(
    <TooltipProvider>
      <ActivityBody
        activity={activity()}
        loading={false}
        error={null}
        mode="full"
        win="24h"
        onWindow={() => {}}
        now={NOW}
        {...props}
      />
    </TooltipProvider>,
  );

describe('ActivityBody', () => {
  it('renders the full treatment: tabs, lead number, trend, 24 bars, axis, rhythm', () => {
    const { container } = body();
    expect(screen.getByLabelText('Last 24 hours')).toBeTruthy();
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('in 24h')).toBeTruthy();
    expect(screen.getByText('18%')).toBeTruthy(); // (123-104)/104
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBeTruthy();
    expect(container.textContent).toContain('2–6 AM');
  });

  it('collapses to number, mini trend, bare sparkline and a two-clause rhythm line', () => {
    const { container } = body({ mode: 'collapsed' });
    expect(screen.queryByLabelText('Last 24 hours')).toBe(null);
    expect(screen.getByText('msgs · 24h')).toBeTruthy();
    expect(screen.queryByText('vs prev')).toBe(null);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBe(null);
    expect(container.textContent).not.toContain('2–6 AM');
    expect(container.textContent).toContain('3m ago');
  });

  it('pins the collapsed view to 24h even when a wider window is stored', () => {
    body({ mode: 'collapsed', win: '30d' });
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('msgs · 24h')).toBeTruthy();
  });

  it('reports tab changes to the caller', () => {
    const onWindow = vi.fn();
    body({ onWindow });
    fireEvent.click(screen.getByLabelText('Last 7 days'));
    expect(onWindow).toHaveBeenCalledWith('7d');
  });

  it('renders the selected window when the caller passes one', () => {
    const { container } = body({ win: '7d' });
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('in 7d')).toBeTruthy();
    expect(screen.getByText('17%')).toBeTruthy(); // (412-498)/498 rounds to -17
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(7);
  });

  it('hides the trend chip when there is no previous period to compare against', () => {
    const a = activity();
    a.windows['24h'] = { ...a.windows['24h'], total: 40, prevTotal: 0 };
    const { container } = body({ activity: a });
    expect(screen.getByText('40')).toBeTruthy();
    expect(container.textContent).not.toContain('%');
  });

  it('renders a zero window without NaN', () => {
    const a = activity();
    a.windows['24h'] = { buckets: new Array(24).fill(0), total: 0, prevTotal: 40, startMs: midnight };
    const { container } = body({ activity: a });
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
  });

  it('shows a placeholder for a channel that has never had a message', () => {
    body({ activity: activity({ lastTs: null }) });
    expect(screen.getByText('no activity yet')).toBeTruthy();
  });

  it('shows a placeholder while loading', () => {
    body({ activity: null, loading: true });
    expect(screen.getByText('loading…')).toBeTruthy();
  });

  it('surfaces a fetch error instead of pretending there is no activity', () => {
    body({ activity: null, loading: false, error: 'network unreachable' });
    expect(screen.getByText('network unreachable')).toBeTruthy();
    expect(screen.queryByText('no activity yet')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/channel-activity-section.test.tsx`
Expected: FAIL — cannot resolve `@/shell/rightrail/sections/channel-activity`.

- [ ] **Step 3: Implement the body and wrapper**

Create `src/renderer/shell/rightrail/sections/channel-activity/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Channel, ChannelActivity, ActivityWindowKey } from '../../../../../shared/types';
import { useChannelActivity } from '../../../../hooks/useChannelActivity';
import type { ApiClient } from '../../../../lib/api';
import { useStore } from '../../../../lib/store';
import { Placeholder } from '../../atoms';
import { COLLAPSE_WIDTH, type ActivityMode, trendPct } from './activity';
import { RhythmFooter } from './RhythmFooter';
import { TrendChip } from './TrendChip';
import { VolumeChart } from './VolumeChart';
import { WindowTabs } from './WindowTabs';

/** The "3m ago" label would otherwise only refresh on the hook's 5-minute poll,
 *  which is long enough to be visibly wrong. Same cadence as RelativeTime. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function ActivityBody({
  activity,
  loading,
  error,
  mode,
  win,
  onWindow,
  now,
}: {
  activity: ChannelActivity | null;
  loading: boolean;
  error: string | null;
  mode: ActivityMode;
  win: ActivityWindowKey;
  onWindow: (w: ActivityWindowKey) => void;
  /** Tests pin this; production lets the minute tick drive it. */
  now?: number;
}) {
  const tick = useMinuteTick();
  const at = now ?? tick;

  if (!activity) {
    if (error) return <p className="italic text-cs-danger">{error}</p>;
    return <Placeholder label={loading ? 'loading…' : 'no activity yet'} />;
  }
  if (activity.lastTs == null) return <Placeholder label="no activity yet" />;

  const full = mode === 'full';
  // Narrow rails have no room for tabs, so the window is pinned to 24h for
  // display only — the stored preference is untouched and returns on widening.
  const active: ActivityWindowKey = full ? win : '24h';
  const data = activity.windows[active];
  const pct = trendPct(data.total, data.prevTotal);

  return (
    <div>
      {full && <WindowTabs value={win} onChange={onWindow} />}
      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono font-semibold tabular-nums tracking-[-0.01em] text-cs-text ${full ? 'text-[30px]' : 'text-[21px]'}`}
        >
          {data.total}
        </span>
        <span className={full ? 'text-[12.5px] text-cs-text-muted' : 'text-[11.5px] text-cs-text-muted'}>
          {full ? `in ${active}` : 'msgs · 24h'}
        </span>
        {pct !== null && <TrendChip pct={pct} showVsPrev={full} />}
      </div>
      <VolumeChart winKey={active} data={data} mode={mode} />
      <RhythmFooter
        peak={activity.peakBand}
        quiet={activity.quietBand}
        lastTs={activity.lastTs}
        mode={mode}
        now={at}
      />
    </div>
  );
}

export function ChannelActivitySection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { activity, loading, error } = useChannelActivity(channel.key, client);
  // The rail's own px width is already in the store, so no ResizeObserver is needed.
  const railWidth = useStore((s) => s.ui.rightWidth);
  const win = useStore((s) => s.ui.channelActivityWindow);
  const setWin = useStore((s) => s.setChannelActivityWindow);
  return (
    <ActivityBody
      activity={activity}
      loading={loading}
      error={error}
      mode={railWidth < COLLAPSE_WIDTH ? 'collapsed' : 'full'}
      win={win}
      onWindow={setWin}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/channel-activity-section.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Repoint the rail registration**

In `src/renderer/shell/rightrail/sectionsFor.tsx`, change line 8 from:

```tsx
import { ChannelActivitySection } from './sections/ChannelActivity';
```

to:

```tsx
import { ChannelActivitySection } from './sections/channel-activity';
```

The `rail.channel.activity` entry itself (id, label, `defaultOpen: false`) is unchanged, so persisted `openRailSections` state survives.

- [ ] **Step 6: Delete the superseded code**

```bash
git rm src/renderer/shell/rightrail/sections/ChannelActivity.tsx
git rm src/renderer/components/Sparkline.tsx
git rm tests/component/sparkline.test.tsx
```

- [ ] **Step 7: Verify nothing still references the deleted modules**

Run: `grep -rn "Sparkline\|sections/ChannelActivity" src/ tests/`
Expected: no hits. If `useChannelStats` is now unreferenced by the Activity section but still used by `ChannelPeople.tsx`, leave it — it is still live.

- [ ] **Step 8: Full verification**

```bash
npx tsc --noEmit
npx biome check src tests
npx vitest run
```
Expected: typecheck clean, Biome clean, all three vitest projects green.

- [ ] **Step 9: Commit**

```bash
npx biome check --write src tests
git add -A
git commit -m "feat(activity): Cadence section replaces the old Activity block

Assembles the window tabs, lead number, trend chip, volume chart and
rhythm footer into a width-aware section, repoints the rail registration,
and deletes the superseded ChannelActivity block and Sparkline component.

Drops the 'first seen' line, which rendered a null timestamp as the Unix
epoch along with an age and per-day rate derived from it."
```

---

## Task 12: Visual verification in the real app

**Files:** none — verification only.

**Interfaces:**
- Consumes: the assembled section from Task 11.
- Produces: screenshots confirming both width modes render correctly.

- [ ] **Step 1: Build the app**

```bash
npx electron-forge package
```
This is heavy and needs the sandbox disabled. It produces `.vite/build/index.js`.

- [ ] **Step 2: Drive the app and capture both modes**

Write a throwaway Playwright spec under `tests/e2e/` using `tests/e2e/support/launch.ts`. Read that helper first — it mkdtemps a userData dir, seeds `channels.json` / `contacts.json`, sets `CORESENSE_USER_DATA` and `CORESENSE_FAKE_TRANSPORT`, and strips `ELECTRON_RUN_AS_NODE`.

Seed a channel with messages spread across 30 days directly into `messages.db` in the temp userData dir before launch, then: open the channel, expand the Activity rail section, screenshot at the default 320px rail, drag the rail below 304px, and screenshot again.

**Any seeded `Contact` must include `key: 'c:<pubkeyHex>'`** or the main process fatals at startup in `rebuildConversationsIndex`.

- [ ] **Step 3: Check the screenshots against the reference**

Compare against `docs/design/channel-activity-cadence/Activity - Cadence.html` — specifically: tab pill geometry and the amber active state, the 30px lead number, chip colour and placement, bar normalisation and the 74px plot height, axis tick positions, and that the collapsed mode really does drop to ~4 lines.

- [ ] **Step 4: Delete the throwaway spec and commit any fixes**

The e2e spec was a verification tool, not a deliverable — remove it unless it earned its place as a durable test. Commit only real fixes found by looking at the screenshots.

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| §1.1 endpoint | 3 |
| §1.2 shared type | 1 |
| §1.3 query | 1 |
| §1.4 bucketing rules | 1 |
| §1.5 rhythm bands + sparsity | 2 |
| §1.6 edge cases | 1 (zero-shape), 6 (`trendPct` null), 11 (placeholder/zero/error tests) |
| §1.7 api client + hook + 5-min timer | 4 |
| §2 component split | 7, 8, 9, 10, 11 |
| §2.1 window tabs + overrides | 9 |
| §2.2 lead number / unit / chip | 7, 11 |
| §2.3 chart, ticks, tooltips, a11y | 6, 8 |
| §2.4 rhythm footer | 10 |
| §2.5 persistence | 9 |
| §3 width mode | 6 (`COLLAPSE_WIDTH`), 11 (wiring) |
| §4 tokens | 7 |
| §5 removals: first seen, Sparkline, `fmtAgoShort`, error surfacing | 11, 11, 5, 11 |
| §6 testing | every task |
| §7 deviations (rail padding, computed ticks) | 6, 11 |

**Placeholder scan:** no TBD/TODO; every code step carries real code; no "similar to Task N" references.

**Type consistency:** `ActivityWindowKey` / `ActivityWindow` / `ActivityBand` / `ChannelActivity` are defined in Task 1 and used with those exact names throughout. `ActivityMode` and `COLLAPSE_WIDTH` come from Task 6's `activity.ts` and are imported from there in Tasks 8, 10 and 11. `winKey` is the prop name on `VolumeChart` in both Task 8 and Task 11 (avoiding a collision with the global `window`). `fmtAgoShort(ts, now)` is defined in Task 5 and called with both arguments in Task 10.

**Known follow-ups deliberately left out** (recorded in the spec's Risks section): Activity, People and the new activity hook each issue their own request on the same trigger; nothing dedupes them.
