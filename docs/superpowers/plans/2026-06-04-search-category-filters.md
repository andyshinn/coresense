# Search Category Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user filter search results by Channels, DMs, and Contacts (any combination), with the filter chips reimplemented as a shadcn ToggleGroup.

**Architecture:** A single `categories: SearchCategory[]` filter (renamed from `kinds`) gates results: `'channel'` shows the Channels conversation section + channel messages, `'dm'` shows direct messages, `'contact'` shows the Contacts conversation section. The backend `searchMessages` derives a message-kind subset for the message legs and filters conversation hits by category. The UI uses a shadcn `ToggleGroup` (`type="multiple"`) that enforces "at least one selected".

**Tech Stack:** TypeScript, `node:sqlite` FTS5 (main), React + shadcn/ui (`radix-ui` unified package, `class-variance-authority`), Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-04-search-category-filters-design.md`

**Sequencing rationale:** the `kinds`→`categories` rename is cross-cutting (shared type, store, backend, `index.tsx`, `SearchHeader.tsx` all reference it), so it is done as one mechanical, behavior-preserving task (Task 2) before any logic change. This keeps every commit compiling and the existing 208-test suite green.

---

## File Structure

| File | Task | Responsibility |
|------|------|----------------|
| `src/renderer/components/ui/toggle.tsx` | 1 (create) | shadcn Toggle + `toggleVariants` (cva). |
| `src/renderer/components/ui/toggle-group.tsx` | 1 (create) | shadcn ToggleGroup + ToggleGroupItem. |
| `src/shared/types.ts` | 2, 3 | Rename `SearchOptions.kinds`→`categories`; add `SearchCategory`. |
| `src/renderer/lib/store.ts` | 2, 3 | Rename `SearchFilters.kinds`→`categories`; widen type + default all three. |
| `src/main/storage/search.ts` | 2, 3 | Rename usage; category gating of messages + conversation sections. |
| `src/renderer/panels/search/index.tsx` | 2, 4 | Rename usage; replace `toggleKind` with `onCategoriesChange`. |
| `src/renderer/panels/search/SearchHeader.tsx` | 2, 4 | Rename usage; swap FilterChips → ToggleGroup. |
| `src/renderer/panels/search/categoryFilter.ts` | 4 (create) | Pure `applyCategorySelection` helper. |
| `src/renderer/panels/search/atoms.tsx` | 4 | Remove now-unused `FilterChip`. |
| `tests/integration/storage/search-categories.test.ts` | 3 (create) | Backend per-category behavior. |
| `tests/unit/renderer/panels/search/categoryFilter.test.ts` | 4 (create) | Helper unit test. |

**Conventions (verified in-repo):**
- shadcn components import primitives from the unified `radix-ui` package (e.g. `import { Switch as SwitchPrimitive } from 'radix-ui'`), `cn` from `@/lib/utils`, `cva` from `class-variance-authority`, and use `data-slot` attributes. `rsc: false` in `components.json` — no `'use client'`.
- `@` alias → `src/renderer`. Unit tests (node env) import renderer code via `@/...`.
- Each integration test gets a fresh temp DB; `messagesStore.insert` derives message `kind` from the key prefix (`ch:`→channel, `c:`→dm) and `from_pk` from `Message.fromPublicKeyHex`.
- Run one test file: `pnpm exec vitest run <path>`. Typecheck: `pnpm typecheck`. Lint (scoped): `pnpm lint src tests`.
- This is a worktree under `.claude/worktrees/`; if `git add`/`commit` is blocked by the sandbox ("Operation not permitted"), retry the git command with the sandbox disabled.

---

## Task 1: Add shadcn Toggle + ToggleGroup components

Additive UI primitives, no wiring. Verified by typecheck + lint (no component-test infra).

**Files:**
- Create: `src/renderer/components/ui/toggle.tsx`
- Create: `src/renderer/components/ui/toggle-group.tsx`

- [ ] **Step 1: Create `toggle.tsx`**

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { Toggle as TogglePrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none transition-[color,box-shadow] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive whitespace-nowrap",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 px-2 min-w-9',
        sm: 'h-8 px-1.5 min-w-8',
        lg: 'h-10 px-2.5 min-w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
```

