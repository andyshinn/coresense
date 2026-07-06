# Message Actions — Quick Bar — Design

- **Date:** 2026-07-05
- **Branch/worktree:** `worktree-feat+message-quick-actions`
- **Status:** Approved shape, pending spec review

## Summary

Add a Discord-style **hover quick-actions bar** to message rows in the channel and
DM conversation views. On hover, a compact bar appears in the top-right of the
message with actions for reacting with an emoji, replying, copying the text, and
(placeholders) macros and delete, plus an overflow (`⋯`) menu for the rest.

The centerpiece is **emoji reactions implemented without any wire protocol**:
picking an emoji **inserts** `@[sender] 🫡` into the composer (focused, not sent),
reusing the existing `@[name]` mention tokenizer and `MentionPill`. Because the
emoji picker is our own UI, we know which emoji was chosen and can **track usage
(frecency)** to auto-pin the user's most-used emojis as one-click quick-reacts.

The bar consolidates and reuses existing message affordances: it **replaces** the
standalone rich-mode hover reply button, and its `⋯` overflow shares one menu
with the existing right-click context menu (extended with two new "copy path"
actions and the existing "view contact").

## Goals

- A hover-revealed quick-actions bar on interactive message rows in
  `ChannelView` and `DMView`, both `rich` and `compact` densities.
- Emoji reaction = insert `@[sender] <emoji> ` into the composer (no send, no wire
  format, no reaction badges); reuses the mention system.
