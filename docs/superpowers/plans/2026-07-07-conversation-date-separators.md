# Conversation Date Separators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a Discord-style horizontal rule between messages from different calendar days in a conversation, reusing the unread delimiter refactored into a shared component.

**Architecture:** The message list (`src/renderer/components/MessageList.tsx`) is virtualized via `@virtuoso.dev/message-list`; rows are a discriminated union and the unread divider is already one item kind. We add a `date` item kind inserted at day transitions, refactor the inline `UnreadDivider` into a shared `MessageDivider` component, and move the pure item-building logic into `messageListItems.ts` so it is unit-testable. Incremental append/prepend fast-paths get seeded builders so separators survive live updates.

**Tech Stack:** TypeScript, React, Tailwind v4 (Field Console CSS-variable palette), `@virtuoso.dev/message-list`, Vitest (+ @testing-library/react for the `dom` project), Biome.

## Global Constraints

- **Color:** date separator uses `text-cs-text-muted` (label) + `bg-cs-border` (rule lines). Unread delimiter keeps `text-cs-accent` (label) + `bg-cs-accent/40` (lines).
- **Date label:** always absolute — `toLocaleDateString(undefined, { dateStyle: 'long' })` (e.g. "July 2, 2026"). No "Today"/"Yesterday".
- **Behavior:** static inline row (scrolls with messages). Not sticky.
- **Separator rule:** a date separator appears only immediately above a real message whose local calendar day differs from the previous message's, labeled with that (newer) message's day. Never above `messages[0]`. Never two separators consecutively. Multi-day gaps produce exactly one separator (the newer date).
- **Ordering:** when a day transition coincides with the unread cutoff, order is date → "New" → message.
- **Timezone:** all day math uses the local timezone (consistent with the rest of `time.ts`).
- **No consumer changes:** `ChannelView`, `DMView`, `repeater-admin/MessagesTab` are untouched.
- **Test scoping:** run Biome as `pnpm exec biome check src tests` (repo-wide `pnpm lint` trips on prebuilt `dist/out` artifacts). Git `add`/`commit` in this worktree may require the sandbox disabled.

---

### Task 1: Date helpers (`dayKey`, `fmtDate`)

**Files:**
- Modify: `src/renderer/lib/time.ts` (append two functions)
- Test: `tests/unit/renderer/lib/time.test.ts` (append two `describe` blocks)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `dayKey(ts: number): number` — local-calendar day id as `YYYYMMDD` (e.g. `20260702`).
  - `fmtDate(ts: number): string` — localized long date.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/renderer/lib/time.test.ts`. Update the existing import line to also import the new functions:

```ts
import { dayKey, fmtDate, fmtRelative } from '../../../../src/renderer/lib/time';
```

Then append:

```ts
// Dates are built with the local-time Date constructor and dayKey reads local
// components, so these assertions are stable regardless of the runner's TZ.
describe('dayKey', () => {
  it('is equal for two times on the same local day', () => {
    const morning = new Date(2026, 6, 2, 8, 0, 0).getTime();
    const evening = new Date(2026, 6, 2, 23, 59, 0).getTime();
    expect(dayKey(morning)).toBe(dayKey(evening));
  });

  it('differs across a local-day boundary', () => {
    const beforeMidnight = new Date(2026, 6, 2, 23, 59, 0).getTime();
    const afterMidnight = new Date(2026, 6, 3, 0, 1, 0).getTime();
    expect(dayKey(beforeMidnight)).not.toBe(dayKey(afterMidnight));
  });

  it('encodes the calendar date as YYYYMMDD', () => {
    expect(dayKey(new Date(2026, 6, 2, 12, 0, 0).getTime())).toBe(20260702);
  });
});