- [ ] **Step 2: Create `toggle-group.tsx`**

```tsx
import type { VariantProps } from 'class-variance-authority';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { toggleVariants } from '@/components/ui/toggle';

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
  size: 'default',
  variant: 'default',
});

function ToggleGroup({
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        'group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      className={cn(
        toggleVariants({ variant: context.variant || variant, size: context.size || size }),
        'min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l',
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
```

- [ ] **Step 3: Typecheck and lint**

```bash
pnpm typecheck
pnpm lint src tests
```
Expected: no errors. If biome reports formatting on the two new files, run `pnpm exec biome check --write src/renderer/components/ui/toggle.tsx src/renderer/components/ui/toggle-group.tsx` and re-run lint.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ui/toggle.tsx src/renderer/components/ui/toggle-group.tsx
git commit -m "feat(ui): add shadcn Toggle and ToggleGroup components

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Mechanical rename `kinds` → `categories`

Pure rename, no behavior change. Verified by the existing suite staying green.

**Files:** `src/shared/types.ts`, `src/renderer/lib/store.ts`, `src/main/storage/search.ts`, `src/renderer/panels/search/index.tsx`, `src/renderer/panels/search/SearchHeader.tsx`

- [ ] **Step 1: `src/shared/types.ts` — rename the field**

In `interface SearchOptions`, change:
```ts
  kinds?: ('channel' | 'dm')[];
```
to:
```ts
  categories?: ('channel' | 'dm')[];
```

- [ ] **Step 2: `src/renderer/lib/store.ts` — rename in `SearchFilters` + default**

Change `interface SearchFilters`:
```ts
  kinds: ('channel' | 'dm')[];
```
to:
```ts
  categories: ('channel' | 'dm')[];
```
And the default:
```ts
const DEFAULT_SEARCH_FILTERS: SearchFilters = { kinds: ['channel', 'dm'] };
```
to:
```ts
const DEFAULT_SEARCH_FILTERS: SearchFilters = { categories: ['channel', 'dm'] };
```

- [ ] **Step 3: `src/main/storage/search.ts` — rename usage**

Change:
```ts
  const kinds = opts.kinds ?? ['channel', 'dm'];
```
to:
```ts
  const categories = opts.categories ?? ['channel', 'dm'];
```
And the message-kind filter:
```ts
  if (kinds.length < 2) {
    filters.push(`m.kind = ?`);
    filterParams.push(kinds[0]);
  }
```
to:
```ts
  if (categories.length < 2) {
    filters.push(`m.kind = ?`);
    filterParams.push(categories[0]);
  }
```

- [ ] **Step 4: `src/renderer/panels/search/index.tsx` — rename usage**

(a) In the page-0 `api.search` call, change `kinds: filters.kinds,` → `categories: filters.categories,`.
(b) In the `onLoadMore` `api.search` call, change `kinds: filters.kinds,` → `categories: filters.categories,`.
(c) In the page-0 `useEffect` dependency array, change `filters.kinds,` → `filters.categories,`.
(d) Replace the `toggleKind` function:
```tsx
  const toggleKind = (k: 'channel' | 'dm') => {
    const has = filters.kinds.includes(k);
    const next = has ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k];
    // Don't allow zero kinds — would silently hide all messages. Treat the
    // second-toggle-off as "select only the other one" which the user
    // intends.
    if (next.length === 0) setFilters({ kinds: [k === 'channel' ? 'dm' : 'channel'] });
    else setFilters({ kinds: next });
  };
```
with the same logic using `categories`:
```tsx
  const toggleKind = (k: 'channel' | 'dm') => {
    const has = filters.categories.includes(k);
    const next = has ? filters.categories.filter((x) => x !== k) : [...filters.categories, k];
    // Don't allow zero kinds — would silently hide all messages. Treat the
    // second-toggle-off as "select only the other one" which the user
    // intends.
    if (next.length === 0) setFilters({ categories: [k === 'channel' ? 'dm' : 'channel'] });
    else setFilters({ categories: next });
  };
```

- [ ] **Step 5: `src/renderer/panels/search/SearchHeader.tsx` — rename usage**