- A **custom** emoji picker (shadcn `Popover` + [frimousse](https://frimousse.liveblocks.io)),
  with a row of **auto-pinned frecent emojis** for one-click reacting.
- Track emoji usage and auto-pin the top-N by frecency; persisted **account-global**
  (shared across the Electron window and any web client), seeded with sensible
  defaults so the bar is never empty.
- Bar actions: React, Reply, Copy text, Macros (placeholder), Message info,
  Delete (placeholder), Overflow (`⋯`).
- Overflow menu (shared with right-click): View contact / go to sender,
  **Copy first path heard**, **Copy all paths heard**, plus existing Re-send / Block.
- Retire the standalone rich-mode hover reply button (superseded by the bar).

## Non-goals

- Native OS emoji panel (`app.isEmojiPanelSupported()` / `app.showEmojiPanel()`).
  Dropped: it cannot report which emoji was picked, which our frecency/auto-pin
  requires. Custom picker only.
- Any transmitted/badge reactions, reaction counts, or a MeshCore reaction wire
  format. Emoji is always just message text.
- **Functional** message delete. No local-DB delete capability exists yet; Delete
  ships as a disabled placeholder. (Intended eventual semantics: local delete of
  any message — see Open items.)
- Macros. Ships as a disabled placeholder; the macros feature is a separate,
  later project.
- Changing the composer's 132-char limit or MeshCore send path.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Emoji action | **Insert `@[sender] <emoji>` into the composer** (mention + emoji), not sent automatically; no wire protocol |
| Send behavior | **Insert into composer** (user presses Enter to send), never auto-send |
| Emoji picker | **Custom only** — shadcn `Popover` + **frimousse** (`components/ui/emoji-picker`); native OS panel dropped |
| Frecency / auto-pin | Track usage; auto-pin **top-N by frecency**; seed defaults when sparse |
| Frecency storage | **Account-global** — new `UiState.emojiUsage`, synced via the existing `applyUiState` whitelist (like `pinned`/`recentKeys`) |
| Bar attachment | **Per-row absolute overlay** inside `MessageItem`'s existing `group` container (Approach A) |
| Bar actions | React, Reply, Copy text, Macros (disabled), Message info, Delete (disabled), Overflow `⋯` |
| Reply button | **Retire** the standalone rich-mode hover reply button; Reply lives in the bar |
| Delete | **Disabled placeholder** (no local-DB delete yet); eventual semantics = local delete, any message |
| Overflow menu | **Reuse** the existing custom `ContextMenu`; one shared item list for right-click and `⋯` |
| New overflow items | **View contact** (go to sender), **Copy first path heard**, **Copy all paths heard** (comma-separated hop `shortId`s) |

## Current architecture (for reference)

- **Message rendering:** `MessageList` ([src/renderer/components/MessageList.tsx](../../../src/renderer/components/MessageList.tsx))
  virtualizes rows via `@virtuoso.dev/message-list`. Each row → `MessageRow`
  (store adapter, adds `timeFormat`) → `MessageItem`
  ([src/renderer/components/MessageItem.tsx](../../../src/renderer/components/MessageItem.tsx)),
  the shared presentational component. `MessageItem`'s outer container is already
  `<div className="group px-3 py-0.5">`, and it already uses `group-hover:` to
  reveal a per-row reply button (rich mode). Unreads previews render `MessageItem`
  **non-interactively** (no `onSelect`).
- **Row context:** `MessageList` builds a `RowContext` (`selectedId`, `flashId`,
  `onSelect`, `onReply`, `onContextMenu`, `contactByPk`, `style`) passed to every
  row. Right-click sets `menu` state and renders a single `ContextMenu`.
- **Context menu:** `ContextMenu` ([src/renderer/components/ContextMenu.tsx](../../../src/renderer/components/ContextMenu.tsx))
  is a custom (non-Radix) fixed-position popover with a declarative `menuItem` /
  `menuSeparator` API and a `copyToClipboard(text, onDone?)` helper.
  `buildMessageMenuItems` (in `MessageList.tsx`) builds the items: Copy text,
  View contact, Re-send (failed only), Block sender.
- **Mentions:** `parseMessageContent` ([src/renderer/lib/messageContent.ts](../../../src/renderer/lib/messageContent.ts))
  tokenizes `@[name]` via `@\[[^\]]+\]`; `MentionPill` resolves the name to a
  contact and renders a chip. The composer already inserts mentions:
  `Composer` ([src/renderer/components/Composer.tsx](../../../src/renderer/components/Composer.tsx))
  exposes `ComposerHandle.insertMention(name)` which inserts `@[name] ` at the
  caret (with leading-space handling and caret restoration).
- **View wiring:** `ChannelView` / `DMView` hold a `composerRef` and pass
  `onReply={(name) => composerRef.current?.insertMention(name)}` down to
  `MessageList`. `onSelect` opens the right-rail message detail
  (`setSelectedMessage` + open right rail), which renders the `HeardVia` / path
  detail (`MessageInfo`).
- **Paths:** `Message.meta.paths?: MessagePath[]` ([src/shared/types.ts](../../../src/shared/types.ts));
  each `MessagePath.hops: MessageHop[]` where `MessageHop.shortId` is the per-hop
  prefix hex (`origin` / `hop` / `sink`). `firstPathStats`/`formatPathStats`
  ([src/renderer/lib/messagePath.ts](../../../src/renderer/lib/messagePath.ts))
  derive the compact `"2h · 1b"` meta label from `meta.paths[0]`.
- **UiState persistence & sync:** `UiState` ([src/shared/types.ts:733](../../../src/shared/types.ts))
  is persisted and synced generically — `App.tsx` debounce-PUTs the **whole** `ui`
  object via `api.putUiState`; main (`holder.setUiState` → `settingsStore` +
  `emit.uiState`) stores it and broadcasts it to all connected clients. The
  renderer's `applyUiState` ([src/renderer/lib/store.ts:710](../../../src/renderer/lib/store.ts))
  is what makes fields **account-global vs client-local**: it merges only a
  whitelist — `lastReadByKey`, `pinned`, `recentKeys`, `themePref` — from remote
  broadcasts, ignoring the rest so another client's pane layout can't clobber
  ours. So making a field account-global is a **renderer-only** change (add to the
  whitelist); main carries any new `UiState` field automatically.
- **UI stack:** shadcn/ui "new-york" + Radix + Tailwind v4 + lucide-react; toasts
  via `sonner`. Installed shadcn primitives include `popover`, `tooltip`,
  `toggle-group`, `command`. No `emoji-picker` component and no `frimousse`
  dependency yet.

Approach A (per-row overlay) is chosen over Approach B (a single shared floating
bar positioned via mouse tracking) because it mirrors the existing `group-hover`
reply-button pattern, needs no global positioning math, and only mounts for the
handful of on-screen virtualized rows.

## Design

### 1. New feature module: `src/renderer/features/message-actions/`

- **`MessageQuickBar.tsx`** — the hover bar. Rendered by `MessageItem` for
  interactive rows only. Absolutely positioned top-right inside the existing
  `group` container; `opacity-0 group-hover:opacity-100`, and forced visible while
  its own popover/menu is open (`data-[open=true]:opacity-100`). Reads frecent
  emojis + `recordEmojiUse` from the store directly; receives message-scoped
  callbacks (react/reply/copy/info/overflow) from `RowContext`. Renders, left→
  right (exact order/visuals per the mockup — see Prerequisites):
  - N inline **quick-react emoji** buttons (one-click) — default N = 5.
  - **React** button (lucide `SmilePlus`) → opens `EmojiPickerPopover`.
  - **Reply** button (`Reply`) → `onReply(senderName)`.
  - **Copy text** (`Copy`) → `onCopyText()`.
  - **Macros** (`Sparkles`/`Zap`, `disabled`, tooltip "Macros — coming soon").
  - **Message info** (`Info`) → `onInfo()`.
  - **Delete** (`Trash2`, `disabled`, tooltip "Delete — coming soon").
  - **Overflow** (`MoreHorizontal`) → `onOverflow(message, rect)`.
  - Icon buttons use `Tooltip`; disabled placeholders are real `disabled` buttons.
- **`EmojiPickerPopover.tsx`** — shadcn `Popover` wrapping the frimousse-based
  `EmojiPicker` (`components/ui/emoji-picker`). `onEmojiSelect={({ emoji }) => …}`
  → calls `recordEmojiUse(emoji)` then `onReact(senderName, emoji)`, and closes.
  The picker's data source is bundled locally for offline use (see §6).
- **`frecency.ts`** — pure, unit-tested:
  - `type EmojiUsage = Record<string, { count: number; lastUsedMs: number }>`.
  - `scoreEmoji(entry, nowMs): number` — frecency blend of `count` and recency of
    `lastUsedMs` (e.g. `count * recencyWeight(nowMs - lastUsedMs)`).
  - `topEmojis(usage, nowMs, n, seed): string[]` — top-N by score; when usage has
    fewer than N entries, backfill from `seed` (deduped, order preserved) so the
    result always has N. `seed = ['👍','❤️','😂','😮','😢','🙏']`.
  - `recordUsage(usage, emoji, nowMs): EmojiUsage` — increment count + set
    `lastUsedMs` (pure; returns a new record).
- **`paths.ts`** — pure, unit-tested path formatting for the overflow copies:
  - `formatPathHeard(path: MessagePath): string` — hop `shortId`s joined by `,`
    (e.g. `a1,b2,c3`). Order = origin→…→sink as stored.
  - `formatFirstPathHeard(message): string | null` — `meta.paths?.[0]` via
    `formatPathHeard`, else `null`.
  - `formatAllPathsHeard(message): string | null` — each `meta.paths` entry via
    `formatPathHeard`, one path per line (`\n`), else `null`.
  - When there are no paths, the corresponding menu items are omitted (not
    disabled) so the menu stays tight.

### 2. Composer — `insertReaction`

Extend `ComposerHandle` ([Composer.tsx](../../../src/renderer/components/Composer.tsx))
with `insertReaction(senderName: string, emoji: string)`, analogous to
`insertMention`: inserts `@[senderName] <emoji> ` at the caret (leading-space
handling + caret restoration on the next frame). Reuses the same
draft/`setValue` mechanics, so it persists to `ui.drafts` and survives view
switches like any draft. Reply continues to use `insertMention`.

### 3. `MessageItem` — mount the bar; retire the reply button

- Render `<MessageQuickBar …/>` inside the `group` container
  ([MessageItem.tsx:137-164](../../../src/renderer/components/MessageItem.tsx))
  **only when `interactive`** (i.e. `onSelect != null`), so Unreads previews are
  unaffected.
- **Remove** the standalone rich-mode reply button
  ([MessageItem.tsx:101-114](../../../src/renderer/components/MessageItem.tsx));
  Reply now lives in the bar. Keep the `canReply` gate logic (name present, not
  self, `onReply` wired) to decide whether the bar shows Reply.
- New props on `MessageItem`/`MessageRow` to carry the bar callbacks
  (`onReact`, `onCopyText`, `onInfo`, `onOverflow`) — threaded from `RowContext`
  exactly like `onReply`/`onSelect` today.

### 4. `MessageList` — row context, shared menu, new copy actions

- Extend `RowContext` with `onReact(name, emoji)`, `onOverflow(m, rect)` (and pass
  through `onCopyText`/`onInfo`, or derive them in the row from existing
  `onSelect`/`copyToClipboard`). `onInfo` = `onSelect(m.id)` (opens the right-rail
  detail). `onCopyText` = `copyToClipboard(m.body)` + a `sonner` "Copied" toast.
- **One shared menu.** `onOverflow(m, rect)` sets the same `menu` state used by
  right-click (`setMenu({ message, x, y })`, computing `x/y` from the button
  rect), so the `⋯` button and right-click render the identical `ContextMenu`.
- Extend `buildMessageMenuItems` with:
  - **View contact** — already present (jump to sender's conversation via
    `setActiveKey('c:<pk>')`); keep.
  - **Copy first path heard** — shown when `formatFirstPathHeard(message)` is
    non-null; copies it (comma-separated `shortId`s) + toast.
  - **Copy all paths heard** — shown when `formatAllPathsHeard(message)` is
    non-null; copies it (one path per line) + toast.
  - Existing Copy text / Re-send / Block sender remain.

### 5. Store — `emojiUsage` (account-global)

- Add `emojiUsage: Record<string, { count: number; lastUsedMs: number }>` to
  `UiState` and `DEFAULT_UI_STATE` (default `{}`) in
  [src/shared/types.ts](../../../src/shared/types.ts).
- Add a `recordEmojiUse(emoji: string)` store action that updates
  `ui.emojiUsage` via `frecency.recordUsage` — mutating `ui` triggers the existing
  debounced `putUiState` (persist + broadcast) automatically.
- Add `emojiUsage` to the **account-global whitelist** in `applyUiState`
  ([store.ts:710](../../../src/renderer/lib/store.ts)) — both the `same`
  idempotency check and the merged object — so it stays consistent across the
  Electron window and any web client, matching `pinned`/`recentKeys`.
- The quick-react row + picker read `topEmojis(ui.emojiUsage, now, N, SEED)`.
  `now` is read at render (usage recency only affects ordering, not correctness).

### 6. shadcn emoji-picker (frimousse) + offline data

- Add the shadcn `emoji-picker` component
  (`src/renderer/components/ui/emoji-picker.tsx`) and the `frimousse` dependency.
  Style it with `cs-*` tokens to match the app; compose inside our `Popover`
  (`EmojiPicker` + `EmojiPickerSearch` + `EmojiPickerContent` + optional
  `EmojiPickerFooter`). `onEmojiSelect` yields `{ emoji }`.
- **Offline data:** frimousse fetches emojibase data from a CDN by default. The
  app must work offline (mesh/radio context), so bundle emojibase data as a local
  asset and point frimousse at it (custom data source / locale URL). Confirm the
  exact configuration during planning (see Open items).

### 7. Wiring in `ChannelView` / `DMView`

Both views already hold `composerRef` and pass `onReply`. Add:
`onReact={(name, emoji) => composerRef.current?.insertReaction(name, emoji)}`,
threaded through `MessageList` → `RowContext` → `MessageItem` → `MessageQuickBar`
(same pattern as `onReply`). No new view state. When the composer is disabled
(e.g. channel not on device), react/reply still write to the persisted draft
(harmless; consistent with today's reply button behavior).

## Data flow (end to end)

1. User hovers a message row → `MessageQuickBar` fades in (top-right overlay).
2. **Quick-react:** click a pinned emoji → `recordEmojiUse(emoji)` (updates
   `ui.emojiUsage` → debounced persist/broadcast) → `onReact(senderName, emoji)` →
   `composer.insertReaction` inserts `@[sender] <emoji> ` into the focused
   composer. User reviews and presses Enter to send it as a normal mesh message.
3. **Picker:** click React → `Popover` opens the frimousse picker (bar stays
   visible while open) → select → same `recordEmojiUse` + `insertReaction` path,
   popover closes.
4. **Reply:** `onReply(senderName)` → `composer.insertMention`.
5. **Copy text:** `copyToClipboard(body)` + "Copied" toast.
6. **Message info:** `onSelect(id)` opens the right-rail path/RSSI detail.
7. **Overflow `⋯`:** opens the shared `ContextMenu` at the button — View contact,
   Copy first path heard, Copy all paths heard, Re-send (failed), Block sender.
8. **Macros / Delete:** disabled buttons with "coming soon" tooltips.
9. Auto-pins recompute from `ui.emojiUsage` as usage grows; empty/sparse usage
   backfills from the seed set so the row is always full.

## Testing strategy (TDD)

- **Unit — `frecency.ts`:** score ordering (count vs recency), `topEmojis`
  top-N + seed backfill + dedupe + stable order, `recordUsage` increments +
  timestamp, empty-usage → full seed.
- **Unit — `paths.ts`:** `formatPathHeard` comma join in hop order;
  `formatFirstPathHeard`/`formatAllPathsHeard` incl. no-paths → `null` (menu items
  omitted); multi-path newline formatting.
- **DOM — quick bar:** bar hidden by default, revealed on hover; clicking a
  quick-react emoji calls `onReact(senderName, emoji)` and records usage; opening
  the picker + selecting inserts into the composer + records usage; Copy text
  writes the body + toast; Reply inserts the mention; overflow opens the menu with
  the path-copy items; Macros/Delete are `disabled`; Unreads previews render no
  bar. Use `flushSync` in the harness per the project's DOM-test timing note.
- **DOM — composer:** `insertReaction` inserts `@[name] <emoji> ` at the caret and
  updates the draft.
- Baseline before/after: `pnpm typecheck` + `pnpm test` (green). Scope Biome to
  `src tests` per repo memory.

## Open items to confirm during planning

- **Mockup:** obtain `Message Actions - Quick Bar.html` (Claude Design "Send to
  Claude Code Web", or paste) — it is the visual source of truth for exact button
  order, inline quick-react count, spacing, and hover styling.
- **frimousse offline data:** confirm how to bundle emojibase data and point
  frimousse at a local source (vs the default CDN fetch); confirm the shadcn
  `emoji-picker` install specifics via Context7.
- **`settingsStore` persistence:** confirm `loadUiState`/`saveUiState`
  ([src/main/storage/settings.ts](../../../src/main/storage/settings.ts)) persists
  new/unknown `UiState` fields generically, or add `emojiUsage` to its schema.
- **Path-copy format:** confirm comma-separated hop `shortId`s (first path) and
  newline-separated paths (all) — vs an alternative (names, `→` joins).
- **132-char cap:** inserting `@[LongName] 😀` consumes the message budget (emoji =
  multiple UTF-16 units); the composer already warns near the limit. Confirm this
  is acceptable (no special handling planned).
- **Delete semantics (future):** when local-DB delete lands, Delete performs a
  local delete of any message (removed from history + rendered list; never
  transmitted).

## File-by-file change list

**Add**
- `src/renderer/features/message-actions/MessageQuickBar.tsx`
- `src/renderer/features/message-actions/EmojiPickerPopover.tsx`
- `src/renderer/features/message-actions/frecency.ts` (+ unit test)
- `src/renderer/features/message-actions/paths.ts` (+ unit test)
- `src/renderer/components/ui/emoji-picker.tsx` (shadcn/frimousse)
- bundled emojibase data asset (location TBD in planning)

**Modify**
- `src/renderer/components/MessageItem.tsx` (mount `MessageQuickBar` for
  interactive rows; remove the standalone reply button; new callback props)
- `src/renderer/components/MessageRow.tsx` (thread new callbacks)
- `src/renderer/components/MessageList.tsx` (`RowContext` gains `onReact`/
  `onOverflow`/`onInfo`/`onCopyText`; `⋯` opens the shared `ContextMenu`; extend
  `buildMessageMenuItems` with the two path-copy items)
- `src/renderer/components/Composer.tsx` (`insertReaction` on `ComposerHandle`)
- `src/renderer/panels/ChannelView.tsx` (`onReact` wiring)
- `src/renderer/panels/DMView.tsx` (`onReact` wiring)
- `src/renderer/lib/store.ts` (`recordEmojiUse`; add `emojiUsage` to `applyUiState`
  whitelist + idempotency check)
- `src/shared/types.ts` (`UiState.emojiUsage` + `DEFAULT_UI_STATE`)
- `src/main/storage/settings.ts` (only if it validates/whitelists `UiState` fields)
- `package.json` (`frimousse` dependency)
