# Message Actions — Quick Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discord-style hover quick-actions bar to message rows that composes emoji/macro/reply as `@[sender] …` messages into the composer (no wire protocol), with a custom frimousse emoji picker and account-global frecency auto-pinning.

**Architecture:** A per-row absolute-overlay `MessageQuickBar` mounts inside `MessageItem`'s existing `group` container and reveals on hover. Emoji/Reply insert `@[sender] …` at the composer caret and set a reply-context chip; nothing is stored or transmitted as a "reaction." Emoji usage is tracked in `UiState.emojiUsage` (account-global) and drives an auto-pinned quick-react row. Leaf popovers (emoji picker, message info, overflow, macros) are self-contained; only `onReact`/`onReply` reach back to the view's composer ref.

**Tech Stack:** React 19 + TypeScript, Zustand store, shadcn/ui (Radix) + Tailwind v4, lucide-react, `sonner` toasts, `frimousse` + `emojibase-data` (new), Vitest (`unit` node + `dom` jsdom projects).

**Design references:**
- Spec: [docs/superpowers/specs/2026-07-05-message-quick-actions-design.md](../specs/2026-07-05-message-quick-actions-design.md)
- Handoff: [docs/design/message-actions-quickbar/README.md](../../design/message-actions-quickbar/README.md) (+ `qb-concepts.jsx`, `ma-shared.jsx`, `ma-data.js`)

## Global Constraints

- **Message limit:** `MAX_MESSAGE_LENGTH = 132` (MeshCore). Do NOT use the prototype's 200.
- **Mention token format:** `@[name]` (bracketed) so `MentionPill` renders it — NOT the prototype's bare `@name`.
- **No wire protocol / no reaction records:** emoji/macro/reply only insert composer text.
- **Design tokens:** use existing `cs-*` tokens (`cs-bg-2/3`, `cs-text`, `cs-text-dim`, `cs-text-muted`, `cs-border`, `cs-border-strong`, `cs-accent`, `cs-accent-soft`, `cs-online`, `cs-danger`) and lucide icons.
- **Biome scope for lint:** `pnpm exec biome check src tests` (repo-wide check trips on build artifacts).
- **Baseline commands:** `pnpm typecheck` and `pnpm test` must stay green. DOM tests live in `tests/component/*.test.tsx`; pure unit tests in `tests/unit/renderer/**/*.test.ts`.
- **DOM test timing:** for discrete-event (click/outside-click) assertions, wrap state-changing dispatch in `flushSync` from `react-dom` (see `tests/component/deselect-on-outside-click.test.tsx`).
- **Macros & Delete are non-functional "soon" placeholders** in this feature.

---

## File Structure

**New (feature module `src/renderer/features/message-actions/`):**
- `frecency.ts` — pure frecency scoring + top-N selection + usage recording.
- `paths.ts` — pure path→comma/newline string formatting for the copy actions.
- `quickBarData.ts` — seed macro list (static "soon" data).
- `ReactionRow.tsx` — inline row of one-click quick-react emoji buttons.
- `EmojiPickerPopover.tsx` — Popover wrapping the frimousse picker + frecency row + footer.
- `MessageInfoPopover.tsx` — the Info popover (fields + PATH).
- `OverflowMenu.tsx` — the merged `⋯` menu (view contact / copy key / copy paths / dismiss-soon).
- `MacroPanel.tsx` — macro chips + all-macros "soon" popover.
- `MessageQuickBar.tsx` — the pill assembling the above (author-aware).

**New shadcn component:**
- `src/renderer/components/ui/emoji-picker.tsx` — frimousse-based (added via shadcn CLI).

**Modified:**
- `src/shared/types.ts` — `EmojiUse`/`EmojiUsage` types; `UiState.emojiUsage`; `DEFAULT_UI_STATE`.
- `src/renderer/lib/store.ts` — `recordEmojiUse`; `applyUiState` whitelist + idempotency.
- `src/renderer/components/Composer.tsx` — `insertReaction`; reply-context chip; `replyingTo`/`onClearReply`.
- `src/renderer/components/MessageItem.tsx` — mount `MessageQuickBar`; `relative`; remove standalone reply button; `onReact` prop.
- `src/renderer/components/MessageRow.tsx` — thread `onReact`.
- `src/renderer/components/MessageList.tsx` — `RowContext.onReact`.
- `src/renderer/panels/ChannelView.tsx`, `src/renderer/panels/DMView.tsx` — `replyingTo` state + `onReact`/reply wiring + Composer props.
- `vite.renderer.config.mts` — static-copy of `emojibase-data/en/*`.
- `package.json` — `frimousse`, `emojibase-data`, `vite-plugin-static-copy`.

**Key interfaces (locked; used across tasks):**
```ts
// src/shared/types.ts
export interface EmojiUse { count: number; lastUsedMs: number }
export type EmojiUsage = Record<string, EmojiUse>

// src/renderer/features/message-actions/frecency.ts
export const EMOJI_SEED: readonly string[] // ['👍','✅','📡','🔋','😂','❤️']
export function scoreEmoji(entry: EmojiUse, nowMs: number): number
export function topEmojis(usage: EmojiUsage, nowMs: number, n: number, seed: readonly string[]): string[]
export function recordUsage(usage: EmojiUsage, emoji: string, nowMs: number): EmojiUsage

// src/renderer/features/message-actions/paths.ts
export function formatPathHeard(path: MessagePath): string
export function formatFirstPathHeard(message: Message): string | null
export function formatAllPathsHeard(message: Message): string | null

// store (src/renderer/lib/store.ts)
recordEmojiUse: (emoji: string) => void

// Composer (src/renderer/components/Composer.tsx)
interface ComposerHandle { insertMention(name: string): void; insertReaction(name: string, content: string): void }
// new props: replyingTo?: string | null; onClearReply?: () => void

// RowContext (MessageList) adds: onReact?: (name: string, emoji: string) => void
```

---

### Task 1: Frecency logic (`frecency.ts`)

**Files:**
- Create: `src/renderer/features/message-actions/frecency.ts`
- Modify: `src/shared/types.ts` (add `EmojiUse` + `EmojiUsage`)
- Test: `tests/unit/renderer/features/message-actions/frecency.test.ts`

**Interfaces:**
- Produces: `EMOJI_SEED`, `scoreEmoji`, `topEmojis`, `recordUsage`; `EmojiUse`/`EmojiUsage` (in shared).

- [ ] **Step 1: Add the usage types to shared types**