Change the two FilterChip `active` props:
```tsx
          active={filters.kinds.includes('channel')}
```
→
```tsx
          active={filters.categories.includes('channel')}
```
and
```tsx
          active={filters.kinds.includes('dm')}
```
→
```tsx
          active={filters.categories.includes('dm')}
```

- [ ] **Step 6: Verify behavior is unchanged**

```bash
pnpm test
pnpm typecheck
pnpm lint src tests
```
Expected: all tests pass (same count as before this task), typecheck + lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/renderer/lib/store.ts src/main/storage/search.ts src/renderer/panels/search/index.tsx src/renderer/panels/search/SearchHeader.tsx
git commit -m "refactor(search): rename SearchFilters/SearchOptions 'kinds' to 'categories'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend category gating + Contacts default

Add the `SearchCategory` type, widen the filter to three categories (default all on), and gate messages + conversation sections in `searchMessages`.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/lib/store.ts`
- Modify: `src/main/storage/search.ts`
- Test: `tests/integration/storage/search-categories.test.ts` (create)

- [ ] **Step 1: `src/shared/types.ts` — add `SearchCategory`, widen field**

Add the type just above `interface SearchOptions` (after `export type SearchSort = ...`):
```ts
export type SearchCategory = 'channel' | 'dm' | 'contact';
```
Change the field:
```ts
  categories?: ('channel' | 'dm')[];
```
to:
```ts
  /** Result categories to include. Omitted/empty → all three. 'channel' and
   *  'dm' gate message rows by m.kind; 'channel' also shows the Channels
   *  conversation section; 'contact' shows the Contacts conversation section. */
  categories?: SearchCategory[];
```

- [ ] **Step 2: `src/renderer/lib/store.ts` — widen type + default all three**

Add `SearchCategory` to the import from `../../shared/types` (the existing `import { ... } from '../../shared/types'` near the top of the file). Change:
```ts
  categories: ('channel' | 'dm')[];
```
to:
```ts
  categories: SearchCategory[];
```
And the default:
```ts
const DEFAULT_SEARCH_FILTERS: SearchFilters = { categories: ['channel', 'dm'] };
```
to:
```ts
const DEFAULT_SEARCH_FILTERS: SearchFilters = { categories: ['channel', 'dm', 'contact'] };
```

- [ ] **Step 3: Write the failing integration test**

Create `tests/integration/storage/search-categories.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import { rebuildConversationsIndex, searchMessages } from '../../../src/main/storage/search';
import type { Channel, Contact, Message, SearchCategory } from '../../../src/shared/types';

const CTX = { contacts: [], blockRules: [], regexCache: new Map() };
const pk = (prefix: string, suffix: string): string =>
  prefix + '0'.repeat(64 - prefix.length - suffix.length) + suffix;

const ALICE_PK = pk('a1ce', 'face');
const REPEATER_PK = pk('77aa', '0001');

// Seed: channel "Alpha", chat contact "AlphaBot" (with a DM), repeater
// "Alpha Relay". The query "alpha" matches all three conversation names plus a
// channel message body and a DM message body.
function seed(): void {
  rebuildConversationsIndex({
    channels: [{ key: 'ch:Alpha', name: 'Alpha', kind: 'hashtag' } as Channel],
    contacts: [
      { key: `c:${ALICE_PK}`, publicKeyHex: ALICE_PK, name: 'AlphaBot', kind: 'chat' } as Contact,
      {
        key: `c:${REPEATER_PK}`,
        publicKeyHex: REPEATER_PK,
        name: 'Alpha Relay',
        kind: 'repeater',
      } as Contact,
    ],
  });
  messagesStore.insert({
    id: 'chan1',
    key: 'ch:Alpha',
    body: 'alpha signal',
    ts: 1_700_000_000_000,
    state: 'received',
  } as Message);
  messagesStore.insert({
    id: 'dm1',
    key: `c:${ALICE_PK}`,
    fromPublicKeyHex: ALICE_PK,
    body: 'alpha ping',
    ts: 1_700_000_000_001,
    state: 'received',
  } as Message);
}

const run = (categories?: SearchCategory[]) =>
  searchMessages({ query: 'alpha', sort: 'relevance', categories }, CTX);

