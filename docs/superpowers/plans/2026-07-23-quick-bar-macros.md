# Quick Bar Macros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the quick bar's hardcoded "soon" macro placeholder with the real macros store — two frecency-ranked inline chips plus a panel of scope-filtered macros showing rendered previews — where clicking inserts the rendered text into the composer.

**Architecture:** Four pure, independently-tested modules land first (frecency generalization, macro selection, render helpers), then the React wiring consumes them. `client` is prop-threaded from `MessageList`'s existing `RowContext` down to `MacroPanel`; insertion reuses the `composerRef.insertReaction(name, content)` path emoji already uses. Nothing transmits.

**Tech Stack:** React 19, Zustand (`src/renderer/lib/store.ts`), Radix Popover (shadcn), Tailwind with `cs-*` design tokens, Vitest 4 (`unit` project = node, `dom` project = jsdom + React Testing Library), Biome.

**Spec:** [docs/superpowers/specs/2026-07-23-quick-bar-macros-design.md](../specs/2026-07-23-quick-bar-macros-design.md)

## Global Constraints

- **Renderer only.** No `@andyshinn/meshcore-ts` imports anywhere in this plan — that package is Node-only and cannot be imported from `src/renderer`.
- **Run tooling via `npx`, not `pnpm <script>`.** In a worktree, pnpm's deps-check reflink-fails. Use `npx vitest run`, `npx tsc --noEmit`, `npx biome check src tests`.
- **Scope Biome to `src tests`.** A repo-wide `npx biome check` fails on pre-existing `build/`, `dist/`, `out/` artifacts unrelated to this work.
- **Git in this worktree needs the sandbox disabled** for `git add` / `git commit`. Test and typecheck commands run sandboxed fine.
- **Message length cap is 132 characters** (`MAX_MESSAGE_LENGTH`) — MeshCore's outgoing text body limit.
- **Vitest project routing is by path:** `tests/unit/**/*.test.ts` runs in node (no DOM, no JSX), `tests/component/**/*.test.tsx` runs in jsdom. A test that mounts React must be a `.tsx` file under `tests/component/`.
- **Path alias `@` → `src/renderer`**, available in all three Vitest projects and in the app build.
- Do not restyle message rows, the composer, or the quick bar's other popovers.

---

### Task 1: Generalize frecency and add `macroUsage` to persisted UI state

`frecency.ts` is emoji-shaped only in its identifiers — the algorithm is already generic over string keys. Rename it to neutral terms, then add a second usage map for macro ids that persists and syncs exactly like `emojiUsage`.

**Files:**
- Modify: `src/shared/types.ts:766-771` (type rename), `:818-820` (UiState field), `:853` (default)
- Modify: `src/renderer/features/message-actions/frecency.ts` (whole file)
- Modify: `src/renderer/features/message-actions/ReactionRow.tsx:3,13`
- Modify: `src/renderer/lib/store.ts:29` (import), `:419` (action type), `:741-768` (`applyUiState`), `:882` (action impl), `:1041-1046` (equality helper)
- Test: `tests/unit/renderer/features/message-actions/frecency.test.ts` (rewrite)
- Test: `tests/unit/renderer/lib/macro-usage-store.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `UsageEntry { count: number; lastUsedMs: number }` and `UsageMap = Record<string, UsageEntry>` from `src/shared/types` (replacing `EmojiUse` / `EmojiUsage`).
  - `UiState.macroUsage: UsageMap` (macro id → tally).
  - `score(entry: UsageEntry | undefined, nowMs: number): number` from `features/message-actions/frecency` — used by Task 2's `topMacros`.
  - `topIds(usage: UsageMap, nowMs: number, n: number, seed: readonly string[]): string[]` (renamed from `topEmojis`).
  - `recordUsage(usage: UsageMap, id: string, nowMs: number): UsageMap` (unchanged name).
  - Store action `recordMacroUse(macroId: string): void` — used by Task 5.

- [ ] **Step 1: Rewrite the frecency test for the new names**

Replace the entire contents of `tests/unit/renderer/features/message-actions/frecency.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMOJI_SEED, recordUsage, score, topIds } from '../../../../../src/renderer/features/message-actions/frecency';
import type { UsageMap } from '../../../../../src/shared/types';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

describe('score', () => {
  it('rewards higher count and more recent use', () => {
    const recent = score({ count: 3, lastUsedMs: NOW }, NOW);
    const old = score({ count: 3, lastUsedMs: NOW - 30 * DAY }, NOW);
    expect(recent).toBeGreaterThan(old);
    const more = score({ count: 10, lastUsedMs: NOW }, NOW);
    expect(more).toBeGreaterThan(recent);
  });

  it('scores an absent entry as 0 so unranked ids sort last', () => {
    expect(score(undefined, NOW)).toBe(0);
    expect(score({ count: 1, lastUsedMs: NOW - 365 * DAY }, NOW)).toBeGreaterThan(0);
  });
});

describe('topIds', () => {
  it('returns empty usage as the seed, capped to n', () => {
    expect(topIds({}, NOW, 5, EMOJI_SEED)).toEqual(EMOJI_SEED.slice(0, 5));
  });

  it('orders used ids by frecency, then backfills from the seed without dupes', () => {
    const usage: UsageMap = {
      '🔥': { count: 5, lastUsedMs: NOW },
      '👍': { count: 1, lastUsedMs: NOW - 10 * DAY },
    };
    const top = topIds(usage, NOW, 5, EMOJI_SEED);
    expect(top[0]).toBe('🔥'); // highest frecency first
    expect(top).toContain('👍');
    expect(new Set(top).size).toBe(top.length); // no duplicates
    expect(top).toHaveLength(5);
  });
});