In `src/shared/types.ts`, add near the other UI types (above `export interface UiState`):
```ts
/** Per-emoji usage for frecency-based quick-react pinning. Account-global. */
export interface EmojiUse {
  count: number;
  lastUsedMs: number;
}
export type EmojiUsage = Record<string, EmojiUse>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/renderer/features/message-actions/frecency.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { EmojiUsage } from '../../../../../src/shared/types';
import { EMOJI_SEED, recordUsage, scoreEmoji, topEmojis } from '../../../../../src/renderer/features/message-actions/frecency';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

describe('scoreEmoji', () => {
  it('rewards higher count and more recent use', () => {
    const recent = scoreEmoji({ count: 3, lastUsedMs: NOW }, NOW);
    const old = scoreEmoji({ count: 3, lastUsedMs: NOW - 30 * DAY }, NOW);
    expect(recent).toBeGreaterThan(old);
    const more = scoreEmoji({ count: 10, lastUsedMs: NOW }, NOW);
    expect(more).toBeGreaterThan(recent);
  });
});

describe('topEmojis', () => {
  it('returns empty usage as the seed, capped to n', () => {
    expect(topEmojis({}, NOW, 5, EMOJI_SEED)).toEqual(EMOJI_SEED.slice(0, 5));
  });

  it('orders used emoji by frecency, then backfills from the seed without dupes', () => {
    const usage: EmojiUsage = {
      '🔥': { count: 5, lastUsedMs: NOW },
      '👍': { count: 1, lastUsedMs: NOW - 10 * DAY },
    };
    const top = topEmojis(usage, NOW, 5, EMOJI_SEED);
    expect(top[0]).toBe('🔥'); // highest frecency first
    expect(top).toContain('👍');
    expect(new Set(top).size).toBe(top.length); // no duplicates
    expect(top).toHaveLength(5);
  });
});

describe('recordUsage', () => {
  it('increments count and updates the timestamp immutably', () => {
    const before: EmojiUsage = { '👍': { count: 2, lastUsedMs: NOW - DAY } };
    const after = recordUsage(before, '👍', NOW);
    expect(after['👍']).toEqual({ count: 3, lastUsedMs: NOW });
    expect(before['👍'].count).toBe(2); // original untouched
  });

  it('creates a new entry for a first-seen emoji', () => {
    expect(recordUsage({}, '📡', NOW)['📡']).toEqual({ count: 1, lastUsedMs: NOW });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/features/message-actions/frecency.test.ts`
Expected: FAIL — cannot resolve `frecency` module.

- [ ] **Step 4: Implement `frecency.ts`**

Create `src/renderer/features/message-actions/frecency.ts`:
```ts
import type { EmojiUse, EmojiUsage } from '../../../shared/types';

/** Curated, airtime-aware seed shown before the user has any history. */
export const EMOJI_SEED: readonly string[] = ['👍', '✅', '📡', '🔋', '😂', '❤️'];

const HALF_LIFE_MS = 14 * 86_400_000; // recency weight halves every ~2 weeks

/** Frecency: usage count decayed by how long ago it was last used. */
export function scoreEmoji(entry: EmojiUse, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - entry.lastUsedMs);
  const recency = 2 ** (-ageMs / HALF_LIFE_MS); // 1 now → 0.5 at one half-life
  return entry.count * recency;
}

/** Top-N emoji by frecency, backfilled from `seed` (deduped) to always yield N. */
export function topEmojis(usage: EmojiUsage, nowMs: number, n: number, seed: readonly string[]): string[] {
  const ranked = Object.keys(usage).sort((a, b) => scoreEmoji(usage[b], nowMs) - scoreEmoji(usage[a], nowMs));
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

/** Immutably bump an emoji's count and last-used timestamp. */
export function recordUsage(usage: EmojiUsage, emoji: string, nowMs: number): EmojiUsage {
  const prev = usage[emoji];
  return { ...usage, [emoji]: { count: (prev?.count ?? 0) + 1, lastUsedMs: nowMs } };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/features/message-actions/frecency.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/features/message-actions/frecency.ts tests/unit/renderer/features/message-actions/frecency.test.ts
git commit -m "feat(message-actions): emoji frecency scoring + seed backfill"
```

---

### Task 2: Path formatting (`paths.ts`)

**Files:**
- Create: `src/renderer/features/message-actions/paths.ts`
- Test: `tests/unit/renderer/features/message-actions/paths.test.ts`

**Interfaces:**
- Consumes: `Message`, `MessagePath`, `MessageHop` from `src/shared/types`.
- Produces: `formatPathHeard`, `formatFirstPathHeard`, `formatAllPathsHeard`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/features/message-actions/paths.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Message, MessagePath } from '../../../../../src/shared/types';
import { formatAllPathsHeard, formatFirstPathHeard, formatPathHeard } from '../../../../../src/renderer/features/message-actions/paths';

const path = (ids: string[]): MessagePath => ({
  id: ids.join('-'),
  hashMode: 1,
  finalSnr: 0,
  hops: ids.map((shortId, i) => ({
    kind: i === 0 ? 'origin' : i === ids.length - 1 ? 'sink' : 'hop',
    shortId,
  })),
});

const msg = (paths: MessagePath[]): Message => ({
  id: 'm1',
  key: 'ch:x',
  body: 'hi',
  ts: 0,
  state: 'received',
  meta: paths.length ? { paths } : undefined,
});

describe('formatPathHeard', () => {
  it('joins hop shortIds with commas in order', () => {
    expect(formatPathHeard(path(['a1', 'b2', 'c3']))).toBe('a1,b2,c3');
  });
});

describe('formatFirstPathHeard', () => {
  it('formats the first path, or null when there are none', () => {
    expect(formatFirstPathHeard(msg([path(['a1', 'b2'])]))).toBe('a1,b2');
    expect(formatFirstPathHeard(msg([]))).toBeNull();
  });
});

