# Conversation Date Separators — Design

- **Date:** 2026-07-07
- **Status:** Approved (design); pending implementation plan
- **Branch:** `worktree-feat+date-separators`

## Goal

Show a Discord-style horizontal rule between messages from different calendar
days in a conversation, mirroring how the existing "New" (unread) delimiter is
rendered. Refactor the current inline unread divider into a shared component
that renders a labeled horizontal rule with a configurable label and color, so
both the unread delimiter and the new date separator use it.

## Decisions

Settled during brainstorming:

- **Color:** dim muted-warm — label in `text-cs-text-muted`, rule lines in
  `bg-cs-border`. Distinct from the orange unread delimiter (`cs-accent`) and
  recedes so it never competes with it.
- **Label:** always absolute, localized long date via
  `toLocaleDateString(undefined, { dateStyle: 'long' })` → e.g. "July 2, 2026".
  No "Today"/"Yesterday" relative labels.
- **Behavior:** static inline — the separator is an ordinary row in the message
  stream and scrolls with the messages, exactly like the unread divider. Not
  sticky/floating.
- **One separator, most-recent date:** a separator appears only immediately
  above a real message, labeled with that message's day. When several empty
  days pass between two messages, there is exactly one separator, showing the
  newer message's date — never a run of empty-day separators, never two
  separators in a row.

## Non-goals

- Sticky/floating date pill that pins to the top of the viewport.
- Relative "Today" / "Yesterday" labels.
- A date separator above the absolute-oldest loaded message (see Edge cases).
- Changing the unread delimiter's appearance or behavior.
- Any change to the three `MessageList` consumers (`ChannelView`, `DMView`,
  `repeater-admin/MessagesTab`).

## Approach

Chosen from three options (per brainstorming): model the separator as a stream
item and reuse the divider component, with a "transition-only" insertion rule.
Rejected alternatives: per-row date header inside `MessageRow` (more complex —
still needs adjacency data everywhere plus mutates already-rendered rows on
prepend), and always-full-rebuild (discards the tuned append/prepend
scroll-preservation and re-measure-crash avoidance in the current code).

The message list ([`src/renderer/components/MessageList.tsx`](../../../src/renderer/components/MessageList.tsx))
is virtualized via `@virtuoso.dev/message-list`. Rows are a discriminated
union; the unread divider is already just another item kind inserted by
`buildItems`, with imperative fast-paths (`append`/`prepend`/`map`) for
incremental updates. Date separators slot into the same model.

### 1. Shared divider component

Extract the inline `UnreadDivider` into
`src/renderer/components/MessageDivider.tsx`:

```tsx
type DividerTone = 'accent' | 'date';

export function MessageDivider({ label, tone }: { label: string; tone: DividerTone }) { … }
```

A tone→classes lookup keeps styling centralized:

- `accent` (unread): label `text-cs-accent`, lines `bg-cs-accent/40` — identical
  to today's rendering.
- `date`: label `text-cs-text-muted`, lines `bg-cs-border`.

Same layout as today (two `h-px flex-1` lines flanking an uppercase, tracked,
`text-[10px]` label). The former `UnreadDivider` call site becomes
`<MessageDivider label="New" tone="accent" />`.

### 2. Date formatting helpers

Add to [`src/renderer/lib/time.ts`](../../../src/renderer/lib/time.ts):

- `fmtDate(ts: number): string` — `new Date(ts).toLocaleDateString(undefined, { dateStyle: 'long' })`.
  Date-only, so the 12/24-hour preference does not apply.
- `dayKey(ts: number): number` — a local-calendar day identifier (e.g.
  `y*10000 + (m+1)*100 + d` from a local `Date`) for cheap same-day comparison.
  Two timestamps are "the same day" iff their `dayKey` matches. Uses the local
  timezone, consistent with all other time rendering in the app.

### 3. Row model + item-building (extracted, testable)

Move the pure item-building logic out of `MessageList.tsx` into
`src/renderer/components/messageListItems.ts` and extend the union:

```ts
type DateItem    = { kind: 'date'; id: string; ts: number };   // id = `date-${dayKey(ts)}`
type DividerItem = { kind: 'divider'; id: '__unread__' };
type MessageItem = { kind: 'msg'; m: Message };
type Item = DateItem | DividerItem | MessageItem;
```