describe('recordUsage', () => {
  it('increments count and updates the timestamp immutably', () => {
    const before: UsageMap = { '👍': { count: 2, lastUsedMs: NOW - DAY } };
    const after = recordUsage(before, '👍', NOW);
    expect(after['👍']).toEqual({ count: 3, lastUsedMs: NOW });
    expect(before['👍'].count).toBe(2); // original untouched
  });

  it('creates a new entry for a first-seen id', () => {
    expect(recordUsage({}, '📡', NOW)['📡']).toEqual({ count: 1, lastUsedMs: NOW });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/features/message-actions/frecency.test.ts`
Expected: FAIL — `No "score" export is defined on the module` (and `topIds`, `UsageMap`).

- [ ] **Step 3: Rename the shared usage types**

In `src/shared/types.ts`, replace lines 766-771:

```ts
/** One entity's usage tally for frecency ranking (an emoji, a macro id, …). */
export interface UsageEntry {
  count: number;
  lastUsedMs: number;
}
export type UsageMap = Record<string, UsageEntry>;
```

In the `UiState` interface, replace the `emojiUsage` declaration (line ~818-820) with:

```ts
  // Per-emoji usage counts driving quick-react auto-pinning. Account-global
  // (synced via applyUiState like pinned/recentKeys).
  emojiUsage: UsageMap;
  // Per-macro usage counts (macro id → tally) driving the quick bar's two
  // auto-pinned macro chips. Account-global, synced alongside emojiUsage.
  macroUsage: UsageMap;
```

In `DEFAULT_UI_STATE`, replace `emojiUsage: {},` (line ~853) with:

```ts
  emojiUsage: {},
  macroUsage: {},
```

- [ ] **Step 4: Generalize `frecency.ts`**

Replace the entire contents of `src/renderer/features/message-actions/frecency.ts`:

```ts
import type { UsageEntry, UsageMap } from '../../../shared/types';

/** Curated, airtime-aware seed shown before the user has any history. */
export const EMOJI_SEED: readonly string[] = ['👍', '✅', '📡', '🔋', '😂', '❤️'];

const HALF_LIFE_MS = 14 * 86_400_000; // recency weight halves every ~2 weeks

/** Frecency: usage count decayed by how long ago it was last used. An absent
 *  entry scores 0, so never-used ids rank below every used one. */
export function score(entry: UsageEntry | undefined, nowMs: number): number {
  if (!entry) return 0;
  const ageMs = Math.max(0, nowMs - entry.lastUsedMs);
  const recency = 2 ** (-ageMs / HALF_LIFE_MS); // 1 now → 0.5 at one half-life
  return entry.count * recency;
}

/** Top-N ids by frecency, backfilled from `seed` (deduped) to always yield N. */
export function topIds(usage: UsageMap, nowMs: number, n: number, seed: readonly string[]): string[] {
  const ranked = Object.keys(usage).sort((a, b) => score(usage[b], nowMs) - score(usage[a], nowMs));
  const out: string[] = [];
  for (const e of ranked) {
    if (out.length >= n) break;
    if (!out.includes(e)) out.push(e);
  }
  for (const e of seed) {
    if (out.length >= n) break;
    if (!out.includes(e)) out.push(e);
  }
  return out.slice(0, n);
}

/** Immutably bump an id's count and last-used timestamp. */
export function recordUsage(usage: UsageMap, id: string, nowMs: number): UsageMap {
  const prev = usage[id];
  return { ...usage, [id]: { count: (prev?.count ?? 0) + 1, lastUsedMs: nowMs } };
}
```

- [ ] **Step 5: Update `ReactionRow` to the new name**

In `src/renderer/features/message-actions/ReactionRow.tsx`, change line 3:

```tsx
import { EMOJI_SEED, topIds } from './frecency';
```

and line 13:

```tsx
  const emojis = topIds(usage, Date.now(), count, EMOJI_SEED);
```

- [ ] **Step 6: Run the frecency test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/features/message-actions/frecency.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 7: Write the failing store test**

Create `tests/unit/renderer/lib/macro-usage-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE, type UiState } from '../../../../src/shared/types';

describe('recordMacroUse', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE } });
  });

  it('increments usage count for the macro id', () => {
    useStore.getState().recordMacroUse('mac_7f');
    useStore.getState().recordMacroUse('mac_7f');
    expect(useStore.getState().ui.macroUsage.mac_7f.count).toBe(2);
  });

  it('keeps emoji and macro tallies in separate maps', () => {
    useStore.getState().recordMacroUse('mac_7f');
    expect(useStore.getState().ui.emojiUsage.mac_7f).toBeUndefined();
  });
});

describe('applyUiState merges macroUsage (account-global)', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE } });
  });

  it('adopts a remote macroUsage broadcast', () => {
    useStore.getState().applyUiState({
      ...DEFAULT_UI_STATE,
      macroUsage: { mac_7f: { count: 4, lastUsedMs: 123 } },
    });
    expect(useStore.getState().ui.macroUsage.mac_7f.count).toBe(4);
  });

  it('an equal-value macroUsage echo preserves ui identity (no re-PUT loop)', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, macroUsage: { mac_7f: { count: 3, lastUsedMs: 42 } } } });
    const before = useStore.getState().ui;
    // Simulate a broadcast echo: same values, fresh object refs, as a JSON
    // round-trip over the wire would produce.
    const incoming = { ...DEFAULT_UI_STATE, macroUsage: { mac_7f: { count: 3, lastUsedMs: 42 } } };
    useStore.getState().applyUiState(incoming);
    expect(useStore.getState().ui).toBe(before); // identity preserved -> App effect won't re-fire
  });

  it('tolerates a payload that omits macroUsage (legacy/partial producer)', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, macroUsage: { mac_7f: { count: 1, lastUsedMs: 1 } } } });
    const legacy: UiState = { ...DEFAULT_UI_STATE };
    delete (legacy as { macroUsage?: unknown }).macroUsage;
    expect(() => useStore.getState().applyUiState(legacy)).not.toThrow();
    expect(useStore.getState().ui.macroUsage).toEqual({});
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/lib/macro-usage-store.test.ts`
Expected: FAIL — `recordMacroUse is not a function`.

- [ ] **Step 9: Add the store action and sync `macroUsage`**

In `src/renderer/lib/store.ts`, delete `  type EmojiUsage,` from the `src/shared/types`
import block (line 29) and add `  type UsageMap,` to the same block. The specifiers are
alphabetically sorted, so `UsageMap` belongs after the last specifier that sorts before
it. Rather than counting by hand, add it anywhere in the block and run:

```bash
npx biome check --write src/renderer/lib/store.ts
```

which sorts the specifiers into place.

Next to `recordEmojiUse` in the actions interface (line ~419), add:

```ts
  recordMacroUse: (macroId: string) => void;
```

Replace the `applyUiState` implementation (lines 741-768) with:

```ts
  applyUiState: (incoming) =>
    set((s) => {
      // Idempotent: when the synced subset already matches, return {} so `ui`
      // keeps its object identity and App.tsx's debounced PUT effect doesn't
      // re-fire — otherwise a client would loop forever on its own echo.
      // Coalesce the usage maps: a legacy or partial producer may PUT a UiState
      // that omits one, and Object.keys(undefined) in usageMapEqual (or a
      // downstream topIds) would otherwise throw and break the WS handler for
      // every connected client.
      const incomingEmojiUsage = incoming.emojiUsage ?? {};
      const incomingMacroUsage = incoming.macroUsage ?? {};
      const same =
        shallowEqualRecord(s.ui.lastReadByKey, incoming.lastReadByKey) &&
        arraysEqual(s.ui.pinned, incoming.pinned) &&
        arraysEqual(s.ui.recentKeys, incoming.recentKeys) &&
        usageMapEqual(s.ui.emojiUsage, incomingEmojiUsage) &&
        usageMapEqual(s.ui.macroUsage, incomingMacroUsage) &&
        s.ui.themePref === incoming.themePref;
      if (same) return {};
      return {
        ui: {
          ...s.ui,
          lastReadByKey: incoming.lastReadByKey,
          pinned: incoming.pinned,
          recentKeys: incoming.recentKeys,
          emojiUsage: incomingEmojiUsage,
          macroUsage: incomingMacroUsage,
          themePref: incoming.themePref,
        },
      };
    }),
```

Directly after the `recordEmojiUse` implementation (line ~882), add:

```ts
  recordMacroUse: (macroId) =>
    set((s) => ({ ui: { ...s.ui, macroUsage: recordUsage(s.ui.macroUsage, macroId, Date.now()) } })),
```

Replace the equality helper (lines 1036-1046) with:

```ts
// Usage-map values are per-id objects ({count, lastUsedMs}), not primitives, so
// `shallowEqualRecord`'s reference equality is always false once a broadcast
// round-trips through JSON (fresh object refs even when the values match).
// Compare one level deeper so an echo of unchanged counts is recognized as
// "same" and doesn't re-trigger the debounced PUT in App.tsx.
function usageMapEqual(a: UsageMap, b: UsageMap): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => b[k] != null && a[k].count === b[k].count && a[k].lastUsedMs === b[k].lastUsedMs);
}
```

- [ ] **Step 10: Run the store test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/lib/macro-usage-store.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 11: Verify nothing else referenced the old names**

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: both clean. If `tsc` reports `EmojiUsage`/`EmojiUse`/`scoreEmoji`/`topEmojis` still referenced somewhere, update those call sites to the new names.

Run: `npx vitest run --project unit --project dom`
Expected: PASS — the pre-existing `tests/unit/renderer/lib/emoji-usage-store.test.ts` must still pass unchanged (it only touches `emojiUsage`, whose field name did not change).

- [ ] **Step 12: Commit**

```bash
git add src/shared/types.ts src/renderer/features/message-actions/frecency.ts \
  src/renderer/features/message-actions/ReactionRow.tsx src/renderer/lib/store.ts \
  tests/unit/renderer/features/message-actions/frecency.test.ts \
  tests/unit/renderer/lib/macro-usage-store.test.ts