describe('formatAllPathsHeard', () => {
  it('lists each path on its own line, or null when there are none', () => {
    expect(formatAllPathsHeard(msg([path(['a1', 'b2']), path(['a1', 'x9', 'b2'])]))).toBe('a1,b2\na1,x9,b2');
    expect(formatAllPathsHeard(msg([]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/features/message-actions/paths.test.ts`
Expected: FAIL — cannot resolve `paths` module.

- [ ] **Step 3: Implement `paths.ts`**

Create `src/renderer/features/message-actions/paths.ts`:
```ts
import type { Message, MessagePath } from '../../../shared/types';

/** One path as a comma-separated chain of hop prefix ids (origin→sink order). */
export function formatPathHeard(path: MessagePath): string {
  return path.hops.map((h) => h.shortId).join(',');
}

/** The first observed path, or null when the message has no path data. */
export function formatFirstPathHeard(message: Message): string | null {
  const first = message.meta?.paths?.[0];
  return first ? formatPathHeard(first) : null;
}

/** All observed paths, one comma-separated chain per line, or null when none. */
export function formatAllPathsHeard(message: Message): string | null {
  const paths = message.meta?.paths;
  if (!paths || paths.length === 0) return null;
  return paths.map(formatPathHeard).join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/features/message-actions/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/message-actions/paths.ts tests/unit/renderer/features/message-actions/paths.test.ts
git commit -m "feat(message-actions): path-heard copy formatting"
```

---

### Task 3: Store — `emojiUsage` + `recordEmojiUse` + account-global sync

**Files:**
- Modify: `src/shared/types.ts` (`UiState.emojiUsage`, `DEFAULT_UI_STATE`)
- Modify: `src/renderer/lib/store.ts` (`recordEmojiUse`, `applyUiState`)
- Test: `tests/unit/renderer/lib/emoji-usage-store.test.ts`

**Interfaces:**
- Consumes: `recordUsage` (Task 1).
- Produces: `useStore().recordEmojiUse(emoji)`; `s.ui.emojiUsage`.

- [ ] **Step 1: Add `emojiUsage` to `UiState` and its default**

In `src/shared/types.ts`, inside `export interface UiState { … }` add (after `recentKeys`):
```ts
  // Per-emoji usage counts driving quick-react auto-pinning. Account-global
  // (synced via applyUiState like pinned/recentKeys).
  emojiUsage: EmojiUsage;
```
And in `export const DEFAULT_UI_STATE: UiState = { … }` add:
```ts
  emojiUsage: {},
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/renderer/lib/emoji-usage-store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE } from '../../../../src/shared/types';

describe('recordEmojiUse', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE } });
  });

  it('increments usage count for the emoji', () => {
    useStore.getState().recordEmojiUse('📡');
    useStore.getState().recordEmojiUse('📡');
    expect(useStore.getState().ui.emojiUsage['📡'].count).toBe(2);
  });
});

describe('applyUiState merges emojiUsage (account-global)', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE } });
  });

  it('adopts a remote emojiUsage broadcast', () => {
    useStore.getState().applyUiState({
      ...DEFAULT_UI_STATE,
      emojiUsage: { '🔥': { count: 4, lastUsedMs: 123 } },
    });
    expect(useStore.getState().ui.emojiUsage['🔥'].count).toBe(4);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/emoji-usage-store.test.ts`
Expected: FAIL — `recordEmojiUse` is not a function / `emojiUsage` not merged.

- [ ] **Step 4: Add the action and the type to the store**

In `src/renderer/lib/store.ts`:

Add `recordEmojiUse` to the store interface (near `setDraft` in the mutators type block):
```ts
  recordEmojiUse: (emoji: string) => void;
```
Import the helper at the top with the other feature imports:
```ts
import { recordUsage } from '../features/message-actions/frecency';
```
Add the implementation next to `setDraft` (around line 842):
```ts
  recordEmojiUse: (emoji) =>
    set((s) => ({ ui: { ...s.ui, emojiUsage: recordUsage(s.ui.emojiUsage, emoji, Date.now()) } })),
```

- [ ] **Step 5: Add `emojiUsage` to the account-global merge**

In `applyUiState` (around [store.ts:710](../../../src/renderer/lib/store.ts)), extend both the idempotency check and the merged object:
```ts
      const same =
        shallowEqualRecord(s.ui.lastReadByKey, incoming.lastReadByKey) &&
        arraysEqual(s.ui.pinned, incoming.pinned) &&
        arraysEqual(s.ui.recentKeys, incoming.recentKeys) &&
        shallowEqualRecord(s.ui.emojiUsage, incoming.emojiUsage) &&
        s.ui.themePref === incoming.themePref;
      if (same) return {};
      return {
        ui: {
          ...s.ui,
          lastReadByKey: incoming.lastReadByKey,
          pinned: incoming.pinned,
          recentKeys: incoming.recentKeys,
          emojiUsage: incoming.emojiUsage,
          themePref: incoming.themePref,
        },
      };
```
Note: `shallowEqualRecord` compares one level; `emojiUsage` values are objects, so a same-reference check per key suffices for the debounce guard (a fresh `recordUsage` returns a new object, so identity differs — correct). If `shallowEqualRecord` proves too loose in practice, this only affects debounce, not correctness.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/emoji-usage-store.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck` → Expected: no errors.
```bash
git add src/shared/types.ts src/renderer/lib/store.ts tests/unit/renderer/lib/emoji-usage-store.test.ts
git commit -m "feat(message-actions): account-global emojiUsage store + recordEmojiUse"
```

---

### Task 4: Composer — `insertReaction` + reply-context chip

**Files:**
- Modify: `src/renderer/components/Composer.tsx`
- Test: `tests/component/composer-reactions.test.tsx`

**Interfaces:**
- Produces: `ComposerHandle.insertReaction(name, content)`; Composer props `replyingTo?: string | null`, `onClearReply?: () => void`.

- [ ] **Step 1: Write the failing DOM test**

Create `tests/component/composer-reactions.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, test } from 'vitest';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { DEFAULT_RADIO_SETTINGS } from '../../src/shared/types';

const baseProps = {
  onSend: async () => {},
  returnToSend: true,
  radioSettings: DEFAULT_RADIO_SETTINGS,
};

describe('Composer insertReaction', () => {
  test('inserts "@[name] emoji " into the empty field', () => {
    const ref = createRef<ComposerHandle>();
    render(<Composer ref={ref} {...baseProps} />);
    ref.current?.insertReaction('K5TH', '👍');
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    expect(ta.value).toBe('@[K5TH] 👍 ');
  });
});

describe('Composer reply-context chip', () => {
  test('shows the chip and fires onClearReply on clear', () => {
    let cleared = false;
    render(<Composer {...baseProps} replyingTo="K5TH" onClearReply={() => { cleared = true; }} />);
    expect(screen.getByText('K5TH')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Cancel reply'));
    expect(cleared).toBe(true);
  });
});
```
(Confirm `DEFAULT_RADIO_SETTINGS` is exported from `src/shared/types`; if the export name differs, use the actual default and keep the rest.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/composer-reactions.test.tsx`
Expected: FAIL — `insertReaction` undefined / no chip.

- [ ] **Step 3: Add `insertReaction` to the handle**

In `src/renderer/components/Composer.tsx`, extend the interface:
```ts
export interface ComposerHandle {
  insertMention: (name: string) => void;
  insertReaction: (name: string, content: string) => void;
}
```
Refactor the caret-insert logic in `useImperativeHandle` into a shared helper and add `insertReaction`:
```ts
  useImperativeHandle(ref, () => {
    const insertAtCaret = (token: string) => {
      const ta = textareaRef.current;
      setValue((prev) => {
        const start = ta?.selectionStart ?? prev.length;
        const end = ta?.selectionEnd ?? prev.length;
        const needsLeadingSpace = start > 0 && !/\s$/.test(prev.slice(0, start));
        const insertion = (needsLeadingSpace ? ' ' : '') + token;
        const next = prev.slice(0, start) + insertion + prev.slice(end);
        requestAnimationFrame(() => {
          const node = textareaRef.current;
          if (!node) return;
          const caret = start + insertion.length;
          node.focus();
          node.setSelectionRange(caret, caret);
        });
        return next;
      });
    };
    return {
      insertMention: (name: string) => insertAtCaret(`@[${name}] `),
      insertReaction: (name: string, content: string) => insertAtCaret(`@[${name}] ${content} `),
    };
  });
```

- [ ] **Step 4: Add the reply-context chip + props**

Add to `Props`:
```ts
  /** Sender name being replied to; shows the reply-context chip when set. */
  replyingTo?: string | null;
  onClearReply?: () => void;
```
Destructure `replyingTo` and `onClearReply` in the function signature. Render the chip just inside the outer wrapper, above the input row (`import { Reply, X } from 'lucide-react'`):
```tsx
      {replyingTo && (
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-cs-accent-soft/40 px-2 py-1 text-[11px] text-cs-accent">
            <Reply size={12} aria-hidden="true" />
            Replying to <span className="font-semibold">{replyingTo}</span>
          </span>
          <button
            type="button"
            onClick={onClearReply}
            aria-label="Cancel reply"
            className="text-cs-text-dim hover:text-cs-text"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/composer-reactions.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/renderer/components/Composer.tsx tests/component/composer-reactions.test.tsx
git commit -m "feat(message-actions): composer insertReaction + reply-context chip"
```

---

### Task 5: Dependencies + shadcn emoji-picker + emojibase-data build copy

**Files:**
- Create: `src/renderer/components/ui/emoji-picker.tsx` (via shadcn CLI)
- Modify: `vite.renderer.config.mts`
- Modify: `package.json` / `pnpm-lock.yaml`

**Interfaces:**
- Produces: `EmojiPicker`, `EmojiPickerSearch`, `EmojiPickerContent`, `EmojiPickerFooter` from `@/components/ui/emoji-picker`; emoji data served at `/emoji/en/{data,messages}.json`.

- [ ] **Step 1: Add dependencies**

```bash
pnpm add frimousse emojibase-data
pnpm add -D vite-plugin-static-copy
```

- [ ] **Step 2: Add the shadcn emoji-picker component**

```bash
pnpm dlx shadcn@latest add https://frimousse.liveblocks.io/r/emoji-picker.json
```
Expected: creates `src/renderer/components/ui/emoji-picker.tsx`. If the CLI cannot write (path/config), copy the component source from the frimousse docs into that file manually. Verify it exports `EmojiPicker`, `EmojiPickerSearch`, `EmojiPickerContent`, `EmojiPickerFooter`.

- [ ] **Step 3: Configure the emoji-data static copy**

In `vite.renderer.config.mts`, import and register the plugin so the two `en` files land at `emoji/en/*` in the renderer output (and are dev-served):
```ts
import { viteStaticCopy } from 'vite-plugin-static-copy';
// …
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/emojibase-data/en/data.json', dest: 'emoji/en' },
        { src: 'node_modules/emojibase-data/en/messages.json', dest: 'emoji/en' },
      ],
    }),
  ],
  // …unchanged…
});
```

- [ ] **Step 4: Verify build wiring**

Run: `pnpm typecheck` → Expected: no errors (component + plugin type-check).
Run: `pnpm start` briefly (or `pnpm exec vite build -c vite.renderer.config.mts` if a standalone build is convenient) and confirm `emoji/en/data.json` is requested/served with HTTP 200 (dev network tab). Note the exact URL frimousse requests; if it differs from `/emoji/en/data.json`, adjust `dest` and the `emojibaseUrl` in Task 6 to match.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vite.renderer.config.mts src/renderer/components/ui/emoji-picker.tsx
git commit -m "chore(message-actions): add frimousse emoji-picker + bundled emojibase-data"
```

---

### Task 6: `ReactionRow` + `EmojiPickerPopover`

**Files:**
- Create: `src/renderer/features/message-actions/ReactionRow.tsx`
- Create: `src/renderer/features/message-actions/EmojiPickerPopover.tsx`
- Test: `tests/component/emoji-reactions.test.tsx`

**Interfaces:**
- Consumes: `topEmojis`/`EMOJI_SEED` (Task 1); store `emojiUsage` (Task 3); `EmojiPicker*` (Task 5).
- Produces: `<ReactionRow onPick={(emoji) => void} />`; `<EmojiPickerPopover open onOpenChange onPick={(emoji)=>void}>{trigger}</EmojiPickerPopover>`.

- [ ] **Step 1: Write the failing DOM test**

Create `tests/component/emoji-reactions.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { ReactionRow } from '@/features/message-actions/ReactionRow';
import { useStore } from '@/lib/store';
import { DEFAULT_UI_STATE } from '../../src/shared/types';

describe('ReactionRow', () => {
  beforeEach(() => useStore.setState({ ui: { ...DEFAULT_UI_STATE } }));

  test('renders the seed emoji when there is no usage and reports picks', () => {
    let picked = '';
    render(<ReactionRow onPick={(e) => { picked = e; }} />);
    const thumb = screen.getByRole('button', { name: 'Reply with 👍' });
    fireEvent.click(thumb);
    expect(picked).toBe('👍');
  });

  test('promotes a frequently used emoji to the front', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, emojiUsage: { '🔥': { count: 9, lastUsedMs: Date.now() } } } });
    render(<ReactionRow onPick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Reply with 🔥' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/emoji-reactions.test.tsx`
Expected: FAIL — `ReactionRow` not found.

- [ ] **Step 3: Implement `ReactionRow`**

Create `src/renderer/features/message-actions/ReactionRow.tsx`:
```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { useStore } from '../../lib/store';
import { EMOJI_SEED, topEmojis } from './frecency';

interface Props {
  onPick: (emoji: string) => void;
  count?: number;
}

/** Inline one-click quick-react emoji, auto-pinned by frecency. */
export function ReactionRow({ onPick, count = 5 }: Props) {
  const usage = useStore((s) => s.ui.emojiUsage);
  const emojis = topEmojis(usage, Date.now(), count, EMOJI_SEED);
  return (
    <div className="flex items-center gap-0.5">
      {emojis.map((e) => (
        <Tooltip key={e}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onPick(e)}
              aria-label={`Reply with ${e}`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[16px] leading-none hover:bg-cs-bg-2"
            >
              {e}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Reply with {e}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement `EmojiPickerPopover`**

Create `src/renderer/features/message-actions/EmojiPickerPopover.tsx`:
```tsx
import type { ReactNode } from 'react';
import { EmojiPicker, EmojiPickerContent, EmojiPickerFooter, EmojiPickerSearch } from '../../components/ui/emoji-picker';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
  children: ReactNode; // the trigger button
}

// emojibase-data is served by the app's renderer host (Vite dev / Hono prod).
const EMOJIBASE_URL = new URL('emoji', window.location.origin).toString();

/** The "more emoji" picker popover (frimousse) — reports the chosen emoji. */
export function EmojiPickerPopover({ open, onOpenChange, onPick, children }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[258px] border-cs-border-strong bg-cs-bg-2 p-0">
        <EmojiPicker
          className="h-[300px]"
          emojibaseUrl={EMOJIBASE_URL}
          onEmojiSelect={({ emoji }: { emoji: string }) => {
            onPick(emoji);
            onOpenChange(false);
          }}
        >
          <EmojiPickerSearch placeholder="Search emoji…" />
          <EmojiPickerContent />
          <EmojiPickerFooter />
        </EmojiPicker>
      </PopoverContent>
    </Popover>
  );
}
```
Note: the `EmojiPicker` prop names (`emojibaseUrl`, `onEmojiSelect` shape) come from frimousse; if the shadcn wrapper renames them, adapt to the actual props from the generated `emoji-picker.tsx`. The frecency "Frequently used" behavior is provided by the inline `ReactionRow` in the bar; the picker itself is the full set.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/emoji-reactions.test.tsx`
Expected: PASS. (The picker popover isn't opened in this test — its data fetch doesn't run in jsdom.)

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/renderer/features/message-actions/ReactionRow.tsx src/renderer/features/message-actions/EmojiPickerPopover.tsx tests/component/emoji-reactions.test.tsx
git commit -m "feat(message-actions): quick-react row + emoji picker popover"
```

---

### Task 7: `MessageInfoPopover`

**Files:**
- Create: `src/renderer/features/message-actions/MessageInfoPopover.tsx`
- Test: `tests/component/message-info-popover.test.tsx`

**Interfaces:**
- Consumes: `Message` fields; `firstPathStats` ([lib/messagePath.ts](../../../src/renderer/lib/messagePath.ts)); `KeyValueRow` ([components/ui/KeyValueRow.tsx](../../../src/renderer/components/ui/KeyValueRow.tsx)).
- Produces: `<MessageInfoPopover message senderName open onOpenChange>{trigger}</MessageInfoPopover>`.

- [ ] **Step 1: Confirm the `KeyValueRow` API**

Read `src/renderer/components/ui/KeyValueRow.tsx` and note its exact props (label/value and whether a `mono` flag exists). Use its real prop names in Step 3 (the code below assumes `label`, `value`, optional `mono`; adjust if different).

- [ ] **Step 2: Write the failing DOM test**

Create `tests/component/message-info-popover.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageInfoPopover } from '@/features/message-actions/MessageInfoPopover';
import type { Message } from '../../src/shared/types';

const message: Message = {
  id: 'm1',
  key: 'ch:x',
  fromPublicKeyHex: 'a3f9c1d8',
  body: 'throughput cleaner',
  ts: 0,
  state: 'received',
  meta: { rssi: -72, snr: 8, paths: [{ id: 'p', hashMode: 1, finalSnr: 0, hops: [
    { kind: 'origin', shortId: 'a3', name: 'K5TH' },
    { kind: 'sink', shortId: 'me', name: 'My radio' },
  ] }] },
};

describe('MessageInfoPopover', () => {
  test('shows body, key and path when open', () => {
    render(
      <MessageInfoPopover message={message} senderName="K5TH" open onOpenChange={() => {}}>
        <button type="button">i</button>
      </MessageInfoPopover>,
    );
    expect(screen.getByText('throughput cleaner')).toBeTruthy();
    expect(screen.getByText('a3f9c1d8')).toBeTruthy();
    expect(screen.getByText('K5TH')).toBeTruthy(); // path hop name (or From)
  });
});
```

- [ ] **Step 3: Implement `MessageInfoPopover`**

Create `src/renderer/features/message-actions/MessageInfoPopover.tsx`:
```tsx
import type { ReactNode } from 'react';
import type { Message } from '../../../shared/types';
import { KeyValueRow } from '../../components/ui/KeyValueRow';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { firstPathStats } from '../../lib/messagePath';

interface Props {
  message: Message;
  senderName: string; // '' for self/unknown
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function MessageInfoPopover({ message, senderName, open, onOpenChange, children }: Props) {
  const isSelf = message.fromPublicKeyHex === undefined;
  const { hops } = firstPathStats(message);
  const pk = message.fromPublicKeyHex;
  const showPk = pk != null && pk !== 'unknown' && !pk.startsWith('name:');
  const rssi = message.meta?.rssi;
  const snr = message.meta?.snr;
  const pathHops = message.meta?.paths?.[0]?.hops ?? [];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[288px] border-cs-border-strong bg-cs-bg-2 p-3">
        <div className="mb-2.5 text-[10px] uppercase tracking-wider text-cs-text-dim">Message info</div>
        <div className="mb-3 rounded-md border border-cs-border bg-cs-bg-3 px-2.5 py-2 text-[12px] leading-relaxed text-cs-text">
          {message.body}
        </div>
        <div className="rounded-md border border-cs-border">
          <KeyValueRow label="From" value={isSelf ? 'You' : senderName || '(unknown)'} />
          {showPk && <KeyValueRow label="Public key" value={pk} mono />}
          {hops != null && <KeyValueRow label="Hops" value={String(hops)} mono />}
          {(rssi != null || snr != null) && (
            <KeyValueRow
              label="RSSI / SNR"
              value={`${rssi != null ? `${rssi} dBm` : '—'} · ${snr != null ? `${snr > 0 ? '+' : ''}${snr} dB` : '—'}`}
              mono
            />
          )}
          <KeyValueRow label="State" value={message.state} mono />
        </div>
        {pathHops.length > 0 && (
          <>
            <div className="mb-1.5 mt-3 text-[10px] uppercase tracking-wider text-cs-text-dim">Path</div>
            <div className="flex flex-col gap-1">
              {pathHops.map((h, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: hops can repeat shortId; index disambiguates
                  key={`${i}.${h.shortId}`}
                  className="flex items-center gap-2 rounded-md border border-cs-border bg-cs-bg-3 px-2 py-1.5"
                >
                  <span className="font-mono text-[10px] text-cs-text-dim">{i + 1}</span>
                  <span className="flex-1 truncate font-mono text-[11px] text-cs-text">{h.name ?? h.shortId}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/message-info-popover.test.tsx`
Expected: PASS. (If `KeyValueRow` doesn't accept `mono`, drop the flag per Step 1.)

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/renderer/features/message-actions/MessageInfoPopover.tsx tests/component/message-info-popover.test.tsx
git commit -m "feat(message-actions): message info popover"
```

---

### Task 8: `OverflowMenu` (merged `⋯`)

**Files:**
- Create: `src/renderer/features/message-actions/OverflowMenu.tsx`
- Test: `tests/component/overflow-menu.test.tsx`

**Interfaces:**
- Consumes: `formatFirstPathHeard`/`formatAllPathsHeard` (Task 2); `copyToClipboard` ([ContextMenu.tsx](../../../src/renderer/components/ContextMenu.tsx)); store `setActiveKey`; `notify` ([lib/notify](../../../src/renderer/lib/notify.ts)).
- Produces: `<OverflowMenu message open onOpenChange>{trigger}</OverflowMenu>`.

- [ ] **Step 1: Write the failing DOM test**

Create `tests/component/overflow-menu.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { OverflowMenu } from '@/features/message-actions/OverflowMenu';
import { useStore } from '@/lib/store';
import type { Message } from '../../src/shared/types';

const message: Message = {
  id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9c1d8', body: 'hi', ts: 0, state: 'received',
  meta: { paths: [{ id: 'p', hashMode: 1, finalSnr: 0, hops: [{ kind: 'origin', shortId: 'a3' }, { kind: 'sink', shortId: 'me' }] }] },
};

describe('OverflowMenu', () => {
  test('copies the public key', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OverflowMenu message={message} open onOpenChange={() => {}}><button type="button">⋯</button></OverflowMenu>);
    fireEvent.click(screen.getByText('Copy public key'));
    expect(writeText).toHaveBeenCalledWith('a3f9c1d8');
  });

  test('view contact routes to the sender', () => {
    render(<OverflowMenu message={message} open onOpenChange={() => {}}><button type="button">⋯</button></OverflowMenu>);
    fireEvent.click(screen.getByText('View contact'));
    expect(useStore.getState().ui.activeKey).toBe('c:a3f9c1d8');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/overflow-menu.test.tsx`
Expected: FAIL — `OverflowMenu` not found.

- [ ] **Step 3: Implement `OverflowMenu`**

Create `src/renderer/features/message-actions/OverflowMenu.tsx`:
```tsx
import { KeyRound, Radio, Trash2, User, Waypoints } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Message } from '../../../shared/types';
import { copyToClipboard } from '../../components/ContextMenu';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { formatAllPathsHeard, formatFirstPathHeard } from './paths';

interface Props {
  message: Message;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function OverflowMenu({ message, open, onOpenChange, children }: Props) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const pk = message.fromPublicKeyHex;
  const hasRealPk = pk != null && pk !== 'unknown' && !pk.startsWith('name:');
  const firstPath = formatFirstPathHeard(message);
  const allPaths = formatAllPathsHeard(message);

  const close = () => onOpenChange(false);
  const copy = (text: string, label: string) => copyToClipboard(text, () => notify.success(label));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[216px] border-cs-border-strong bg-cs-bg-2 p-1">
        {hasRealPk && (
          <MenuButton icon={<User size={15} />} label="View contact" onClick={() => { setActiveKey(`c:${pk}`); close(); }} />
        )}
        {hasRealPk && (
          <MenuButton icon={<KeyRound size={15} />} label="Copy public key" onClick={() => { copy(pk, 'Copied public key'); close(); }} />
        )}
        {firstPath && (
          <MenuButton icon={<Waypoints size={15} />} label="Copy first path heard" onClick={() => { copy(firstPath, 'Copied first path'); close(); }} />
        )}
        {allPaths && (
          <MenuButton icon={<Radio size={15} />} label="Copy all paths heard" onClick={() => { copy(allPaths, 'Copied all paths'); close(); }} />
        )}
        <div className="my-1 h-px bg-cs-border" />
        <MenuButton icon={<Trash2 size={15} />} label="Dismiss locally" destructive soon />
      </PopoverContent>
    </Popover>
  );
}

function MenuButton({
  icon, label, onClick, destructive, soon,
}: { icon: ReactNode; label: string; onClick?: () => void; destructive?: boolean; soon?: boolean }) {
  return (
    <button
      type="button"
      disabled={soon}
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
        soon ? 'cursor-default opacity-45' : 'hover:bg-cs-bg-3',
        destructive ? 'text-cs-danger hover:bg-cs-danger/10' : 'text-cs-text',
      ].join(' ')}
    >
      <span className={destructive ? 'text-cs-danger' : 'text-cs-text-muted'}>{icon}</span>
      <span className="flex-1">{label}</span>
      {soon && <span className="rounded border border-cs-border px-1 text-[9px] text-cs-text-dim">soon</span>}
    </button>
  );
}
```
(Confirm `notify.success` exists — used in `ChannelView.tsx`. If `notify` isn't importable from `../../lib/notify`, use the actual notify module path.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/overflow-menu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/renderer/features/message-actions/OverflowMenu.tsx tests/component/overflow-menu.test.tsx
git commit -m "feat(message-actions): merged overflow menu"
```

---

### Task 9: `MacroPanel` + macro chips ("soon")

**Files:**
- Create: `src/renderer/features/message-actions/quickBarData.ts`
- Create: `src/renderer/features/message-actions/MacroPanel.tsx`
- Test: `tests/component/macro-panel.test.tsx`

**Interfaces:**
- Produces: `SEED_MACROS`; `<MacroPanel open onOpenChange>{trigger}</MacroPanel>`; `<MacroChip label />` (exported from MacroPanel).

- [ ] **Step 1: Create the seed data**

Create `src/renderer/features/message-actions/quickBarData.ts`:
```ts
export interface Macro {
  label: string;
  text: string;
}

/** Roadmap seed macros — shown as a "soon" preview until the macros feature lands. */
export const SEED_MACROS: readonly Macro[] = [
  { label: 'ACK', text: 'ack ✓ heard you, thanks' },
  { label: 'Copy that', text: 'copy that' },
  { label: 'SNR?', text: 'what SNR are you seeing on your end?' },
  { label: 'Relaying', text: 'relaying now' },
  { label: 'QSY 910.5', text: 'QSY 910.5 MHz' },
  { label: 'ETA', text: 'ETA ~10 min' },
];
```

- [ ] **Step 2: Write the failing DOM test**

Create `tests/component/macro-panel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MacroChip, MacroPanel } from '@/features/message-actions/MacroPanel';

describe('macros are "soon" placeholders', () => {
  test('the panel lists seed macros with a soon badge', () => {
    render(<MacroPanel open onOpenChange={() => {}}><button type="button">macros</button></MacroPanel>);
    expect(screen.getByText('soon')).toBeTruthy();
    expect(screen.getByText('ACK')).toBeTruthy();
  });

  test('a macro chip renders disabled', () => {
    render(<MacroChip label="ACK" />);
    expect((screen.getByText('ACK').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 3: Implement `MacroPanel` + `MacroChip`**

Create `src/renderer/features/message-actions/MacroPanel.tsx`:
```tsx
import { Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { SEED_MACROS } from './quickBarData';

export function MacroChip({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex cursor-default items-center gap-1 rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1 text-[11px] font-medium text-cs-text-muted opacity-70"
    >
      <span className="text-cs-accent"><Zap size={11} aria-hidden="true" /></span>
      {label}
    </button>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function MacroPanel({ open, onOpenChange, children }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[244px] border-cs-border-strong bg-cs-bg-2 p-1.5">
        <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Reply macros</span>
          <span className="rounded border border-cs-border px-1 text-[9px] text-cs-text-dim">soon</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {SEED_MACROS.map((mac) => (
            <div key={mac.label} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 opacity-60">
              <span className="text-cs-accent"><Zap size={14} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-cs-text">{mac.label}</span>
                <span className="block truncate font-mono text-[11px] text-cs-text-dim">{mac.text}</span>
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/macro-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/message-actions/quickBarData.ts src/renderer/features/message-actions/MacroPanel.tsx tests/component/macro-panel.test.tsx
git commit -m "feat(message-actions): soon-state macro chips + panel"
```

---

### Task 10: `MessageQuickBar` (assemble the pill)

**Files:**
- Create: `src/renderer/features/message-actions/MessageQuickBar.tsx`
- Test: `tests/component/message-quick-bar.test.tsx`

**Interfaces:**
- Consumes: all of Tasks 6–9; store `recordEmojiUse`; `copyToClipboard`; `notify`.
- Produces: `<MessageQuickBar message isSelf senderName onReact onReply />`.

- [ ] **Step 1: Write the failing DOM test**

Create `tests/component/message-quick-bar.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MessageQuickBar } from '@/features/message-actions/MessageQuickBar';
import { useStore } from '@/lib/store';
import { DEFAULT_UI_STATE, type Message } from '../../src/shared/types';

const other: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };
const mine: Message = { id: 'm2', key: 'ch:x', body: 'yo', ts: 0, state: 'sent' };

describe('MessageQuickBar', () => {
  beforeEach(() => useStore.setState({ ui: { ...DEFAULT_UI_STATE } }));

  test('others: quick-react records usage and calls onReact', () => {
    const onReact = vi.fn();
    render(<MessageQuickBar message={other} isSelf={false} senderName="K5TH" onReact={onReact} onReply={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply with 👍' }));
    expect(onReact).toHaveBeenCalledWith('K5TH', '👍');
    expect(useStore.getState().ui.emojiUsage['👍'].count).toBe(1);
  });

  test('others: Reply calls onReply', () => {
    const onReply = vi.fn();
    render(<MessageQuickBar message={other} isSelf={false} senderName="K5TH" onReact={() => {}} onReply={onReply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith('K5TH');
  });

  test('self: shows Copy / Info / Delete and no Reply', () => {
    render(<MessageQuickBar message={mine} isSelf senderName="" onReact={() => {}} onReply={() => {}} />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/message-quick-bar.test.tsx`
Expected: FAIL — `MessageQuickBar` not found.

- [ ] **Step 3: Implement `MessageQuickBar`**

Create `src/renderer/features/message-actions/MessageQuickBar.tsx`:
```tsx
import { Copy, Info, MoreHorizontal, Plus, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Message } from '../../../shared/types';
import { copyToClipboard } from '../../components/ContextMenu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { EmojiPickerPopover } from './EmojiPickerPopover';
import { MacroChip, MacroPanel } from './MacroPanel';
import { MessageInfoPopover } from './MessageInfoPopover';
import { OverflowMenu } from './OverflowMenu';
import { ReactionRow } from './ReactionRow';
import { SEED_MACROS } from './quickBarData';

type PopKey = 'emoji' | 'macro' | 'info' | 'more' | null;

interface Props {
  message: Message;
  isSelf: boolean;
  senderName: string;
  onReact: (name: string, emoji: string) => void;
  onReply: (name: string) => void;
}

/** Discord-style hover action pill anchored to the top-right of a message row. */
export function MessageQuickBar({ message, isSelf, senderName, onReact, onReply }: Props) {
  const [open, setOpen] = useState<PopKey>(null);
  const recordEmojiUse = useStore((s) => s.recordEmojiUse);
  const P = (key: Exclude<PopKey, null>) => ({ open: open === key, onOpenChange: (o: boolean) => setOpen(o ? key : null) });

  const pick = (emoji: string) => {
    recordEmojiUse(emoji);
    onReact(senderName, emoji);
  };
  const copyText = () => copyToClipboard(message.body, () => notify.success('Copied message text'));

  return (
    <div
      data-open={open != null}
      className="absolute right-3 -top-3.5 z-20 flex items-center opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:opacity-100"
    >
      <div
        className="flex items-center gap-1 rounded-lg border border-cs-border-strong bg-cs-bg-3 px-1.5 py-1"
        style={{ boxShadow: '0 10px 26px rgba(0,0,0,0.5)' }}
      >
        {!isSelf ? (
          <>
            <ReactionRow onPick={pick} />
            <EmojiPickerPopover {...P('emoji')} onPick={pick}>
              <button type="button" aria-label="More emoji" className="flex h-6 w-6 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text">
                <Plus size={14} aria-hidden="true" />
              </button>
            </EmojiPickerPopover>
            <span className="mx-1 h-6 w-px bg-cs-border" />
            <button
              type="button"
              aria-label="Reply"
              onClick={() => onReply(senderName)}
              className="flex h-7 items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-2 px-2.5 text-[12px] text-cs-text-muted hover:text-cs-text"
            >
              <Reply size={14} aria-hidden="true" /> Reply
            </button>
            <div className="flex items-center gap-1 pl-1">
              {SEED_MACROS.slice(0, 2).map((m) => (
                <MacroChip key={m.label} label={m.label} />
              ))}
              <MacroPanel {...P('macro')}>
                <button type="button" aria-label="All macros" className="flex h-6 w-6 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text">
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
              </MacroPanel>
            </div>
            <span className="mx-1 h-6 w-px bg-cs-border" />
            <IconBtn label="Copy text" onClick={copyText}><Copy size={16} aria-hidden="true" /></IconBtn>
            <OverflowMenu message={message} {...P('more')}>
              <button type="button" aria-label="More" className="flex h-8 w-8 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text">
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            </OverflowMenu>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label="Copy"
              onClick={copyText}
              className="flex h-7 items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-2 px-2.5 text-[12px] text-cs-text-muted hover:text-cs-text"
            >
              <Copy size={14} aria-hidden="true" /> Copy
            </button>
            <MessageInfoPopover message={message} senderName={senderName} {...P('info')}>
              <button type="button" aria-label="Info" className="flex h-8 w-8 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text">
                <Info size={16} aria-hidden="true" />
              </button>
            </MessageInfoPopover>
            <IconBtn label="Delete" soon className="text-cs-danger hover:bg-cs-danger/10 hover:text-cs-danger"><Trash2 size={16} aria-hidden="true" /></IconBtn>
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label, onClick, soon, className, children,
}: { label: string; onClick?: () => void; soon?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={soon}
          onClick={onClick}
          className={['flex h-8 w-8 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text', soon ? 'opacity-45' : '', className ?? ''].join(' ')}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/message-quick-bar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/renderer/features/message-actions/MessageQuickBar.tsx tests/component/message-quick-bar.test.tsx
git commit -m "feat(message-actions): assemble the quick bar pill (author-aware)"
```

---

### Task 11: Mount in `MessageItem` + thread `onReact`; retire the standalone reply button

**Files:**
- Modify: `src/renderer/components/MessageItem.tsx`
- Modify: `src/renderer/components/MessageRow.tsx`
- Modify: `src/renderer/components/MessageList.tsx`
- Test: `tests/component/message-item-quick-bar.test.tsx`

**Interfaces:**
- Consumes: `MessageQuickBar` (Task 10).
- Produces: `MessageItem`/`MessageRow` prop `onReact?: (name, emoji) => void`; `RowContext.onReact`.

- [ ] **Step 1: Write the failing DOM test**

Create `tests/component/message-item-quick-bar.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import type { Message } from '../../src/shared/types';

const message: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };

describe('MessageItem quick bar', () => {
  test('interactive rows render the quick bar (Reply present for others)', () => {
    render(
      <MessageItem
        message={message}
        isSelf={false}
        style="rich"
        senderName="K5TH"
        timeFormat="24h"
        onSelect={() => {}}
        onReply={() => {}}
        onReact={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });

  test('non-interactive previews (no onSelect) render no quick bar', () => {
    render(<MessageItem message={message} isSelf={false} style="rich" senderName="K5TH" timeFormat="24h" />);
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});
```
(Confirm `timeFormat="24h"` matches the `TimeFormatPref` union; use a valid member.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/message-item-quick-bar.test.tsx`
Expected: FAIL — no Reply button (standalone button was rich+hover only and there's now a bar to add).

- [ ] **Step 3: Update `MessageItem`**

In `src/renderer/components/MessageItem.tsx`:
1. Add to `MessageItemProps`:
```ts
  onReact?: (name: string, emoji: string) => void;
```
2. Destructure `onReact` in the function params.
3. Import the bar: `import { MessageQuickBar } from '../features/message-actions/MessageQuickBar';`
4. **Remove** the standalone reply `<button>` block (the `canReply && (...)` button at lines ~101-114) and the now-unused `Reply` import if nothing else uses it.
5. Make the outer container `relative` and render the bar for interactive rows. Change:
```tsx
    <div
      data-testid={interactive ? 'message-row' : undefined}
      className="group relative px-3 py-0.5"
      data-flash={flash ? 'true' : undefined}
    >
```
and add, immediately inside that outer `<div>` (before the interactive/static branch):
```tsx
      {interactive && onReact && (
        <MessageQuickBar
          message={message}
          isSelf={isSelf}
          senderName={senderName}
          onReact={onReact}
          onReply={(name) => onReply?.(name)}
        />
      )}
```
Keep the existing `canReply` logic only if still referenced; otherwise remove it with the button.

- [ ] **Step 4: Thread `onReact` through `MessageRow` and `MessageList`**

In `src/renderer/components/MessageRow.tsx`, add `onReact?: (name: string, emoji: string) => void;` to `Props`, destructure it, and pass `onReact={onReact}` to `<MessageItem>`.

In `src/renderer/components/MessageList.tsx`:
- Add to `RowContext`: `onReact?: (name: string, emoji: string) => void;`
- Add `onReact?: (name: string, emoji: string) => void;` to `Props` and destructure it.
- In `ItemRow`, pass `onReact={context.onReact}` to `<MessageRow>`.
- In the `context` object, add `onReact,`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project dom tests/component/message-item-quick-bar.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/renderer/components/MessageItem.tsx src/renderer/components/MessageRow.tsx src/renderer/components/MessageList.tsx tests/component/message-item-quick-bar.test.tsx
git commit -m "feat(message-actions): mount quick bar in message rows; retire standalone reply"
```

---

### Task 12: Wire `ChannelView` / `DMView` (`replyingTo` + `onReact`)

**Files:**
- Modify: `src/renderer/panels/ChannelView.tsx`
- Modify: `src/renderer/panels/DMView.tsx`

**Interfaces:**
- Consumes: `MessageList.onReact` (Task 11); `Composer.insertReaction`/`replyingTo`/`onClearReply` (Task 4).

- [ ] **Step 1: Add reply state + handlers in `ChannelView`**

In `src/renderer/panels/ChannelView.tsx`:
- Add state: `const [replyingTo, setReplyingTo] = useState<string | null>(null);`
- Wrap send so it clears the chip:
```tsx
  const handleReply = (name: string) => { setReplyingTo(name); composerRef.current?.insertMention(name); };
  const handleReact = (name: string, emoji: string) => { setReplyingTo(name); composerRef.current?.insertReaction(name, emoji); };
```
- On the `<MessageList>`: change `onReply={handleReply}` and add `onReact={handleReact}`.
- On the `<Composer>`: add `replyingTo={replyingTo}` and `onClearReply={() => setReplyingTo(null)}`.
- Clear on send: in `onSend`, after a successful `api.sendMessage`, call `setReplyingTo(null)` (add it in the existing `onSend` callback body).

- [ ] **Step 2: Mirror the same wiring in `DMView`**

Apply the identical changes in `src/renderer/panels/DMView.tsx` (it has the same `composerRef` + `onReply={(name) => composerRef.current?.insertMention(name)}` shape at [DMView.tsx:105](../../../src/renderer/panels/DMView.tsx)).

- [ ] **Step 3: Typecheck + full test run**

Run: `pnpm typecheck` → Expected: no errors.
Run: `pnpm test` → Expected: all projects green (unit + integration + dom), including the new suites.

- [ ] **Step 4: Lint**

Run: `pnpm exec biome check src tests` → Expected: no errors (fix any import-order/format issues Biome flags).

- [ ] **Step 5: Manual verification (real app)**

Run the app (`pnpm start`), open a channel with received + own messages, and confirm:
- Hovering a message shows the pill top-right; others show reactions/Reply/macros/copy/⋯; own shows Copy/Info/Delete.
- Clicking a quick-react inserts `@[sender] 😀 ` into the composer and shows the reply chip; Enter sends it.
- The emoji picker opens, searches, and a pick inserts + closes; repeated use re-orders the quick-react row.
- Overflow copies work (public key, first/all paths); View contact navigates; Dismiss/macros/Delete are "soon"/non-interactive.
- Info popover shows the right fields + PATH.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/ChannelView.tsx src/renderer/panels/DMView.tsx
git commit -m "feat(message-actions): wire quick-bar reactions + reply chip into channel/DM views"
```

---

## Self-Review

**Spec coverage:**
- Hover bar + author-aware contents → Tasks 10, 11. ✓
- Emoji→`@[sender]` insert + no wire protocol → Tasks 4, 10, 12. ✓
- Custom frimousse picker + emojibase-data (no `resources/`) → Tasks 5, 6. ✓
- Frecency auto-pin (seed `👍✅📡🔋😂`) + account-global storage → Tasks 1, 3, 6. ✓
- Reply-context chip → Tasks 4, 12. ✓
- Info popover (all messages) → Task 7. ✓
- Merged overflow (view contact / copy key / copy first+all paths / dismiss "soon") → Task 8. ✓
- Macros + Delete as "soon" placeholders → Tasks 9, 10. ✓
- Retire standalone reply button → Task 11. ✓
- Keep existing rows, 132-char limit → Global Constraints; rows untouched. ✓
- Path-copy comma/newline format → Task 2. ✓

**Placeholder scan:** No "TBD"/"handle appropriately" left; every code step has concrete code. Steps that depend on library/CLI output (Task 5 shadcn add; Task 7 `KeyValueRow` props; Task 8 `notify` path; Task 4 `DEFAULT_RADIO_SETTINGS`) call out the one thing to confirm and how to adapt.

**Type consistency:** `EmojiUsage`/`EmojiUse` (shared) used by `frecency.ts`, store, `ReactionRow`. `recordEmojiUse(emoji)` consistent across store/tests/QuickBar. `onReact(name, emoji)` consistent across MessageQuickBar → MessageItem → MessageRow → MessageList.RowContext → ChannelView/DMView. `insertReaction(name, content)` consistent between Composer and callers. Popover leaf props (`open`, `onOpenChange`, `children` trigger, `onPick`) consistent across EmojiPickerPopover/OverflowMenu/MacroPanel/MessageInfoPopover.

## Execution notes

- Tasks 1–4 are pure/near-pure and land independently. Tasks 6–9 are independent leaf components (parallelizable). Task 10 depends on 6–9; Task 11 on 10; Task 12 on 4 + 11.
- If frimousse's actual data URL or component prop names differ from the assumptions in Tasks 5–6, adjust `dest`/`emojibaseUrl`/prop names to match — the network-tab check in Task 5 Step 4 is the source of truth.