Functions (all pure, exported for tests):

- `buildItems(messages, firstUnreadIdx)` — for each `i`, if
  `i > 0 && dayKey(messages[i].ts) !== dayKey(messages[i-1].ts)`, push a
  `DateItem` with `ts = messages[i].ts` (the newer message's day). If that same
  `i` is also `firstUnreadIdx`, push the `DateItem` first, then the unread
  `DividerItem`, then the message (order: date → New → message). No date
  separator is emitted above `messages[0]`.
- `buildAppended(newMsgs, prevLastMsg)` — for the tail-append fast-path. Seeds
  the "previous day" from `prevLastMsg` so a `DateItem` is emitted before the
  first appended message only if it starts a new day, and at each internal day
  transition within the appended batch.
- `buildPrepended(olderMsgs, existingHeadMsg)` — for the load-older
  head-prepend fast-path. Emits internal transition separators within the older
  batch (never one above the batch's new topmost message), then a single
  boundary `DateItem` (ts = `existingHeadMsg.ts`) between the last older message
  and `existingHeadMsg` iff their days differ.

**Invariant:** the current absolute-topmost message never has a separator above
it, so prepend never produces a duplicate and no delete/patch of existing rows
is required.

### 4. Wiring in `MessageList.tsx`

- `ItemRow`: add `data.kind === 'date'` →
  `<MessageDivider label={fmtDate(data.ts)} tone="date" />`; the divider branch
  becomes `<MessageDivider label="New" tone="accent" />`.
- `computeItemKey`: unify to `data.kind === 'msg' ? data.m.id : data.id`
  (both `DateItem` and `DividerItem` carry a stable `id`), keeping the existing
  defensive `__pending-${index}__` fallback for transient undefined slots.
- Tail-append and head-prepend fast-paths call `buildAppended` /
  `buildPrepended` instead of a bare `messages.map(m => ({ kind: 'msg', m }))`.
- Unchanged: `computeFirstUnreadIdx`, `initialLocationFor` (still finds the
  unread divider by `kind === 'divider'`), the same-length `map` update path
  (only remaps `msg` content; date/divider items pass through), the wholesale
  `replace` fallback (uses `buildItems`), `handleRenderedDataChange` mark-read
  scan (already filters `kind === 'msg'`), and jump-to-index `findIndex` (already
  filters `kind === 'msg'`).

## Edge cases

| Case | Behavior |
|------|----------|
| Single-day conversation | No separators (no day transitions). |
| Multi-day gap (e.g. Jul 2 → Jul 6, empty days between) | One separator labeled "July 6, 2026" (newer message's day). |
| Absolute-oldest loaded message | No separator above it; a boundary separator appears once older messages of a different day are loaded above it. |
| Day boundary coincides with unread cutoff | Order: date separator, then "New", then the message. |
| New message arrives on a new day (crosses midnight) | Tail-append emits one date separator before it. |
| State-only update (delivery receipt, etc.) | `map` path preserves existing date/divider items unchanged. |

## Testing (TDD)

Unit tests (Vitest):

- `time.ts`: `dayKey` same/different day incl. across midnight; `fmtDate`
  formatting.
- `messageListItems.ts`: `buildItems` — transition insertion, single-day → none,
  no separator above `messages[0]`, multi-day-gap → single newest-date
  separator, date-above-unread ordering; `buildAppended` — new-day vs same-day
  seeding; `buildPrepended` — internal transitions and boundary separator
  present/absent by day match.
- `MessageDivider`: light render test asserting label text and tone classes for
  `accent` and `date`.

## Files touched

- **New:** `src/renderer/components/MessageDivider.tsx`
- **New:** `src/renderer/components/messageListItems.ts`
- **Edit:** `src/renderer/lib/time.ts` (add `fmtDate`, `dayKey`)
- **Edit:** `src/renderer/components/MessageList.tsx` (import shared divider +
  item builders, add `date` row rendering, fast-path wiring, unified key)
- **New tests:** for the above.
- **No change:** `ChannelView`, `DMView`, `repeater-admin/MessagesTab`.