git commit -m "feat(macros): generalize frecency and persist per-macro usage"
```

---

### Task 2: Macro selection — scope filter and frecency ranking

Two pure functions that decide *which* macros the bar shows. Kept out of React so both are directly testable.

**Files:**
- Create: `src/renderer/features/message-actions/macroPicks.ts`
- Test: `tests/unit/renderer/features/message-actions/macroPicks.test.ts`

**Interfaces:**
- Consumes: `score` from `./frecency` (Task 1); `UsageMap` from `src/shared/types` (Task 1); `MacroTemplate` from `src/shared/macros/types` (pre-existing — fields: `id`, `name`, `template`, `scope: 'global' | 'channel' | 'contact'`, `channelKey?`, `contactKey?`, `createdAt`, `updatedAt`).
- Produces:
  - `applicableMacros(macros: MacroTemplate[], conversationKey: string): MacroTemplate[]`
  - `topMacros(macros: MacroTemplate[], usage: UsageMap, nowMs: number, n: number): MacroTemplate[]`

  Both are used by Task 5's `MessageQuickBar`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/features/message-actions/macroPicks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applicableMacros,
  topMacros,
} from '../../../../../src/renderer/features/message-actions/macroPicks';
import type { MacroTemplate } from '../../../../../src/shared/macros/types';
import type { UsageMap } from '../../../../../src/shared/types';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

function macro(over: Partial<MacroTemplate> & Pick<MacroTemplate, 'id'>): MacroTemplate {
  return {
    name: over.id,
    template: 'hi',
    scope: 'global',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('applicableMacros', () => {
  const macros = [
    macro({ id: 'g' }),
    macro({ id: 'ch-match', scope: 'channel', channelKey: 'ch:beef' }),
    macro({ id: 'ch-other', scope: 'channel', channelKey: 'ch:cafe' }),
    macro({ id: 'c-match', scope: 'contact', contactKey: 'c:a3f9' }),
    macro({ id: 'c-other', scope: 'contact', contactKey: 'c:0001' }),
  ];

  it('keeps global macros on any conversation', () => {
    expect(applicableMacros(macros, 'ch:beef').map((m) => m.id)).toContain('g');
    expect(applicableMacros(macros, 'c:a3f9').map((m) => m.id)).toContain('g');
  });

  it('admits only the channel macro whose key matches', () => {
    const ids = applicableMacros(macros, 'ch:beef').map((m) => m.id);
    expect(ids).toContain('ch-match');
    expect(ids).not.toContain('ch-other');
  });

  it('admits only the contact macro whose key matches', () => {
    const ids = applicableMacros(macros, 'c:a3f9').map((m) => m.id);
    expect(ids).toContain('c-match');
    expect(ids).not.toContain('c-other');
  });

  it('excludes scoped macros from an unrelated conversation entirely', () => {
    expect(applicableMacros(macros, 'ch:beef').map((m) => m.id)).toEqual(['g', 'ch-match']);
  });

  it('drops a scoped macro whose key is missing', () => {
    expect(applicableMacros([macro({ id: 'orphan', scope: 'channel' })], 'ch:beef')).toEqual([]);
  });
});

describe('topMacros', () => {
  const macros = [macro({ id: 'a' }), macro({ id: 'b' }), macro({ id: 'c' })];

  it('falls back to store order when nothing has been used', () => {
    expect(topMacros(macros, {}, NOW, 2).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('ranks used macros above unused ones, most-frecent first', () => {
    const usage: UsageMap = {
      c: { count: 5, lastUsedMs: NOW },
      b: { count: 1, lastUsedMs: NOW - 10 * DAY },
    };
    expect(topMacros(macros, usage, NOW, 2).map((m) => m.id)).toEqual(['c', 'b']);
  });

  it('ignores usage entries for macros that no longer exist', () => {
    const usage: UsageMap = { deleted: { count: 99, lastUsedMs: NOW } };
    expect(topMacros(macros, usage, NOW, 2).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const usage: UsageMap = { c: { count: 5, lastUsedMs: NOW } };
    topMacros(macros, usage, NOW, 3);
    expect(macros.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns fewer than n when there are fewer macros', () => {
    expect(topMacros([macro({ id: 'only' })], {}, NOW, 2)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/features/message-actions/macroPicks.test.ts`
Expected: FAIL — `Failed to load .../macroPicks` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/renderer/features/message-actions/macroPicks.ts`:

```ts
import type { MacroTemplate } from '../../../shared/macros/types';
import type { UsageMap } from '../../../shared/types';
import { score } from './frecency';

/** Macros valid for one conversation: `global` everywhere, `channel`/`contact`
 *  only on the conversation their key names. A scoped macro with no key is
 *  unroutable and therefore shown nowhere. */
export function applicableMacros(macros: MacroTemplate[], conversationKey: string): MacroTemplate[] {
  return macros.filter((m) => {
    if (m.scope === 'channel') return m.channelKey === conversationKey;
    if (m.scope === 'contact') return m.contactKey === conversationKey;
    return true;
  });
}

/** The n most-frecent macros. Array#sort is stable, so never-used macros (all
 *  scoring 0) keep their store order — "most-frecent, else the first n" falls
 *  out of the one sort, with no separate seed list. */
export function topMacros(macros: MacroTemplate[], usage: UsageMap, nowMs: number, n: number): MacroTemplate[] {
  return [...macros].sort((a, b) => score(usage[b.id], nowMs) - score(usage[a.id], nowMs)).slice(0, n);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/features/message-actions/macroPicks.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/message-actions/macroPicks.ts \
  tests/unit/renderer/features/message-actions/macroPicks.test.ts
git commit -m "feat(macros): scope filter + frecency ranking for quick-bar macro picks"
```

---

### Task 3: Render helpers — shared length cap, reply expansion, preview hook

The pieces that turn a `MacroTemplate` into text. `MAX_MESSAGE_LENGTH` moves out of `Composer.tsx` so the panel can import the cap without pulling in the whole composer tree (nothing outside `Composer.tsx` imports it today, so this is a clean move rather than a re-export).

**Files:**
- Create: `src/renderer/lib/messageLimits.ts`
- Modify: `src/renderer/components/Composer.tsx:12-13` (remove const), add import
- Modify: `src/renderer/panels/macros/lib/inchat.ts` (add `expandMacroReply`)
- Create: `src/renderer/panels/macros/lib/useReplyPreviews.ts`
- Test: `tests/unit/renderer/panels/macros/inchat.test.ts` (create)

**Interfaces:**
- Consumes: `api.renderMacro(client, { macroId, mode, messageId, placeholder })` returning `RenderResult = { ok: true; text: string } | { ok: false; error: MacroError }`; `notify` from `@/lib/notify`.
- Produces:
  - `MAX_MESSAGE_LENGTH: 132` from `@/lib/messageLimits` — used by Task 5's panel.
  - `expandMacroReply(client: ApiClient | null, macro: MacroTemplate, message: { id: string }): Promise<string | null>` from `panels/macros/lib/inchat` — used by Task 5's `MessageQuickBar`.
  - `PreviewState` and `useReplyPreviews(client, messageId, macros, open): Record<string, PreviewState>` from `panels/macros/lib/useReplyPreviews` — used by Task 5's `MacroPanel`.

- [ ] **Step 1: Write the failing test for `expandMacroReply`**

Create `tests/unit/renderer/panels/macros/inchat.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { type ApiClient, api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { expandMacroReply } from '@/panels/macros/lib/inchat';
import type { MacroTemplate } from '../../../../../src/shared/macros/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const macro: MacroTemplate = {
  id: 'a',
  name: 'Signal report',
  template: '{{ snr }} snr',
  scope: 'global',
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(notify.error).mockClear();
});