describe('fmtDate', () => {
  it('formats a timestamp as a non-empty date string containing the year', () => {
    const out = fmtDate(new Date(2026, 6, 2, 12, 0, 0).getTime());
    expect(typeof out).toBe('string');
    expect(out).toContain('2026');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/time.test.ts`
Expected: FAIL — `dayKey` / `fmtDate` are not exported (compile/import error).

- [ ] **Step 3: Implement the helpers**

Append to `src/renderer/lib/time.ts`:

```ts
// Local-calendar day identifier (YYYYMMDD) for cheap same-day comparison.
// Uses the local timezone, consistent with the other formatters here.
export function dayKey(ts: number): number {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// Full localized date with no time — used by the conversation date separators.
// Date-only, so the 12/24-hour preference does not apply.
export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'long' });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/time.test.ts`
Expected: PASS (all `fmtRelative`, `dayKey`, `fmtDate` tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/time.ts tests/unit/renderer/lib/time.test.ts
git commit -m "feat: add dayKey and fmtDate time helpers"
```

---

### Task 2: Shared `MessageDivider` component

**Files:**
- Create: `src/renderer/components/MessageDivider.tsx`
- Test: `tests/component/message-divider.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `MessageDivider({ label: string, tone: 'accent' | 'date' })` — a labeled horizontal rule. `accent` = unread palette, `date` = muted-warm palette.

- [ ] **Step 1: Write the failing test**

Create `tests/component/message-divider.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageDivider } from '@/components/MessageDivider';

describe('MessageDivider', () => {
  test('renders the label text', () => {
    render(<MessageDivider label="New" tone="accent" />);
    expect(screen.getByText('New')).not.toBeNull();
  });

  test('accent tone uses the unread accent palette', () => {
    const { container } = render(<MessageDivider label="New" tone="accent" />);
    expect(container.querySelector('.text-cs-accent')).not.toBeNull();
    expect(container.querySelector('.bg-cs-accent\\/40')).not.toBeNull();
  });

  test('date tone uses the muted-warm palette and not the accent one', () => {
    const { container } = render(<MessageDivider label="July 2, 2026" tone="date" />);
    expect(screen.getByText('July 2, 2026')).not.toBeNull();
    expect(container.querySelector('.text-cs-text-muted')).not.toBeNull();
    expect(container.querySelector('.bg-cs-border')).not.toBeNull();
    expect(container.querySelector('.text-cs-accent')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/message-divider.test.tsx`
Expected: FAIL — cannot resolve `@/components/MessageDivider`.

- [ ] **Step 3: Implement the component**

Create `src/renderer/components/MessageDivider.tsx`:

```tsx
type DividerTone = 'accent' | 'date';

// Tone → { label text color, rule-line background }. Centralizes the two
// palettes so the unread delimiter and the date separator share one layout.
const TONE_CLASSES: Record<DividerTone, { label: string; line: string }> = {
  accent: { label: 'text-cs-accent', line: 'bg-cs-accent/40' },
  date: { label: 'text-cs-text-muted', line: 'bg-cs-border' },
};

// A labeled horizontal rule: two thin lines flanking a centered, uppercase,
// letter-spaced label. Used for the unread "New" delimiter and per-day date
// separators in the message list.
export function MessageDivider({ label, tone }: { label: string; tone: DividerTone }) {
  const c = TONE_CLASSES[tone];
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider ${c.label}`}>
      <span className={`h-px flex-1 ${c.line}`} />
      <span>{label}</span>
      <span className={`h-px flex-1 ${c.line}`} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project dom tests/component/message-divider.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/MessageDivider.tsx tests/component/message-divider.test.tsx
git commit -m "feat: add shared MessageDivider component with accent/date tones"
```

---

### Task 3: Item model + builders (`messageListItems.ts`)

**Files:**
- Create: `src/renderer/components/messageListItems.ts`
- Test: `tests/unit/renderer/components/messageListItems.test.ts`

**Interfaces:**
- Consumes: `dayKey` from `../lib/time`; `Message` from `../../shared/types`.
- Produces:
  - Types `DateItem`, `DividerItem`, `MessageItem`, `Item`.
  - `computeFirstUnreadIdx(messages: Message[], cutoff: number): number`
  - `buildItems(messages: Message[], firstUnreadIdx: number): Item[]`
  - `buildAppended(newMsgs: Message[], prevLastMsg: Message): Item[]`
  - `buildPrepended(olderMsgs: Message[], existingHeadMsg: Message): Item[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/renderer/components/messageListItems.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Message } from '../../../../src/shared/types';
import {
  buildAppended,
  buildItems,
  buildPrepended,
  computeFirstUnreadIdx,
} from '../../../../src/renderer/components/messageListItems';

const JUL2 = new Date(2026, 6, 2, 12, 0, 0).getTime();
const JUL2_LATER = new Date(2026, 6, 2, 18, 0, 0).getTime();
const JUL4 = new Date(2026, 6, 4, 9, 0, 0).getTime();
const JUL6 = new Date(2026, 6, 6, 9, 0, 0).getTime();

function msg(id: string, ts: number, over: Partial<Message> = {}): Message {
  return { id, key: 'k', body: id, ts, state: 'received', fromPublicKeyHex: 'aa', ...over };
}

describe('buildItems', () => {
  it('emits no date separator for a single-day conversation', () => {
    const items = buildItems([msg('a', JUL2), msg('b', JUL2_LATER)], -1);
    expect(items.map((i) => i.kind)).toEqual(['msg', 'msg']);
  });

  it('never emits a separator above the first message', () => {
    const items = buildItems([msg('a', JUL2)], -1);
    expect(items.map((i) => i.kind)).toEqual(['msg']);
  });

  it('inserts one date separator at a day transition, labeled with the newer day', () => {
    const items = buildItems([msg('a', JUL2), msg('b', JUL4)], -1);
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'msg']);
    const date = items[1];
    expect(date.kind === 'date' && date.ts).toBe(JUL4);
  });

  it('emits exactly one separator across a multi-day gap (newest date)', () => {
    const items = buildItems([msg('a', JUL2), msg('b', JUL6)], -1);
    const dates = items.filter((i) => i.kind === 'date');
    expect(dates).toHaveLength(1);
    expect(dates[0].kind === 'date' && dates[0].ts).toBe(JUL6);
  });

  it('orders date before the unread divider when they coincide', () => {
    // firstUnreadIdx = 1 (msg b), which is also a day transition.
    const items = buildItems([msg('a', JUL2), msg('b', JUL4)], 1);
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'divider', 'msg']);
  });
});

describe('computeFirstUnreadIdx', () => {
  it('returns -1 when cutoff is 0', () => {
    expect(computeFirstUnreadIdx([msg('a', JUL2)], 0)).toBe(-1);
  });

  it('finds the first received message newer than the cutoff', () => {
    const msgs = [msg('a', JUL2), msg('b', JUL4)];
    expect(computeFirstUnreadIdx(msgs, JUL2)).toBe(1);
  });

  it('skips self-sent messages (no fromPublicKeyHex)', () => {
    const msgs = [msg('a', JUL2), msg('b', JUL4, { fromPublicKeyHex: undefined })];
    expect(computeFirstUnreadIdx(msgs, JUL2)).toBe(-1);
  });
});

describe('buildAppended', () => {
  it('emits no date separator when the append stays on the same day', () => {
    const items = buildAppended([msg('b', JUL2_LATER)], msg('a', JUL2));
    expect(items.map((i) => i.kind)).toEqual(['msg']);
  });

  it('emits a date separator when the first appended message starts a new day', () => {
    const items = buildAppended([msg('b', JUL4)], msg('a', JUL2));
    expect(items.map((i) => i.kind)).toEqual(['date', 'msg']);
    expect(items[0].kind === 'date' && items[0].ts).toBe(JUL4);
  });

  it('emits separators at internal transitions within the appended batch', () => {
    const items = buildAppended([msg('b', JUL2_LATER), msg('c', JUL4)], msg('a', JUL2));
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'msg']);
  });
});

describe('buildPrepended', () => {
  it('emits no boundary separator when older batch shares the head day', () => {
    const items = buildPrepended([msg('a', JUL2)], msg('b', JUL2_LATER));
    expect(items.map((i) => i.kind)).toEqual(['msg']);
  });

  it('emits a boundary separator (head day) when days differ', () => {
    const items = buildPrepended([msg('a', JUL2)], msg('b', JUL4));
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date']);
    const date = items[1];
    expect(date.kind === 'date' && date.ts).toBe(JUL4);
  });

  it('never emits a separator above the batch topmost message', () => {
    const items = buildPrepended([msg('a', JUL2), msg('b', JUL4)], msg('c', JUL4));
    // internal Jul2->Jul4 transition only; no leading separator, no boundary (Jul4==Jul4).
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'msg']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/components/messageListItems.test.ts`
Expected: FAIL — cannot resolve `messageListItems`.

- [ ] **Step 3: Implement the module**

Create `src/renderer/components/messageListItems.ts`:

```ts
import type { Message } from '../../shared/types';
import { dayKey } from '../lib/time';

export type DateItem = { kind: 'date'; id: string; ts: number };
export type DividerItem = { kind: 'divider'; id: '__unread__' };
export type MessageItem = { kind: 'msg'; m: Message };
export type Item = DateItem | DividerItem | MessageItem;

const UNREAD_DIVIDER: DividerItem = { kind: 'divider', id: '__unread__' };

function dateItem(ts: number): DateItem {
  return { kind: 'date', id: `date-${dayKey(ts)}`, ts };
}

// Index of the first message newer than the unread cutoff that wasn't sent by
// the owner (self-sent messages never count as "unread"). -1 when none.
export function computeFirstUnreadIdx(messages: Message[], cutoff: number): number {
  if (!cutoff) return -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].ts > cutoff && messages[i].fromPublicKeyHex !== undefined) return i;
  }
  return -1;
}

// Full rebuild. Inserts a date separator before any message whose local
// calendar day differs from the previous message's (labeled with the newer
// day), and the unread divider before firstUnreadIdx. When both land at the
// same index the order is date -> unread -> message. No separator precedes the
// first message.
export function buildItems(messages: Message[], firstUnreadIdx: number): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i > 0 && dayKey(messages[i].ts) !== dayKey(messages[i - 1].ts)) {
      items.push(dateItem(messages[i].ts));
    }
    if (i === firstUnreadIdx) items.push(UNREAD_DIVIDER);
    items.push({ kind: 'msg', m: messages[i] });
  }
  return items;
}

// Tail-append fast-path. Emits date separators within `newMsgs`, seeding the
// "previous day" from the last already-rendered message so the first appended
// message only gets a separator when it starts a new day. The unread divider is
// never produced here — it stays frozen at its original position above these.
export function buildAppended(newMsgs: Message[], prevLastMsg: Message): Item[] {
  const items: Item[] = [];
  let prevTs = prevLastMsg.ts;
  for (const m of newMsgs) {
    if (dayKey(m.ts) !== dayKey(prevTs)) items.push(dateItem(m.ts));
    items.push({ kind: 'msg', m });
    prevTs = m.ts;
  }
  return items;
}

// Head-prepend (load-older) fast-path. Emits date separators at day
// transitions *within* `olderMsgs` (never above the batch's new topmost
// message), then a single boundary separator between the last older message and
// the existing head iff their days differ (labeled with the head's day). Keeps
// the invariant that the current topmost message never has a separator above
// it, so prepend never produces a duplicate.
export function buildPrepended(olderMsgs: Message[], existingHeadMsg: Message): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < olderMsgs.length; i++) {
    if (i > 0 && dayKey(olderMsgs[i].ts) !== dayKey(olderMsgs[i - 1].ts)) {
      items.push(dateItem(olderMsgs[i].ts));
    }
    items.push({ kind: 'msg', m: olderMsgs[i] });
  }
  const lastOlder = olderMsgs[olderMsgs.length - 1];
  if (lastOlder && dayKey(existingHeadMsg.ts) !== dayKey(lastOlder.ts)) {
    items.push(dateItem(existingHeadMsg.ts));
  }
  return items;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/components/messageListItems.test.ts`
Expected: PASS (all `buildItems`, `computeFirstUnreadIdx`, `buildAppended`, `buildPrepended` tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/messageListItems.ts tests/unit/renderer/components/messageListItems.test.ts
git commit -m "feat: add message list item builders with day separators"
```

---

### Task 4: Wire `MessageList.tsx` to the shared component + builders

**Files:**
- Modify: `src/renderer/components/MessageList.tsx`

**Interfaces:**
- Consumes: `MessageDivider` (Task 2); `Item`, `buildItems`, `buildAppended`, `buildPrepended`, `computeFirstUnreadIdx` (Task 3); `fmtDate` (Task 1).
- Produces: no new exports; renders `date` rows and keeps all existing behavior.

This task is a refactor/wiring change verified by typecheck + the existing and new test suites (the virtualized list can't be meaningfully mounted in jsdom). There is no new failing unit test; the gate is a green typecheck, lint, and full suite.

- [ ] **Step 1: Update imports**

In `src/renderer/components/MessageList.tsx`, add these imports next to the existing component imports (near lines 14-16):

```tsx
import { MessageDivider } from './MessageDivider';
import {
  type Item,
  buildAppended,
  buildItems,
  buildPrepended,
  computeFirstUnreadIdx,
} from './messageListItems';
```

Add `fmtDate` to the time import (create the import if none exists; it belongs with the other `../lib/*` imports):

```tsx
import { fmtDate } from '../lib/time';
```

- [ ] **Step 2: Remove the now-duplicated local definitions**

Delete these local blocks from `MessageList.tsx` (they now live in `messageListItems.ts`):
- the `DividerItem` / `MessageItem` / `Item` type aliases (currently lines 37-39),
- `computeFirstUnreadIdx` (currently lines 58-64),
- `buildItems` (currently lines 66-74).

Keep `initialLocationFor` — it now consumes the imported `Item` type.

- [ ] **Step 3: Render date rows in `ItemRow`**

Replace the top of `ItemRow` (currently lines 86-88):

```tsx
const ItemRow: ItemContent<Item, RowContext> = ({ data, context }) => {
  if (data.kind === 'divider') return <UnreadDivider />;
  const m = data.m;
```

with:

```tsx
const ItemRow: ItemContent<Item, RowContext> = ({ data, context }) => {
  if (data.kind === 'date') return <MessageDivider label={fmtDate(data.ts)} tone="date" />;
  if (data.kind === 'divider') return <MessageDivider label="New" tone="accent" />;
  const m = data.m;
```

- [ ] **Step 4: Delete the inline `UnreadDivider`**

Remove the `UnreadDivider` function (currently lines 420-428) entirely — it is replaced by `<MessageDivider … tone="accent" />`.

- [ ] **Step 5: Unify `computeItemKey`**

Replace the `computeItemKey` prop body (currently lines 322-327):

```tsx
computeItemKey={({ data, index }) =>
  data ? (data.kind === 'msg' ? data.m.id : '__unread__') : `__pending-${index}__`
}
```

with (both `date` and `divider` items carry a stable `id`):

```tsx
computeItemKey={({ data, index }) =>
  data ? (data.kind === 'msg' ? data.m.id : data.id) : `__pending-${index}__`
}
```

- [ ] **Step 6: Seed the tail-append fast-path with date separators**

Replace the tail-growth append body (currently lines 220-221):

```tsx
const appended = visibleMessages.slice(prev.length).map<Item>((m) => ({ kind: 'msg', m }));
ref.data.append(appended, ({ atBottom }) => (atBottom ? 'smooth' : false));
```

with:

```tsx
const appended = buildAppended(visibleMessages.slice(prev.length), prev[prev.length - 1]);
ref.data.append(appended, ({ atBottom }) => (atBottom ? 'smooth' : false));
```

- [ ] **Step 7: Seed the head-prepend fast-path with date separators**

Replace the head-growth prepend body (currently lines 239-242):

```tsx
const prepended = visibleMessages
  .slice(0, visibleMessages.length - prev.length)
  .map<Item>((m) => ({ kind: 'msg', m }));
ref.data.prepend(prepended);
```

with:

```tsx
const olderMsgs = visibleMessages.slice(0, visibleMessages.length - prev.length);
const prepended = buildPrepended(olderMsgs, prev[0]);
ref.data.prepend(prepended);
```

Leave the same-length `map` path (currently lines 247-254) and the `replace` fallback (currently lines 258-259) unchanged — they already route non-`msg` items through untouched and rebuild via the imported `buildItems`.

- [ ] **Step 8: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors). Common miss: a leftover reference to `UnreadDivider` or a local `Item`/`buildItems` you deleted — fix the import if so.

- [ ] **Step 9: Lint the changed files**

Run: `pnpm exec biome check src tests`
Expected: PASS (no errors). Run `pnpm format` if only formatting differs.

- [ ] **Step 10: Run the full test suite**

Run: `pnpm test`
Expected: PASS — the prior baseline (335) plus the new tests from Tasks 1-3, 0 failures.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/components/MessageList.tsx
git commit -m "feat: render per-day date separators in the message list"
```

---

### Task 5: End-to-end verification

**Files:** none (manual verification).

**Interfaces:** none.

- [ ] **Step 1: Verify the feature live**

REQUIRED SUB-SKILL: use the `verify` skill (or `/run`) to launch the app and exercise the flow:

- Open a conversation (channel or DM) that spans **more than one calendar day**.
- Confirm a muted-warm horizontal rule appears between days, labeled with the absolute date (e.g. "July 2, 2026"), and that it is visually distinct from the orange "New" delimiter.
- Confirm a single-day conversation shows **no** separator.
- Confirm the unread "New" delimiter still renders in orange and, when it coincides with a day change, sits **below** the date separator.
- Scroll up to load older messages (if pagination is available) and confirm separators remain correct at the boundary with no duplicates.
- Send a new message and confirm no spurious separator appears for same-day arrivals.

- [ ] **Step 2: Finish the branch**

REQUIRED SUB-SKILL: use `superpowers:finishing-a-development-branch` to choose how to integrate the work (merge / PR / cleanup).

## Self-Review

**Spec coverage:** color (Task 2 tone map + Task 4 render), always-absolute label (Task 1 `fmtDate` + Task 4), static inline (item-kind model, Tasks 3-4), one-separator/most-recent-date rule (Task 3 `buildItems`/`buildAppended`/`buildPrepended` + tests), date→New ordering (Task 3 test + `buildItems`), no-separator-above-first + prepend invariant (Task 3), shared component refactor (Task 2 + Task 4 delete of inline `UnreadDivider`), fast-path handling (Task 4 steps 6-7), no consumer changes (none touched), edge cases (Task 3 tests + Task 5 manual). All spec sections map to a task.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every command shows expected output.

**Type consistency:** `Item`/`DateItem`/`DividerItem`/`MessageItem`, `computeFirstUnreadIdx`, `buildItems`, `buildAppended`, `buildPrepended`, `dayKey`, `fmtDate`, and `MessageDivider({ label, tone })` are named identically across the tasks that define and consume them. `date` item shape `{ kind: 'date'; id; ts }` and the `computeItemKey` `data.id` access are consistent.