describe('search — category filters', () => {
  it('contact only → contact conversation hits, no channel hits, no messages', () => {
    seed();
    const r = run(['contact']);
    expect(r.conversations.every((c) => c.kind === 'contact')).toBe(true);
    expect(r.conversations.map((c) => c.name).sort()).toEqual(['Alpha Relay', 'AlphaBot']);
    expect(r.messages).toEqual([]);
    expect(r.total.messages).toBe(0);
  });

  it('channel only → channel conversation hit + channel messages, no contacts, no DMs', () => {
    seed();
    const r = run(['channel']);
    expect(r.conversations.map((c) => c.name)).toEqual(['Alpha']);
    expect(r.conversations.every((c) => c.kind === 'channel')).toBe(true);
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages.every((m) => m.key.startsWith('ch:'))).toBe(true);
  });

  it('dm only → DM messages, no conversation sections', () => {
    seed();
    const r = run(['dm']);
    expect(r.conversations).toEqual([]);
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages.every((m) => m.key.startsWith('c:'))).toBe(true);
  });

  it('channel + dm → channel hit + both message kinds, no contact hits', () => {
    seed();
    const r = run(['channel', 'dm']);
    expect(r.conversations.every((c) => c.kind === 'channel')).toBe(true);
    expect(r.messages.some((m) => m.key.startsWith('ch:'))).toBe(true);
    expect(r.messages.some((m) => m.key.startsWith('c:'))).toBe(true);
  });

  it('omitted categories → all three (channels, contacts, messages)', () => {
    seed();
    const r = run(undefined);
    expect(r.conversations.some((c) => c.kind === 'channel')).toBe(true);
    expect(r.conversations.some((c) => c.kind === 'contact')).toBe(true);
    expect(r.messages.some((m) => m.key.startsWith('ch:'))).toBe(true);
    expect(r.messages.some((m) => m.key.startsWith('c:'))).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/integration/storage/search-categories.test.ts
```
Expected: FAIL — the backend doesn't gate yet, so e.g. the `['contact']` case still returns messages and the `['dm']` case still returns conversation hits.

- [ ] **Step 5: `src/main/storage/search.ts` — implement gating**

(a) Add `SearchCategory` to the `import type { ... } from '../../shared/types'` block (alphabetically: after `MessageHit`, before `SearchOptions`).

(b) Replace:
```ts
  const categories = opts.categories ?? ['channel', 'dm'];
```
with:
```ts
  const categories = opts.categories?.length
    ? opts.categories
    : (['channel', 'dm', 'contact'] as SearchCategory[]);
  const showChannels = categories.includes('channel');
  const showContacts = categories.includes('contact');
  // Message rows are gated by the message-kind subset of the selected
  // categories. 'contact' is a conversation-section category, not a message
  // kind, so it never appears here.
  const msgKinds = categories.filter((c) => c === 'channel' || c === 'dm');
```

(c) Replace the message-kind filter:
```ts
  if (categories.length < 2) {
    filters.push(`m.kind = ?`);
    filterParams.push(categories[0]);
  }
```
with:
```ts
  if (msgKinds.length === 1) {
    filters.push(`m.kind = ?`);
    filterParams.push(msgKinds[0]);
  }
```

(d) Gate the message query. Replace:
```ts
  const messageRows = db.prepare(unionSql).all(...unionParams) as unknown as MessageRow[];
```
with:
```ts
  // No message kinds selected (only 'contact') → skip the message query.
  const wantMessages = msgKinds.length > 0;
  const messageRows = wantMessages
    ? (db.prepare(unionSql).all(...unionParams) as unknown as MessageRow[])
    : [];
```

(e) Gate the count. Replace:
```ts
  const { n: totalMessages = 0 } =
    (db.prepare(countSql).get(...countParams) as unknown as { n: number } | undefined) ?? {};
```
with:
```ts
  const totalMessages = wantMessages
    ? ((db.prepare(countSql).get(...countParams) as unknown as { n: number } | undefined)?.n ?? 0)
    : 0;
```

(f) Filter conversation hits by category. Replace:
```ts
  const conversations: ConversationHit[] = [...convoByKey.values()]
    .sort((a, b) => a.score - b.score)
    .map((r) => ({
```
with:
```ts
  const conversations: ConversationHit[] = [...convoByKey.values()]
    .filter((r) => (r.kind === 'channel' ? showChannels : showContacts))
    .sort((a, b) => a.score - b.score)
    .map((r) => ({
```

(Leave `senderPks` computed from the unfiltered `convoByKey` so DM sender-expansion still works when the Contacts section is hidden.)

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/integration/storage/search-categories.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 7: Run the full suite + typecheck + lint**

```bash
pnpm test
pnpm typecheck
pnpm lint src tests
```
Expected: all pass (existing + 5 new), typecheck + lint clean. If biome flags formatting on the new test file, run `pnpm exec biome check --write tests/integration/storage/search-categories.test.ts` and re-run lint. (The 2 chips still toggle channel/dm; `'contact'` is always present via the default, so the Contacts section shows — fully functional until Task 4 adds the chip.)

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/renderer/lib/store.ts src/main/storage/search.ts tests/integration/storage/search-categories.test.ts
git commit -m "feat(search): gate results by category (channels/dms/contacts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ToggleGroup UI + Contacts chip

Replace the two `FilterChip`s with a 3-item shadcn ToggleGroup that enforces "at least one selected".

**Files:**
- Create: `src/renderer/panels/search/categoryFilter.ts`
- Test: `tests/unit/renderer/panels/search/categoryFilter.test.ts`
- Modify: `src/renderer/panels/search/SearchHeader.tsx`
- Modify: `src/renderer/panels/search/index.tsx`
- Modify: `src/renderer/panels/search/atoms.tsx`

- [ ] **Step 1: Write the failing helper unit test**

Create `tests/unit/renderer/panels/search/categoryFilter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyCategorySelection } from '@/panels/search/categoryFilter';
import type { SearchCategory } from '../../../../../src/shared/types';

describe('applyCategorySelection', () => {
  it('returns the next selection when it is non-empty', () => {
    const current: SearchCategory[] = ['channel', 'dm', 'contact'];
    expect(applyCategorySelection(['channel', 'contact'], current)).toEqual(['channel', 'contact']);
  });

  it('keeps the current selection when next is empty (at least one stays on)', () => {
    const current: SearchCategory[] = ['dm'];
    expect(applyCategorySelection([], current)).toEqual(['dm']);
  });

  it('preserves the order and values of next', () => {
    const current: SearchCategory[] = ['channel'];
    expect(applyCategorySelection(['contact', 'dm', 'channel'], current)).toEqual([
      'contact',
      'dm',
      'channel',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/unit/renderer/panels/search/categoryFilter.test.ts
```
Expected: FAIL — cannot resolve `@/panels/search/categoryFilter`.

- [ ] **Step 3: Create the helper**

Create `src/renderer/panels/search/categoryFilter.ts`:

```ts
import type { SearchCategory } from '../../../shared/types';

/** Radix multiple-ToggleGroup hands back the full next selection. Reject an
 *  empty selection (keep the previous one) so at least one category stays on. */
export function applyCategorySelection(
  next: string[],
  current: SearchCategory[],
): SearchCategory[] {
  return next.length > 0 ? (next as SearchCategory[]) : current;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/unit/renderer/panels/search/categoryFilter.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: `src/renderer/panels/search/SearchHeader.tsx` — swap to ToggleGroup**

(a) Replace the import line:
```tsx
import { DateInput, FilterChip, SortPill } from './atoms';
```
with:
```tsx
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DateInput, SortPill } from './atoms';
```

(b) In the `Props` interface, replace:
```tsx
  toggleKind: (k: 'channel' | 'dm') => void;
```
with:
```tsx
  onCategoriesChange: (next: string[]) => void;
```

(c) In the destructured params, replace `toggleKind,` with `onCategoriesChange,`.

(d) Replace the two FilterChips:
```tsx
        <FilterChip
          label="Channels"
          active={filters.categories.includes('channel')}
          onClick={() => toggleKind('channel')}
        />
        <FilterChip
          label="DMs"
          active={filters.categories.includes('dm')}
          onClick={() => toggleKind('dm')}
        />
```
with the ToggleGroup:
```tsx
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={filters.categories}
          onValueChange={onCategoriesChange}
          className="flex-wrap"
        >
          <ToggleGroupItem value="channel" aria-label="Filter channels">
            Channels
          </ToggleGroupItem>
          <ToggleGroupItem value="dm" aria-label="Filter direct messages">
            DMs
          </ToggleGroupItem>
          <ToggleGroupItem value="contact" aria-label="Filter contacts">
            Contacts
          </ToggleGroupItem>
        </ToggleGroup>
```

- [ ] **Step 6: `src/renderer/panels/search/index.tsx` — wire `onCategoriesChange`**

(a) Add the import (next to the other local imports, e.g. after the `SearchHeader` import):
```tsx
import { applyCategorySelection } from './categoryFilter';
```

(b) Replace the entire `toggleKind` function:
```tsx
  const toggleKind = (k: 'channel' | 'dm') => {
    const has = filters.categories.includes(k);
    const next = has ? filters.categories.filter((x) => x !== k) : [...filters.categories, k];
    // Don't allow zero kinds — would silently hide all messages. Treat the
    // second-toggle-off as "select only the other one" which the user
    // intends.
    if (next.length === 0) setFilters({ categories: [k === 'channel' ? 'dm' : 'channel'] });
    else setFilters({ categories: next });
  };
```
with:
```tsx
  const onCategoriesChange = (next: string[]) => {
    setFilters({ categories: applyCategorySelection(next, filters.categories) });
  };
```

(c) In the `<SearchHeader ... />` element, replace the prop `toggleKind={toggleKind}` with `onCategoriesChange={onCategoriesChange}`.

- [ ] **Step 7: `src/renderer/panels/search/atoms.tsx` — remove unused `FilterChip`**

Delete the entire `FilterChip` function:
```tsx
export function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-7 rounded-md border px-2 transition-colors',
        active
          ? 'border-cs-accent bg-cs-accent-soft/20 text-cs-text'
          : 'border-cs-border bg-cs-bg-3 text-cs-text-muted hover:text-cs-text',
      )}
    >
      {label}
    </button>
  );
}
```
(Leave `SortPill`, `DateInput`, `Section`, `EmptyState`, and the `cn` import — `cn` is still used by `SortPill`.)

- [ ] **Step 8: Typecheck, lint, and run the suite**

```bash
pnpm typecheck
pnpm lint src tests
pnpm test
```
Expected: all clean/passing. If biome reports formatting on the edited files, run `pnpm exec biome check --write` on those specific files and re-run.

- [ ] **Step 9: Manual verification**

```bash
pnpm start
```
In the app: open search (Cmd/Ctrl+F), type a query. Confirm a segmented **Channels / DMs / Contacts** ToggleGroup appears; toggling off **Contacts** hides the Contacts section; toggling off **DMs** hides direct-message hits; the last remaining chip can't be turned off. Then stop the app.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/panels/search/categoryFilter.ts tests/unit/renderer/panels/search/categoryFilter.test.ts src/renderer/panels/search/SearchHeader.tsx src/renderer/panels/search/index.tsx src/renderer/panels/search/atoms.tsx
git commit -m "feat(search): Channels/DMs/Contacts filter as a shadcn ToggleGroup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck + lint**

```bash
pnpm test
pnpm typecheck
pnpm lint src tests
```
Expected: all tests pass (existing + 5 backend + 3 helper = +8), typecheck + lint clean.

- [ ] **Step 2: Confirm a clean tree**

```bash
git status --short
```
Expected: empty (everything from Tasks 1–4 committed).

---

## Spec Coverage Check

- 3 category chips (Channels/DMs/Contacts) → Task 4 (ToggleGroup), Task 3 (default includes contact).
- Channels = Channels section + channel messages; DMs = dm messages; Contacts = Contacts section → Task 3 (`showChannels`/`showContacts`/`msgKinds`).
- At least one always selected → Task 4 (`applyCategorySelection`).
- Default all three, session-only → Task 3 (store default; not persisted — unchanged).
- `SearchCategory` type + `kinds`→`categories` rename → Tasks 2 & 3.
- Backend: msgKinds gating (0/1/2), conversation-section filter, sender-expansion unchanged → Task 3.
- shadcn ToggleGroup (radix-ui convention) + remove FilterChip → Tasks 1 & 4.
- Tests: backend per-category + helper unit → Tasks 3 & 4.
- Out of scope (per-contact-kind sub-filter, persistence, sort pills) → not built.