describe('expandMacroReply', () => {
  it('renders the macro in reply mode against the message and returns the text', async () => {
    const spy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'rendered reply' });
    await expect(expandMacroReply(client, macro, { id: 'msg1' })).resolves.toBe('rendered reply');
    expect(spy.mock.calls[0][1]).toMatchObject({
      macroId: 'a',
      mode: 'reply',
      messageId: 'msg1',
      placeholder: '?',
    });
  });

  it('returns null and toasts when the render fails', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({
      ok: false,
      error: { kind: 'unknown-variable', message: 'no such variable' },
    });
    await expect(expandMacroReply(client, macro, { id: 'msg1' })).resolves.toBeNull();
    expect(notify.error).toHaveBeenCalledTimes(1);
  });

  it('returns null without calling the API when there is no client', async () => {
    const spy = vi.spyOn(api, 'renderMacro');
    await expect(expandMacroReply(null, macro, { id: 'msg1' })).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/panels/macros/inchat.test.ts`
Expected: FAIL — `No "expandMacroReply" export is defined on the module`.

- [ ] **Step 3: Add `expandMacroReply`**

In `src/renderer/panels/macros/lib/inchat.ts`, add after `expandMacro` (keep `sendMacroReply` for now — Task 6 removes it):

```ts
/** Render a macro against a received message's reply context, for insertion
 *  into the composer. Returns null and surfaces a toast on render failure. */
export async function expandMacroReply(
  client: ApiClient | null,
  macro: MacroTemplate,
  message: { id: string },
): Promise<string | null> {
  if (!client) return null;
  const res = await api.renderMacro(client, { macroId: macro.id, mode: 'reply', messageId: message.id, placeholder: '?' });
  if (res.ok) return res.text;
  notify.error(`Couldn’t expand “${macro.name}”: ${res.error.message}`);
  return null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/panels/macros/inchat.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Move the message-length cap into its own module**

Create `src/renderer/lib/messageLimits.ts`:

```ts
// MeshCore caps an outgoing text message body at 132 characters. Lives here
// rather than in Composer so surfaces that only need the number (e.g. the
// quick bar's macro previews) don't pull in the whole composer tree.
export const MAX_MESSAGE_LENGTH = 132;
```

In `src/renderer/components/Composer.tsx`, delete lines 12-13:

```ts
// MeshCore caps an outgoing text message body at 132 characters.
export const MAX_MESSAGE_LENGTH = 132;
```

and add to the import block (after the `mentionedNames` import, alphabetical by path):

```ts
import { MAX_MESSAGE_LENGTH } from '../lib/messageLimits';
```

The `WARN_REMAINING` const on line 15 stays in `Composer.tsx` — it is composer-only.

- [ ] **Step 6: Verify the move broke nothing**

Run: `npx tsc --noEmit`
Expected: clean. (`MAX_MESSAGE_LENGTH` had no importers outside `Composer.tsx`; if `tsc` says otherwise, point that importer at `../lib/messageLimits`.)

- [ ] **Step 7: Write the preview hook**

Create `src/renderer/panels/macros/lib/useReplyPreviews.ts`:

```ts
import { useEffect, useState } from 'react';
import { type ApiClient, api } from '@/lib/api';
import type { MacroTemplate } from '../../../../shared/macros/types';

export type PreviewState =
  | { status: 'loading' }
  | { status: 'ok'; text: string; len: number }
  | { status: 'error'; message: string };

/** Render every macro against one message's reply context, keyed by macro id.
 *
 *  Fetches when the panel opens and whenever the message or the macro set
 *  changes while open; never caches across opens, because reply context holds
 *  time-varying values (`received_ago`, `peer_last_seen`) and a stale preview
 *  would disagree with the text actually inserted. */
export function useReplyPreviews(
  client: ApiClient | null,
  messageId: string,
  macros: MacroTemplate[],
  open: boolean,
): Record<string, PreviewState> {
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  // Stable string projection of the macro set — `macros` is a fresh array on
  // every render, so it can't be an effect dependency directly.
  const ids = macros.map((m) => m.id).join(',');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ids` stands in for `macros`, which is a new array each render
  useEffect(() => {
    if (!open || !client || macros.length === 0) {
      setPreviews({});
      return;
    }
    let cancelled = false;
    setPreviews(Object.fromEntries(macros.map((m) => [m.id, { status: 'loading' } as PreviewState])));
    void Promise.all(
      macros.map(async (m) => {
        // Catch per-macro: one transport failure must not leave every other
        // row stuck on 'loading'.
        try {
          const res = await api.renderMacro(client, {
            macroId: m.id,
            mode: 'reply',
            messageId,
            placeholder: '?',
          });
          const state: PreviewState = res.ok
            ? { status: 'ok', text: res.text, len: res.text.length }
            : { status: 'error', message: res.error.message };
          return [m.id, state] as const;
        } catch (err) {
          return [m.id, { status: 'error', message: (err as Error).message }] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setPreviews(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [open, client, messageId, ids]);

  return previews;
}
```

The hook's behaviour is covered by the `MacroPanel` component test in Task 5 — it needs a DOM, so it cannot be tested from the node-only `unit` project.

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/lib/messageLimits.ts src/renderer/components/Composer.tsx \
  src/renderer/panels/macros/lib/inchat.ts src/renderer/panels/macros/lib/useReplyPreviews.ts \
  tests/unit/renderer/panels/macros/inchat.test.ts
git commit -m "feat(macros): reply-mode expansion + preview hook for in-chat macros"
```

---

### Task 4: Thread `client` and `onMacro` down to the quick bar

`client` already lives in `MessageList`'s `RowContext` but stops there. Carry it one hop further, alongside the new insert callback, and use it immediately for one real behaviour: the macro cluster disappears when there is no client, since nothing could be rendered.

The macro cluster still shows `SEED_MACROS` at the end of this task — Task 5 swaps in the real data. Splitting here keeps the mechanical prop-threading reviewable on its own.

**Files:**
- Modify: `src/renderer/features/message-actions/MessageQuickBar.tsx:17-29` (props), `:81-94` (gate)
- Modify: `src/renderer/components/MessageItem.tsx:13-30` (props), `:133-141` (pass-through)
- Modify: `src/renderer/components/MessageRow.tsx` (whole file)
- Modify: `src/renderer/components/MessageList.tsx:28-46` (Props), `:48-59` (RowContext), `:87-100` (ItemRow), `:109-125` (destructure), `:313-324` (context object)
- Modify: `src/renderer/panels/ChannelView.tsx:82-84` (handler), `:144-146` (prop)
- Modify: `src/renderer/panels/DMView.tsx:77-79` (handler), `:113-115` (prop)
- Test: `tests/component/message-quick-bar.test.tsx` (update)
- Test: `tests/component/message-item-quick-bar.test.tsx` (update)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `MessageQuickBar` props gain `client: ApiClient | null` and `onMacro?: (name: string, text: string) => void`.
  - `MessageItem` props gain `client?: ApiClient | null` and `onMacro?: (name: string, text: string) => void`.
  - `MessageRow` props gain `client: ApiClient | null` and `onMacro?: (name: string, text: string) => void`.
  - `MessageList` props gain `onMacro?: (name: string, text: string) => void`; its `RowContext` gains `client` (already present) and `onMacro`.

  Task 5 uses `client` and `onMacro` inside `MessageQuickBar`.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/component/message-quick-bar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageQuickBar } from '@/features/message-actions/MessageQuickBar';
import type { ApiClient } from '@/lib/api';
import { useStore } from '@/lib/store';
import { DEFAULT_UI_STATE, type Message } from '../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const other: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };
const mine: Message = { id: 'm2', key: 'ch:x', body: 'yo', ts: 0, state: 'sent' };

// MessageQuickBar uses Radix Tooltip (via its IconBtn helper and ReactionRow),
// which requires an ancestor TooltipProvider (supplied in the real app by
// AppShell's SidebarProvider). Isolated component tests need to supply that
// context explicitly.
function renderBar(props: React.ComponentProps<typeof MessageQuickBar>) {
  return render(
    <TooltipProvider>
      <MessageQuickBar {...props} />
    </TooltipProvider>,
  );
}

const base = { message: other, isSelf: false, senderName: 'K5TH', client, onReact: () => {}, onReply: () => {} };

describe('MessageQuickBar', () => {
  beforeEach(() => useStore.setState({ ui: { ...DEFAULT_UI_STATE }, macros: [] }));

  test('others: quick-react records usage and calls onReact', () => {
    const onReact = vi.fn();
    renderBar({ ...base, onReact });
    fireEvent.click(screen.getByRole('button', { name: 'Reply with 👍' }));
    expect(onReact).toHaveBeenCalledWith('K5TH', '👍');
    expect(useStore.getState().ui.emojiUsage['👍'].count).toBe(1);
  });

  test('others: Reply calls onReply', () => {
    const onReply = vi.fn();
    renderBar({ ...base, onReply });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith('K5TH');
  });

  test('self: shows Copy / Info / Delete and no Reply', () => {
    renderBar({ ...base, message: mine, isSelf: true, senderName: '' });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  test('hidden pill is non-interactive (pointer-events-none, not pinned open)', () => {
    renderBar(base);
    const bar = screen.getByTestId('message-quick-bar');
    expect(bar.className).toContain('pointer-events-none');
    expect(bar.getAttribute('data-open')).toBe('false');
  });

  test('with a client, the macro cluster is present', () => {
    renderBar(base);
    expect(screen.getByRole('button', { name: 'All macros' })).toBeTruthy();
  });

  test('without a client, the macro cluster is omitted (nothing can render)', () => {
    renderBar({ ...base, client: null });
    expect(screen.queryByRole('button', { name: 'All macros' })).toBeNull();
    // The rest of the bar is unaffected.
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });
});
```

Replace the entire contents of `tests/component/message-item-quick-bar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ApiClient } from '@/lib/api';
import type { Message } from '../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const message: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };

describe('MessageItem quick bar', () => {
  test('interactive rows render the quick bar (Reply present for others)', () => {
    render(
      <TooltipProvider>
        <MessageItem
          message={message}
          isSelf={false}
          style="rich"
          senderName="K5TH"
          timeFormat="24h"
          client={client}
          onSelect={() => {}}
          onReply={() => {}}
          onReact={() => {}}
          onMacro={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });

  test('passes its client through, so the macro cluster is reachable', () => {
    render(
      <TooltipProvider>
        <MessageItem
          message={message}
          isSelf={false}
          style="rich"
          senderName="K5TH"
          timeFormat="24h"
          client={client}
          onSelect={() => {}}
          onReply={() => {}}
          onReact={() => {}}
          onMacro={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'All macros' })).toBeTruthy();
  });

  test('without a client the macro cluster is omitted', () => {
    render(
      <TooltipProvider>
        <MessageItem
          message={message}
          isSelf={false}
          style="rich"
          senderName="K5TH"
          timeFormat="24h"
          onSelect={() => {}}
          onReply={() => {}}
          onReact={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'All macros' })).toBeNull();
  });

  test('non-interactive previews (no onSelect) render no quick bar', () => {
    render(<MessageItem message={message} isSelf={false} style="rich" senderName="K5TH" timeFormat="24h" />);
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project dom tests/component/message-quick-bar.test.tsx tests/component/message-item-quick-bar.test.tsx`
Expected: FAIL — the "without a client" cases fail because the macro cluster renders unconditionally today.

- [ ] **Step 3: Add the props to `MessageQuickBar` and gate the cluster**

In `src/renderer/features/message-actions/MessageQuickBar.tsx`, add the import:

```tsx
import type { ApiClient } from '../../lib/api';
```

Replace the `Props` interface (lines 17-23):

```tsx
interface Props {
  message: Message;
  isSelf: boolean;
  senderName: string;
  client: ApiClient | null;
  onReact: (name: string, emoji: string) => void;
  onReply: (name: string) => void;
  /** Insert rendered macro text into the composer as `@[name] <text> `. */
  onMacro?: (name: string, text: string) => void;
}
```

Update the destructure on line 26. `onMacro` is declared in `Props` (so `MessageItem`
can pass it) but deliberately **not** destructured yet — nothing consumes it until
Task 5, and an unused binding would fail lint:

```tsx
export function MessageQuickBar({ message, isSelf, senderName, client, onReact, onReply }: Props) {
```

Wrap the macro cluster (lines 81-94) in the client gate:

```tsx
            {client != null && (
              <div className="flex items-center gap-1 pl-1">
                {SEED_MACROS.slice(0, 2).map((m) => (
                  <MacroChip key={m.label} label={m.label} />
                ))}
                <MacroPanel {...P('macro')}>
                  <button
                    type="button"
                    aria-label="All macros"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
                  >
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </button>
                </MacroPanel>
              </div>
            )}
```

- [ ] **Step 4: Thread through `MessageItem`**

In `src/renderer/components/MessageItem.tsx`, add the import:

```tsx
import type { ApiClient } from '../lib/api';
```

Add to `MessageItemProps` (after `onReact`, line ~29):

```tsx
  /** Needed by the quick bar's macro affordances; absent ⇒ no macro cluster. */
  client?: ApiClient | null;
  onMacro?: (name: string, text: string) => void;
```

Add `client` and `onMacro` to the destructure (lines 50-62), then pass them to the bar (lines 133-141):

```tsx
      {interactive && onReact && (
        <MessageQuickBar
          message={message}
          isSelf={isSelf}
          senderName={senderName}
          client={client ?? null}
          onReact={onReact}
          onReply={(name) => onReply?.(name)}
          onMacro={onMacro}
        />
      )}
```

- [ ] **Step 5: Thread through `MessageRow`**

Replace the `Props` interface and the component body in `src/renderer/components/MessageRow.tsx`:

```tsx
import type { Message, MessageStyle } from '../../shared/types';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { MessageItem } from './MessageItem';

interface Props {
  message: Message;
  isSelf: boolean;
  selected: boolean;
  /** Briefly applies a pulsing background to mark a search-jump landing. */
  flash?: boolean;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  style: MessageStyle;
  /** Caller-resolved sender display name ('' for self / unknown). */
  senderName: string;
  client: ApiClient | null;
  onReply?: (name: string) => void;
  onReact?: (name: string, emoji: string) => void;
  onMacro?: (name: string, text: string) => void;
}

/**
 * Conversation-list row: a thin, interactive adapter over the shared
 * {@link MessageItem}. It only adds the one piece of store state the
 * presentational component needs (the clock format); everything else is
 * forwarded from the MessageList row context.
 */
export function MessageRow({
  message,
  isSelf,
  selected,
  flash,
  onSelect,
  onContextMenu,
  style,
  senderName,
  client,
  onReply,
  onReact,
  onMacro,
}: Props) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  return (
    <MessageItem
      message={message}
      isSelf={isSelf}
      style={style}
      senderName={senderName}
      timeFormat={timeFormat}
      selected={selected}
      flash={flash}
      client={client}
      onSelect={onSelect}
      onContextMenu={onContextMenu}
      onReply={onReply}
      onReact={onReact}
      onMacro={onMacro}
    />
  );
}
```

- [ ] **Step 6: Thread through `MessageList`**

In `src/renderer/components/MessageList.tsx`:

Add to `Props` after `onReact` (line ~40):

```tsx
  onMacro?: (name: string, text: string) => void;
```

Add to `RowContext` after `onReact` (line ~56):

```tsx
  onMacro?: (name: string, text: string) => void;
```

Pass both to `MessageRow` inside `ItemRow` (lines 88-99) — add after `onReact`:

```tsx
      client={context.client}
      onMacro={context.onMacro}
```

Add `onMacro` to the `MessageList` destructure (after `onReact`, line ~121), and to the `context` object (lines 313-324) after `onReact`:

```tsx
    onMacro,
```

- [ ] **Step 7: Add the handlers in the two conversation views**

In `src/renderer/panels/ChannelView.tsx`, after `handleReact` (line ~84):

```tsx
  const handleMacro = (name: string, text: string) => {
    composerRef.current?.insertReaction(name, text);
  };
```

and pass it to `MessageList` after `onReact={handleReact}` (line ~145):

```tsx
          onMacro={handleMacro}
```

Make the identical two edits in `src/renderer/panels/DMView.tsx` (handler after line ~79, prop after line ~114).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run --project dom tests/component/message-quick-bar.test.tsx tests/component/message-item-quick-bar.test.tsx`
Expected: PASS — 6 + 4 tests.

- [ ] **Step 9: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npx biome check src tests && npx vitest run`
Expected: all clean. `MessagesTab` (repeater-admin) renders `MessageList` without `onReact`, so no quick bar mounts there and it needs no change.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/features/message-actions/MessageQuickBar.tsx \
  src/renderer/components/MessageItem.tsx src/renderer/components/MessageRow.tsx \
  src/renderer/components/MessageList.tsx src/renderer/panels/ChannelView.tsx \
  src/renderer/panels/DMView.tsx tests/component/message-quick-bar.test.tsx \
  tests/component/message-item-quick-bar.test.tsx
git commit -m "feat(macros): thread client + onMacro to the message quick bar"
```

---

### Task 5: Real macros in the panel and the chips

Swap `SEED_MACROS` for the store. The panel lists the conversation's applicable macros with rendered previews and character counts; the two chips are the most-frecent of those. Clicking either inserts.

**Files:**
- Modify: `src/renderer/features/message-actions/MacroPanel.tsx` (whole file)
- Modify: `src/renderer/features/message-actions/MessageQuickBar.tsx` (imports, macro cluster, pick handler)
- Test: `tests/component/macro-panel.test.tsx` (rewrite)
- Test: `tests/component/message-quick-bar.test.tsx` (extend)

**Interfaces:**
- Consumes: `applicableMacros`, `topMacros` (Task 2); `MAX_MESSAGE_LENGTH`, `expandMacroReply`, `useReplyPreviews`, `PreviewState` (Task 3); `recordMacroUse`, `ui.macroUsage` (Task 1); `MessageQuickBar`'s `client` / `onMacro` props (Task 4); pre-existing `Snippet` from `panels/macros/components/chips` and `useStore((s) => s.macros)`.
- Produces:
  - `MacroChip({ macro, onPick })` — `{ macro: MacroTemplate; onPick: (macro: MacroTemplate) => void }`.
  - `MacroPanel({ open, onOpenChange, macros, client, message, onPick, children })` where `onPick: (macro: MacroTemplate, renderedText?: string) => void`.

- [ ] **Step 1: Rewrite the panel test**

Replace the entire contents of `tests/component/macro-panel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { MacroChip, MacroPanel } from '@/features/message-actions/MacroPanel';
import { type ApiClient, api } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { MacroTemplate } from '../../src/shared/macros/types';
import type { Message } from '../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const message: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };

const signal: MacroTemplate = {
  id: 'a',
  name: 'Signal report',
  template: '{{ snr }} snr',
  scope: 'global',
  createdAt: 0,
  updatedAt: 0,
};
const relaying: MacroTemplate = { ...signal, id: 'b', name: 'Relaying', template: 'relaying now' };

function renderPanel(macros: MacroTemplate[], onPick = vi.fn()) {
  render(
    <MacroPanel open onOpenChange={() => {}} macros={macros} client={client} message={message} onPick={onPick}>
      <button type="button">macros</button>
    </MacroPanel>,
  );
  return onPick;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useStore.setState({ macros: [signal, relaying] });
});

describe('MacroPanel', () => {
  test('lists the macros it is given, with no "soon" badge', () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'rendered' });
    renderPanel([signal, relaying]);
    expect(screen.getByText('Signal report')).toBeTruthy();
    expect(screen.getByText('Relaying')).toBeTruthy();
    expect(screen.queryByText('soon')).toBeNull();
  });

  test('shows each macro rendered in reply mode, with a character count', async () => {
    const spy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: '6.5 snr' });
    renderPanel([signal]);
    await waitFor(() => expect(screen.getByText('6.5 snr')).toBeTruthy());
    expect(screen.getByText('7c')).toBeTruthy();
    expect(spy.mock.calls[0][1]).toMatchObject({ macroId: 'a', mode: 'reply', messageId: 'm1' });
  });

  test('flags a render that overflows the 132-char message cap', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'x'.repeat(141) });
    renderPanel([signal]);
    const count = await screen.findByText('141c');
    expect(count.className).toContain('text-cs-danger');
  });

  test('a row click reports the already-rendered text and issues no second render', async () => {
    const spy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: '6.5 snr' });
    const onPick = renderPanel([signal]);
    await waitFor(() => expect(screen.getByText('6.5 snr')).toBeTruthy());
    fireEvent.click(screen.getByText('Signal report'));
    expect(onPick).toHaveBeenCalledWith(signal, '6.5 snr');
    expect(spy).toHaveBeenCalledTimes(1); // the preview render only
  });

  test('a failed render leaves the row clickable with no cached text', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({
      ok: false,
      error: { kind: 'unknown-variable', message: 'no such variable' },
    });
    const onPick = renderPanel([signal]);
    await waitFor(() => expect(screen.getByText('no such variable')).toBeTruthy());
    fireEvent.click(screen.getByText('Signal report'));
    expect(onPick).toHaveBeenCalledWith(signal, undefined);
  });

  test('empty store: points at the Macros tool', () => {
    useStore.setState({ macros: [] });
    renderPanel([]);
    expect(screen.getByText(/No macros yet/i)).toBeTruthy();
  });

  test('macros exist but none apply here: says so', () => {
    renderPanel([]);
    expect(screen.getByText(/No macros for this conversation/i)).toBeTruthy();
  });
});

describe('MacroChip', () => {
  test('renders the macro name and is enabled', () => {
    render(<MacroChip macro={signal} onPick={() => {}} />);
    const button = screen.getByText('Signal report').closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  test('reports the macro on click', () => {
    const onPick = vi.fn();
    render(<MacroChip macro={signal} onPick={onPick} />);
    fireEvent.click(screen.getByText('Signal report'));
    expect(onPick).toHaveBeenCalledWith(signal);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project dom tests/component/macro-panel.test.tsx`
Expected: FAIL — type/prop errors and `soon` still rendering; `MacroChip` still takes `label`.

- [ ] **Step 3: Rewrite `MacroPanel.tsx`**

Replace the entire contents of `src/renderer/features/message-actions/MacroPanel.tsx`:

```tsx
import { Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MacroTemplate } from '../../../shared/macros/types';
import type { Message } from '../../../shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import type { ApiClient } from '../../lib/api';
import { MAX_MESSAGE_LENGTH } from '../../lib/messageLimits';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Snippet } from '../../panels/macros/components/chips';
import { type PreviewState, useReplyPreviews } from '../../panels/macros/lib/useReplyPreviews';

/** One-click macro shortcut in the quick bar. */
export function MacroChip({ macro, onPick }: { macro: MacroTemplate; onPick: (macro: MacroTemplate) => void }) {
  return (
    <button
      type="button"
      title={macro.name}
      onClick={() => onPick(macro)}
      className="inline-flex max-w-[92px] items-center gap-1 rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1 text-[11px] font-medium text-cs-text-muted hover:text-cs-text"
    >
      <span className="shrink-0 text-cs-accent">
        <Zap size={11} aria-hidden="true" />
      </span>
      <span className="truncate">{macro.name}</span>
    </button>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already scope-filtered by the caller (see macroPicks.applicableMacros). */
  macros: MacroTemplate[];
  client: ApiClient | null;
  message: Message;
  /** `renderedText` is present when the row already previewed successfully, so
   *  the caller can insert it without a second round-trip. */
  onPick: (macro: MacroTemplate, renderedText?: string) => void;
  children: ReactNode;
}

/** The all-macros popover: every macro that applies to this conversation,
 *  previewed against the message being replied to. */
export function MacroPanel({ open, onOpenChange, macros, client, message, onPick, children }: Props) {
  const previews = useReplyPreviews(client, message.id, macros, open);
  // Distinguishes "you have no macros" from "none of yours apply here".
  const totalMacros = useStore((s) => s.macros.length);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[300px] border-cs-border-strong bg-cs-bg-2 p-1.5">
        <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Reply macros</span>
          <span className="ml-auto font-mono text-[9.5px] text-cs-text-dim">vs this message</span>
        </div>
        {macros.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-cs-text-dim">
            {totalMacros === 0 ? 'No macros yet — create one in the Macros tool.' : 'No macros for this conversation.'}
          </div>
        ) : (
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {macros.map((m) => (
              <MacroRow key={m.id} macro={m} preview={previews[m.id]} onPick={onPick} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One macro: name + character count, over a preview of what would be sent.
 *  Until the render resolves (or if it fails) the raw template stands in, so
 *  the row is never blank and stays clickable either way. */
function MacroRow({
  macro,
  preview,
  onPick,
}: {
  macro: MacroTemplate;
  preview: PreviewState | undefined;
  onPick: (macro: MacroTemplate, renderedText?: string) => void;
}) {
  const rendered = preview?.status === 'ok' ? preview : null;
  return (
    <button
      type="button"
      onClick={() => onPick(macro, rendered?.text)}
      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-cs-bg-3"
    >
      <span className="flex w-full items-center gap-2">
        <span className="shrink-0 text-cs-accent">
          <Zap size={14} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-cs-text">{macro.name}</span>
        {rendered && (
          <span
            className={cn(
              'shrink-0 font-mono text-[9.5px]',
              rendered.len > MAX_MESSAGE_LENGTH ? 'text-cs-danger' : 'text-cs-text-dim',
            )}
          >
            {rendered.len}c
          </span>
        )}
      </span>
      {rendered ? (
        <span className="block w-full truncate pl-[22px] text-[11px] text-cs-text-dim">{rendered.text}</span>
      ) : (
        <Snippet template={macro.template} className="block w-full truncate pl-[22px] text-[11px]" />
      )}
      {preview?.status === 'error' && (
        <span className="block w-full truncate pl-[22px] text-[10px] text-cs-danger">{preview.message}</span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run the panel test to verify it passes**

Run: `npx vitest run --project dom tests/component/macro-panel.test.tsx`
Expected: PASS — 9 tests. `MessageQuickBar` still passes the old props, so `tsc` is red until Step 5.

- [ ] **Step 5: Wire the chips and the pick handler in `MessageQuickBar`**

In `src/renderer/features/message-actions/MessageQuickBar.tsx`, replace the `SEED_MACROS` import with:

```tsx
import type { MacroTemplate } from '../../../shared/macros/types';
import { expandMacroReply } from '../../panels/macros/lib/inchat';
import { applicableMacros, topMacros } from './macroPicks';
```

Add `onMacro` to the component's destructure, and after the existing `recordEmojiUse` line add:

```tsx
  const macros = useStore((s) => s.macros);
  const macroUsage = useStore((s) => s.ui.macroUsage);
  const recordMacroUse = useStore((s) => s.recordMacroUse);
  const [macroBusy, setMacroBusy] = useState(false);
  // Recomputed per render like ReactionRow's emoji row — both lists are tiny.
  const conversationMacros = applicableMacros(macros, message.key);
  const chipMacros = topMacros(conversationMacros, macroUsage, Date.now(), 2);
```

Add the pick handler next to `pick` / `reply`:

```tsx
  // Named pickMacro, not useMacro: a `use*` name would be treated as a hook.
  const pickMacro = async (macro: MacroTemplate, cachedText?: string) => {
    // Same guard as pick/reply: an unresolved sender would insert `@[] `.
    if (!hasSender || macroBusy) return;
    setMacroBusy(true);
    const text = cachedText ?? (await expandMacroReply(client, macro, message));
    setMacroBusy(false);
    if (text == null) return; // render failed and already toasted
    recordMacroUse(macro.id);
    onMacro?.(senderName, text);
    setOpen(null);
  };
```

Replace the macro cluster body from Task 4 with:

```tsx
            {client != null && (
              <div className="flex items-center gap-1 pl-1">
                {chipMacros.map((m) => (
                  <MacroChip key={m.id} macro={m} onPick={(macro) => void pickMacro(macro)} />
                ))}
                <MacroPanel
                  {...P('macro')}
                  macros={conversationMacros}
                  client={client}
                  message={message}
                  onPick={(macro, text) => void pickMacro(macro, text)}
                >
                  <button
                    type="button"
                    aria-label="All macros"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
                  >
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </button>
                </MacroPanel>
              </div>
            )}
```

- [ ] **Step 6: Extend the quick-bar test**

Append these tests inside the existing `describe('MessageQuickBar', …)` block in `tests/component/message-quick-bar.test.tsx`:

```tsx
  test('chips are the two most-frecent applicable macros', () => {
    useStore.setState({
      macros: [
        { id: 'a', name: 'Alpha', template: 'a', scope: 'global', createdAt: 0, updatedAt: 0 },
        { id: 'b', name: 'Bravo', template: 'b', scope: 'global', createdAt: 0, updatedAt: 0 },
        { id: 'c', name: 'Charlie', template: 'c', scope: 'global', createdAt: 0, updatedAt: 0 },
      ],
      ui: { ...DEFAULT_UI_STATE, macroUsage: { c: { count: 9, lastUsedMs: Date.now() } } },
    });
    renderBar(base);
    expect(screen.getByText('Charlie')).toBeTruthy(); // most-frecent leads
    expect(screen.getByText('Alpha')).toBeTruthy(); // then store order
    expect(screen.queryByText('Bravo')).toBeNull(); // only two chips
  });

  test('a chip click renders, records usage, and inserts into the composer', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'relaying now' });
    useStore.setState({
      macros: [{ id: 'a', name: 'Relaying', template: 'relaying now', scope: 'global', createdAt: 0, updatedAt: 0 }],
      ui: { ...DEFAULT_UI_STATE },
    });
    const onMacro = vi.fn();
    renderBar({ ...base, onMacro });
    fireEvent.click(screen.getByText('Relaying'));
    await waitFor(() => expect(onMacro).toHaveBeenCalledWith('K5TH', 'relaying now'));
    expect(useStore.getState().ui.macroUsage.a.count).toBe(1);
  });

  test('a failed render neither inserts nor records usage', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({
      ok: false,
      error: { kind: 'render', message: 'boom' },
    });
    useStore.setState({
      macros: [{ id: 'a', name: 'Relaying', template: 'relaying now', scope: 'global', createdAt: 0, updatedAt: 0 }],
      ui: { ...DEFAULT_UI_STATE },
    });
    const onMacro = vi.fn();
    renderBar({ ...base, onMacro });
    fireEvent.click(screen.getByText('Relaying'));
    await waitFor(() => expect(api.renderMacro).toHaveBeenCalled());
    expect(onMacro).not.toHaveBeenCalled();
    expect(useStore.getState().ui.macroUsage.a).toBeUndefined();
  });

  test('a contact-scoped macro does not appear on a channel message', () => {
    useStore.setState({
      macros: [
        { id: 'c1', name: 'ForKarin', template: 'x', scope: 'contact', contactKey: 'c:7b21', createdAt: 0, updatedAt: 0 },
      ],
      ui: { ...DEFAULT_UI_STATE },
    });
    renderBar(base); // message.key is 'ch:x'
    expect(screen.queryByText('ForKarin')).toBeNull();
  });
```

Extend that file's imports to cover the new usage:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
```

```tsx
import { type ApiClient, api } from '@/lib/api';
```

and add the notify mock immediately after the `vitest` import, before the app imports
(the placement used by the other macro tests — Vitest hoists `vi.mock` regardless):

```tsx
vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
```

Also add `vi.restoreAllMocks();` to the file's `beforeEach`.

- [ ] **Step 7: Run both component tests**

Run: `npx vitest run --project dom tests/component/macro-panel.test.tsx tests/component/message-quick-bar.test.tsx`
Expected: PASS — 9 + 10 tests.

- [ ] **Step 8: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npx biome check src tests && npx vitest run`
Expected: all clean. `quickBarData.ts` is now unimported but still on disk — Task 6 removes it.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/features/message-actions/MacroPanel.tsx \
  src/renderer/features/message-actions/MessageQuickBar.tsx \
  tests/component/macro-panel.test.tsx tests/component/message-quick-bar.test.tsx
git commit -m "feat(macros): real macros in the quick bar panel and chips"
```

---

### Task 6: Retire the superseded in-chat macro code

`QuickReplyMenu` lost its mount point during the rebase and its logic now lives in `MacroPanel`. `sendMacroReply` was its only caller and nothing transmits macros any more. `quickBarData.ts` lost its last importer in Task 5.

**Files:**
- Delete: `src/renderer/panels/macros/inchat/QuickReplyMenu.tsx`
- Delete: `tests/component/macros/QuickReplyMenu.test.tsx`
- Delete: `src/renderer/features/message-actions/quickBarData.ts`
- Modify: `src/renderer/panels/macros/lib/inchat.ts` (drop `sendMacroReply`)

**Interfaces:**
- Consumes: everything from Tasks 1-5 must already be in place — this task only removes.
- Produces: nothing new.

- [ ] **Step 1: Confirm each file is genuinely unreferenced**

Run:

```bash
grep -rn "QuickReplyMenu\|SEED_MACROS\|quickBarData\|sendMacroReply" src tests
```

Expected: matches only inside the four files being removed/edited. Any other hit means an earlier task is incomplete — fix that before deleting.

- [ ] **Step 2: Delete the retired files**

```bash
git rm src/renderer/panels/macros/inchat/QuickReplyMenu.tsx \
  tests/component/macros/QuickReplyMenu.test.tsx \
  src/renderer/features/message-actions/quickBarData.ts
```

- [ ] **Step 3: Drop `sendMacroReply`**

In `src/renderer/panels/macros/lib/inchat.ts`, delete this function entirely:

```ts
/** Render a macro against a received message's reply context and send it to
 *  that conversation. Returns true on success. */
export async function sendMacroReply(
  client: ApiClient | null,
  macro: MacroTemplate,
  message: { id: string; key: string },
): Promise<boolean> {
  if (!client) return false;
  const res = await api.renderMacro(client, { macroId: macro.id, mode: 'reply', messageId: message.id, placeholder: '?' });
  if (!res.ok) {
    notify.error(`Couldn’t expand “${macro.name}”: ${res.error.message}`);
    return false;
  }
  try {
    await api.sendMessage(client, message.key, res.text);
    notify.success('Reply sent');
    return true;
  } catch (err) {
    notify.error(`Send failed: ${(err as Error).message}`, err);
    return false;
  }
}
```

`targetToContext`, `expandMacro` and `expandMacroReply` stay. `notify.success` may now be unused in the file — if `tsc`/Biome flags the `notify` import, keep it (both remaining functions call `notify.error`).

- [ ] **Step 4: Full verification**

Run each and confirm clean output before claiming the task done:

```bash
npx vitest run
npx tsc --noEmit
npx biome check src tests
```

Expected: all three pass. The `dom` project should no longer list `QuickReplyMenu.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/panels/macros/lib/inchat.ts
git commit -m "refactor(macros): retire QuickReplyMenu, seed macros, and sendMacroReply"
```

- [ ] **Step 6: Confirm the feature in the real app**

Follow the recipe in the project's e2e verification notes: `pnpm package`, launch under Playwright + Electron with `CORESENSE_USER_DATA` and `FAKE_TRANSPORT` set, seed a conversation into `messages.db`, then hover a received message and check that the two chips carry real macro names, the `⋯` panel shows rendered text with character counts, and clicking either lands `@[sender] <text> ` in the composer without transmitting.

---

## Notes for the implementer

- **`cs-*` classes are project design tokens**, not stock Tailwind: `cs-bg-2`/`cs-bg-3` (surfaces), `cs-border`/`cs-border-strong`, `cs-text`/`cs-text-muted`/`cs-text-dim`, `cs-accent`, `cs-danger`. Use them; don't substitute raw colours.
- **`P('macro')` in `MessageQuickBar`** spreads `{ open, onOpenChange }` — that is why those two props stay first in `MacroPanel`'s signature and why the spread comes before the explicit props in JSX.
- **Radix Popover needs `ResizeObserver`** in jsdom; `tests/component/setup.ts` already stubs it. Popover content renders in a portal, so `screen.getByText` finds it without extra queries.
- **Message keys** are `ch:<hash>` for channels and `c:<pubkeyhex>` for DMs; `Message.key` is the conversation key, which is the same keyspace macros persist in `channelKey`/`contactKey`.
- **Curly quotes in toast strings** (`Couldn’t expand “name”`) match the existing `inchat.ts` copy — keep them.
