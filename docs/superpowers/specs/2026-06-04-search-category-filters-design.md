# Search Category Filters — Design

- **Date:** 2026-06-04
- **Status:** Approved (ready for implementation plan)
- **Area:** search panel (`src/renderer/panels/search`, `src/main/storage/search.ts`, `src/shared/types.ts`)
- **Builds on:** `2026-06-03-search-contacts-design.md` (Channels/Contacts sections already exist)

## Summary

Let the user filter search results by **Channels**, **DMs**, and **Contacts** —
any combination — and reimplement the filter chips as a shadcn **ToggleGroup**.

Today the header has two chips (`Channels`, `DMs`) backed by
`SearchFilters.kinds: ('channel' | 'dm')[]`, which only filters the **Messages**
section (via `m.kind`). The **Channels** and **Contacts** conversation sections
are returned purely on FTS match and aren't filtered at all, and there is no
Contacts toggle.

## Decisions (from brainstorming)

- **Three categories, by result type:**
  - **Channels** → the Channels conversation section **and** channel messages.
  - **DMs** → direct (1:1) messages.
  - **Contacts** → the Contacts conversation section.
- **At least one category is always selected.** Deselecting the last active
  chip is a no-op (drop today's quirky "auto-flip to the other" behavior).
- **Default:** all three on. Filter state stays **session-only** (not persisted;
  only `sort` is persisted, unchanged).
- **Widget:** a shadcn `ToggleGroup` (`type="multiple"`) replaces the bespoke
  `FilterChip` buttons.
- **Out of scope:** per-contact-kind sub-filtering (chat/repeater/room/sensor),
  persisting the filter across sessions, and converting the Recency/Relevance
  `SortPill`s to a ToggleGroup.

## Data Model

`src/shared/types.ts`:

```ts
export type SearchCategory = 'channel' | 'dm' | 'contact';

export interface SearchOptions {
  query: string;
  sort: SearchSort;
  /** Result categories to include. Omitted/empty → all three. 'channel' and
   *  'dm' gate message rows by m.kind; 'channel' also shows the Channels
   *  conversation section; 'contact' shows the Contacts conversation section. */
  categories?: SearchCategory[];
  // …key, fromPk, tsFrom, tsTo, limit, offset unchanged
}
```

The existing `kinds` field is **renamed to `categories`** (it now spans
conversation sections, not just message kinds). It isn't persisted, and
`api.search` forwards `SearchOptions` verbatim, so the rename is contained.

`src/renderer/lib/store.ts`:

```ts
export interface SearchFilters {
  categories: SearchCategory[];
  // …key, fromPk, tsFrom, tsTo unchanged
}
const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  categories: ['channel', 'dm', 'contact'],
};
```

## Backend — `searchMessages` (`src/main/storage/search.ts`)

```ts
const categories = opts.categories?.length
  ? opts.categories
  : (['channel', 'dm', 'contact'] as SearchCategory[]);
const showChannels = categories.includes('channel');
const showContacts = categories.includes('contact');
const msgKinds = categories.filter((c) => c === 'channel' || c === 'dm'); // ⊆ {channel,dm}
```

1. **Messages** are gated by `msgKinds`:
   - `msgKinds.length === 0` → skip the message query entirely; return
     `messages: []`, `total.messages: 0`. (Happens when only `contact` is on.)
   - `=== 1` → `m.kind = ?` (existing single-kind path).
   - `=== 2` → no kind filter (existing both-kinds path).

   This replaces the current `if (kinds.length < 2) { m.kind = ? }` logic, which
   assumed `kinds ⊆ {channel,dm}` and never produced "no messages".

2. **Sender expansion is unchanged and stays correct.** `senderPks` is still
   derived from **all** matched contact conversations (the unfiltered
   `convoByKey`), so DM messages from a matched contact still surface when `dm`
   is selected even if the Contacts section is hidden. The sender leg already
   inherits the `m.kind` filter via the shared `filterSql`.

3. **Conversation sections** are filtered when building the output list (the
   convo matches are fetched unfiltered so sender expansion keeps working):

   ```ts
   const conversations: ConversationHit[] = [...convoByKey.values()]
     .filter((r) => (r.kind === 'channel' ? showChannels : showContacts))
     .sort((a, b) => a.score - b.score)
     .map((r) => ({ /* …unchanged, incl. contactKind */ }));
   ```

   `total.conversations` becomes the post-filter length (unchanged expression).

No change to `buildMatchExpression`, the FTS schema, or `rebuildConversationsIndex`.

## Frontend

### New shadcn components (`src/renderer/components/ui/`)

Add `toggle.tsx` and `toggle-group.tsx`, authored to match the repo's existing
shadcn convention (as in `switch.tsx`): import primitives from the unified
`radix-ui` package, `cn` from `@/lib/utils`, `cva` from
`class-variance-authority`, `data-slot` attributes, themed shadcn tokens. The
canonical new-york `toggleVariants` (default/outline variants; sm/default/lg
sizes) is used; `toggle-group.tsx` shares a small context for `variant`/`size`.

### `SearchHeader.tsx`

Replace the two `FilterChip`s with one ToggleGroup:

```tsx
<ToggleGroup
  type="multiple"
  variant="outline"
  size="sm"
  value={filters.categories}
  onValueChange={onCategoriesChange}
  className="flex-wrap"
>
  <ToggleGroupItem value="channel" aria-label="Filter channels">Channels</ToggleGroupItem>
  <ToggleGroupItem value="dm" aria-label="Filter direct messages">DMs</ToggleGroupItem>
  <ToggleGroupItem value="contact" aria-label="Filter contacts">Contacts</ToggleGroupItem>
</ToggleGroup>
```

Props: drop `toggleKind`; add `onCategoriesChange: (next: string[]) => void` (Radix's
`onValueChange` hands back `string[]`; the cast to `SearchCategory[]` happens in
`applyCategorySelection`). `filters.kinds` references become `filters.categories`.

### "At least one on" — pure helper

New `src/renderer/panels/search/categoryFilter.ts`:

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

### `index.tsx`

- Replace `toggleKind` with:
  `const onCategoriesChange = (next: string[]) => setFilters({ categories: applyCategorySelection(next, filters.categories) });`
- Read `filters.categories` (was `filters.kinds`); pass `categories: filters.categories`
  to `api.search`; include `filters.categories` in the page-0 effect dependency
  array (replacing `filters.kinds`).

### `ResultsList.tsx`

No change. The backend now returns empty `channels` / `contacts` / message
arrays for deselected categories, and the sections already render only when
non-empty.

### Cleanup

Remove `FilterChip` from `atoms.tsx` (SearchHeader was its only consumer). Keep
`SortPill` and `DateInput`.

## Edge Cases

- **At-least-one** enforced in the UI via `applyCategorySelection`; the backend
  independently defaults to all three when `categories` is omitted/empty.
- **Only `contact`** → Contacts section only (no Messages, no Channels section).
- **Only `dm`** → DM messages only (no conversation sections).
- **Only `channel`** → Channels section + channel messages (no Contacts, no DMs).
- **Existing callers** (round-trip + search-contacts integration tests) pass no
  `categories`, so they default to all three — current expectations (contact
  hits, channel hits, message hits) are unaffected.

## Testing

**Backend (extend `tests/integration/storage/search-contacts.test.ts`):** seed a
channel, a chat contact (with a DM message), and a repeater contact, then assert:
- `categories: ['contact']` → contact conversation hits present; `conversations`
  has no `channel` hits; `messages` empty.
- `categories: ['channel']` → channel conversation hit present + channel
  message(s); no `contact` conversation hits; no DM messages.
- `categories: ['dm']` → DM message(s) present; `conversations` empty.
- `categories: ['channel','dm']` → channels + both message kinds; no contact hits.
- omitted/`undefined` → all three (channels, contacts, messages all present).

**Frontend (unit, `tests/unit/renderer/panels/search/categoryFilter.test.ts`):**
`applyCategorySelection` —
- returns `next` when non-empty;
- returns `current` (unchanged) when `next` is empty;
- preserves order/values of `next`.

The ToggleGroup wiring itself has no automated test (no component-test infra);
verified by typecheck + lint + manual run.

## Approaches Considered

- **Rename `kinds` → `categories` (chosen).** Accurate name now that the filter
  spans conversation sections; field isn't persisted, so churn is contained.
- **Keep `kinds`, add a separate `contact` flag.** Two parallel filter concepts
  and a misleading name. Rejected.
- **Custom chips vs shadcn ToggleGroup.** ToggleGroup chosen per request; it also
  aligns the control with the project's existing shadcn component set.
