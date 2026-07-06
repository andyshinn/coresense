# Message Actions — Quick Bar — Design

- **Date:** 2026-07-05
- **Branch/worktree:** `worktree-feat+message-quick-actions`
- **Status:** Approved shape (incl. design-handoff reconciliation), pending spec review
- **Design handoff:** [docs/design/message-actions-quickbar/](../../design/message-actions-quickbar/)
  (`README.md` is the high-fidelity spec; `qb-concepts.jsx` / `ma-shared.jsx` /
  `ma-data.js` are the reference prototype — recreate, don't copy verbatim).

## Summary

Add a Discord-style **hover quick-actions bar** ("Quick Bar") to message rows in the
channel and DM conversation views. Hovering a message reveals a floating pill at its
top-right corner. The bar's contents differ by author:

- **Others' messages:** 5 quick-react emoji + emoji picker (`＋`) │ **Reply** │ 2 macro
  chips + all-macros (`⋯`) │ Copy │ overflow (`⋯`).
- **Your own messages:** **Copy** │ Info │ Delete.

The centerpiece is **emoji reactions without any wire protocol**: MeshCore has no
reaction message type and LoRa airtime is scarce, so nothing is stored or sent as a
"reaction." Picking an emoji (or a macro, or Reply) instead **composes a normal reply
into the composer** — `@[sender] 🫡 ` — using the app's existing `@[name]` mention
tokenizer, and shows a **reply-context chip**. The user presses Enter to send it as an
ordinary mesh message. Because the picker is our own UI we know the chosen emoji, so we
**track usage (frecency)** and auto-pin the top emojis as one-click quick-reacts.

Scope is the **bar + the composer reply-context chip**. Existing message-row rendering
is kept as-is (not restyled). Macros and Delete ship as **non-functional "soon"
placeholders** (macros are a later feature; no local-DB delete exists yet), so the bar's
layout is final now.

## Goals

- Hover-revealed Quick Bar on interactive message rows in `ChannelView` and `DMView`,
  both `rich` and `compact` densities; anchored top-right, revealed on row hover
  (120 ms), and **pinned visible while one of its popovers is open**.
- Author-aware contents (others vs self) exactly as the handoff specifies.
- Emoji/macro/Reply → insert `@[sender] <…> ` into the composer (no send, no wire
  format, no reaction records) + set the **reply-context chip** (`replyingTo`).
- Custom emoji picker: **frimousse** (shadcn `emoji-picker`) with **`emojibase-data`** as
  the data source, plus a frecency **"Frequently used"** row and the footer note.
- Track emoji usage; auto-pin the top-N (default 5) as the inline quick-react row,
  seeded with `👍 ✅ 📡 🔋 😂`; persisted **account-global**.
- **Info popover on all messages** (From / Public key / Hops / RSSI·SNR / State + PATH),
  built from fields already on the message.
- **Merged overflow menu:** View contact · Copy public key · Copy first path heard ·
  Copy all paths heard · (divider) · Dismiss locally (destructive, "soon").
- Macros (inline chips + all-macros popover) and Delete rendered per design but marked
  **"soon"/non-interactive**.
- Copy → clipboard + `sonner` toast.

## Non-goals

- Restyling existing message rows (avatar/bubble/meta) to pixel-match the handoff. We
  keep the current `MessageItem` rendering and only add the bar + reply chip. (The
  handoff's row styling is reference for the bar's look, not a row rewrite.)
- Native OS emoji panel (`app.showEmojiPanel()`) — can't report the picked emoji.
- Any transmitted/badge reactions or a MeshCore reaction wire format.
- **Functional** message delete (no local-DB delete yet) and **functional** macros —
  both are "soon" placeholders.
- Changing the composer's real **132-char** MeshCore limit (the prototype shows 200).

## Decisions

| Decision | Choice |
| --- | --- |
| Emoji/macro/Reply action | Insert `@[sender] <…> ` into the composer (mention + content); **not** auto-sent; no wire protocol |
| Author-aware bar | **Others:** reactions+picker · Reply · macro chips+all-macros · Copy · overflow. **Self:** Copy · Info · Delete |
| Emoji picker | **frimousse** (shadcn `emoji-picker`) + **`emojibase-data`** npm dependency |
| Emoji data delivery | Build-time copy of `emojibase-data/en/{data,messages}.json` into the Vite renderer output (served by Vite/Hono); **no `resources/`** needed |
| Frecency / auto-pin | Track usage; inline quick-react row = **top-5** by frecency, seeded `👍 ✅ 📡 🔋 😂`; "Frequently used" row in the picker |
| Frecency storage | **Account-global** — new `UiState.emojiUsage`, synced via the `applyUiState` whitelist |
| Reply model | **Reply-context chip** (`replyingTo`) + insert `@[sender] …` at the composer caret (preserves any draft) |
| Bar attachment | **Per-row absolute overlay** in `MessageItem`'s `group` container (row made `relative`) |
| Reply button | **Retire** the standalone rich-mode reply button; Reply lives in the bar |
| Message info | **Info popover on all messages** (design-styled), from existing message fields |
| Overflow menu | **Merged:** View contact · Copy public key · Copy first path heard · Copy all paths heard · (div) · Dismiss locally (destructive, "soon") |
| Macros | Inline chips (first 2) + all-macros popover, rendered **"soon"/non-interactive** |
| Delete / Dismiss | **"Soon" placeholder** (self: trash button; others: "Dismiss locally" in overflow); eventual = local-only removal |
| Path-copy format | Comma-separated hop `shortId`s (first path); newline-separated paths (all) |
| Char limit | Keep **132** (MeshCore), not the prototype's 200 |

## Current architecture (for reference)

- **Message rendering:** `MessageList` ([src/renderer/components/MessageList.tsx](../../../src/renderer/components/MessageList.tsx))
  virtualizes rows via `@virtuoso.dev/message-list` → `MessageRow` → `MessageItem`
  ([src/renderer/components/MessageItem.tsx](../../../src/renderer/components/MessageItem.tsx)),
  the shared presentational component. Its outer container is `<div className="group
  px-3 py-0.5">` and it already uses `group-hover:` to reveal a rich-mode reply button.
  Unreads previews render `MessageItem` non-interactively (no `onSelect`).
- **Row context / menu:** `MessageList` builds a `RowContext` (`selectedId`, `flashId`,
  `onSelect`, `onReply`, `onContextMenu`, `contactByPk`, `style`); right-click sets
  `menu` state and renders one `ContextMenu`
  ([src/renderer/components/ContextMenu.tsx](../../../src/renderer/components/ContextMenu.tsx)),
  a custom fixed-position menu with `menuItem`/`menuSeparator` + a
  `copyToClipboard(text, onDone?)` helper. `buildMessageMenuItems` builds Copy text /
  View contact / Re-send (failed) / Block sender.
- **Mentions:** `parseMessageContent` ([src/renderer/lib/messageContent.ts](../../../src/renderer/lib/messageContent.ts))
  tokenizes `@[name]`; `MentionPill` resolves it to a contact chip. The composer already
  exposes `ComposerHandle.insertMention(name)` inserting `@[name] ` at the caret
  ([src/renderer/components/Composer.tsx](../../../src/renderer/components/Composer.tsx));
  `MAX_MESSAGE_LENGTH = 132`.
- **View wiring:** `ChannelView`/`DMView` hold a `composerRef` and pass
  `onReply={(name) => composerRef.current?.insertMention(name)}` into `MessageList`.
  `onSelect` opens the right-rail message detail.
- **Paths:** `Message.meta.paths?: MessagePath[]`; `MessagePath.hops: MessageHop[]`,
  each `MessageHop.shortId` (prefix hex) + optional `name`. `firstPathStats`/
  `formatPathStats` ([src/renderer/lib/messagePath.ts](../../../src/renderer/lib/messagePath.ts))
  derive the compact meta label. `Message.meta` also has `rssi`, `snr`, `hops`.
- **UiState sync:** `UiState` ([src/shared/types.ts:733](../../../src/shared/types.ts)) is
  PUT whole (debounced) by `App.tsx` via `api.putUiState`; main
  (`holder.setUiState` → `settingsStore` + `emit.uiState`) stores + broadcasts it. The
  renderer's `applyUiState` ([src/renderer/lib/store.ts:710](../../../src/renderer/lib/store.ts))
  merges only a whitelist (`lastReadByKey`, `pinned`, `recentKeys`, `themePref`) from
  remote broadcasts — that whitelist is what makes a field **account-global**; adding a
  field there is a renderer-only change (main carries any new field automatically).
- **Renderer is HTTP-served by the app:** in dev the Vite dev server; in prod the app's
  Hono server serves `rendererDir` ([src/main/index.ts:127-129](../../../src/main/index.ts)).
  So Vite-emitted static assets are served at the renderer origin in **both** modes —
  frimousse can fetch bundled emoji data via a local URL without a bespoke route.
- **UI stack:** shadcn/ui "new-york" + Radix + Tailwind v4 + lucide-react; toasts via
  `sonner`. Installed primitives include `popover`, `tooltip`, `command`, `badge`,
  `separator`, and **`KeyValueRow`**. No `emoji-picker` component and no `frimousse` /
  `emojibase-data` dependency yet. All `cs-*` design tokens in the handoff already exist.

## Design

### 1. New feature module: `src/renderer/features/message-actions/`

- **`MessageQuickBar.tsx`** — the pill. Rendered by `MessageItem` for interactive rows
  only. Absolutely positioned `top:-14px; right:12px` inside the `group` container
  (which gains `relative`); hidden (`opacity-0 translate-y-[3px] pointer-events-none`),
  animates in on `group-hover` over 120 ms, and stays visible while a popover is open
  (local `open` state → `data-open`). Renders the **others** or **self** layout by
  `isSelf`. Reads frecent emojis + `recordEmojiUse` from the store; receives
  message-scoped callbacks from `RowContext`.
- **`EmojiPickerPopover.tsx`** — shadcn `Popover` (`side="top" align="end"
  sideOffset={8}`, 258px) containing: a frecency **"Frequently used"** row, the
  **frimousse** `EmojiPicker` (search + grid), and the footer note "Adds `@mention` +
  emoji to your reply — no separate reaction packet." `onEmojiSelect({ emoji })` →
  `recordEmojiUse(emoji)` + `onReact(sender, emoji)` + close.
- **`MessageInfoPopover.tsx`** — the Info popover (288px) for any message (see §6).
- **`MacroPanel.tsx`** — the all-macros "soon" popover (see §8).
- **`OverflowMenu.tsx`** — the merged `⋯` menu rendered in a `Popover` (see §7).
- **`frecency.ts`** — pure, unit-tested: `EmojiUsage = Record<string, { count; lastUsedMs
  }>`; `scoreEmoji(entry, now)`; `topEmojis(usage, now, n, seed)` (top-N by score,
  backfilled from `seed` to always return N, deduped/order-preserved); `recordUsage(usage,
  emoji, now)`. `SEED = ['👍','✅','📡','🔋','😂','❤️']`.
- **`paths.ts`** — pure, unit-tested: `formatPathHeard(path)` (hop `shortId`s joined by
  `,`); `formatFirstPathHeard(message)` (paths[0] or null); `formatAllPathsHeard(message)`
  (each path per line, or null). No-path → the item is omitted.
- **`quickBarData.ts`** — the seed macro list (`ACK`, `Copy that`, `SNR?`, `Relaying`,
  `QSY 910.5`, `ETA`) used by the "soon" macro UI.

### 2. QuickBar contents & styling (per handoff README)

- **Pill:** `flex items-center gap-1 rounded-lg border border-cs-border-strong bg-cs-bg-3
  p-1 px-1.5` + elevated shadow. Vertical `Separator` (`h-6 bg-cs-border`) between groups.
- **Others (left→right):** `ReactionRow` (5 ghost `icon-xs` emoji buttons, tooltip
  "Reply with {emoji}") + picker `＋` (ghost `icon-xs`) │ sep │ **Reply** (`secondary`,
  `h-7 px-2.5 text-[12px]`, reply icon + label) │ 2 `MacroChip`s + all-macros `⋯` (ghost
  `icon-xs`) │ sep │ **Copy** (ghost `icon-sm`, tooltip) │ **More** `⋯` (ghost `icon-sm`).
- **Self:** **Copy** (`secondary`, `h-7`, copy icon + "Copy") │ **Info** (ghost `icon-sm`)
  │ **Delete** (ghost `icon-sm`, `text-cs-danger hover:bg-cs-danger/10`).
- **Icons:** lucide (`SmilePlus`/`Plus`, `Reply`, `Copy`, `Info`, `Trash2`,
  `MoreHorizontal`, `Zap` for macro bolt, `KeyRound`, `MapPin`). Icon-only buttons get a
  `Tooltip` (~150 ms).
- Only one popover open per row at a time; open state pins the bar visible.

### 3. Reactions: inline frecent row + frimousse picker (offline via emojibase-data)

- Add **`frimousse`** (shadcn `emoji-picker` component at
  `src/renderer/components/ui/emoji-picker.tsx`) and **`emojibase-data`** dependencies.
- **Offline data (decided):** frimousse fetches `${emojibaseUrl}/${locale}/${file}.json`
  (`en/data.json` + `en/messages.json`). Since the renderer is HTTP-served by the app, we
  **copy those two files out of the `emojibase-data` package into the Vite renderer output
  at build time** (e.g. `vite-plugin-static-copy` reading `node_modules/emojibase-data/en/*`
  → `emoji/en/*`), and set `emojibaseUrl` to that origin path
  (`new URL('emoji', window.location.origin).toString()`). This uses the npm package as
  the single, version-pinned source of truth (no hand-copied JSON, nothing generated
  committed) and **needs no `resources/` extraResource or bespoke Hono route** — Vite's
  emitted assets are already served. Verify the exact requested files via the dev network
  tab during planning; add the `en` copy only (skip other locales).
- Inline `ReactionRow` = `topEmojis(emojiUsage, now, 5, SEED)`; the picker's "Frequently
  used" row uses the same. Selecting an emoji anywhere → `recordEmojiUse(emoji)` +
  `onReact`.

### 4. Reply / react / macro → composer + reply chip

- `ChannelView`/`DMView` gain `replyingTo: Message | null` local state (pane-level, not
  persisted) and pass it + handlers down.
- Handlers (all preserve the existing draft by inserting at the caret, reusing
  `insertMention`'s leading-space logic):
  - **react(m, emoji):** `setReplyingTo(m)` + `composer.insertReaction(sender, emoji)`
    (inserts `@[sender] emoji `) + focus.
  - **reply(m):** `setReplyingTo(m)` + `composer.insertMention(sender)` (`@[sender] `;
    no-op leading token if the draft already starts with it) + focus.
  - **macro(m, macro):** "soon" — no-op in v1 (the macro UI is a disabled placeholder).
    (When macros land: `insertReaction`-style insert of `@[sender] {macro.text} `.)
- **Reply-context chip** (in `Composer`, above the input, shown when `replyingTo`):
  `bg-cs-accent-soft text-cs-accent` pill "↩ Replying to **@{sender}**" + a clear (`✕`)
  control. Clearing removes `replyingTo` only (does **not** wipe the draft — a
  deliberate adaptation of the handoff's replace-model to the app's draft-backed
  composer). `replyingTo` also clears on successful send.

### 5. Composer changes

- Extend `ComposerHandle` with `insertReaction(senderName, content)` (inserts
  `@[senderName] content ` at the caret; same mechanics as `insertMention`).
- Add optional props `replyingTo?: { name: string } | null` and `onClearReply?: () =>
  void`; render the reply-context chip when set. Keep the **132** limit and existing
  airtime/counter UI. `onSend` clears `replyingTo` via the view.

### 6. Message Info popover (all messages)

`MessageInfoPopover` (288px, `side="top" align="end"`), built with existing `KeyValueRow`:
- Header "MESSAGE INFO"; body-preview box (`border cs-border`, `bg-cs-bg-3`).
- Rows: **From** (resolved sender name or "You"), **Public key** (`fromPublicKeyHex`,
  mono; "—" for self/unknown), **Hops** (`firstPathStats(m).hops`, mono), **RSSI / SNR**
  (`meta.rssi`/`meta.snr`, mono, shown when present), **State** (`m.state`, mono).
- **PATH** section (when `meta.paths?.[0]`): one numbered row per hop, `hop.name ??
  hop.shortId` (mono). Reuses the same hop data as `HeardVia`.
- Available on every message (Info button on self; for others it's reachable — see §7
  note). Read-only; no new IPC.

### 7. Overflow (`⋯`) menu — merged

`OverflowMenu` rendered in a `Popover` (`side="top" align="end"`, ~216px), item list
shared with the right-click `ContextMenu` via one builder. Items (others' messages):
- **View contact** — `setActiveKey('c:<pk>')` (real pubkey only).
- **Copy public key** — `copyToClipboard(fromPublicKeyHex)` + toast.
- **Copy first path heard** — `formatFirstPathHeard(m)` (shown only when non-null) + toast.
- **Copy all paths heard** — `formatAllPathsHeard(m)` (shown only when non-null) + toast.
- *(divider)* **Dismiss locally** — destructive, **"soon"** (disabled, opacity-45, "soon"
  badge); eventual local-only removal.
- Existing **Re-send** (failed) / **Block sender…** retained.
- Menu row styling per handoff `MoreList` (destructive = `cs-danger`; "soon" =
  disabled + badge).

> Info for others: since the inline bar for others has no Info button (handoff), the Info
> popover is still reachable via the existing right-rail message detail and (optionally) an
> Info row could be added to this overflow — decide during planning; not required for v1.

### 8. Macros — "soon" placeholder

- **Inline chips:** first 2 seed macros as `MacroChip`s (bolt icon + label), rendered
  disabled/"soon".
- **All-macros popover** (`MacroPanel`, 244px): header "REPLY MACROS" + outline **"soon"**
  badge; rows list the 6 seed macros (label + mono description), non-interactive.
- No macro insert wiring in v1 (the future macros feature adds it).

### 9. Store — `emojiUsage` (account-global)

- Add `emojiUsage: Record<string, { count: number; lastUsedMs: number }>` to `UiState` +
  `DEFAULT_UI_STATE` (`{}`) in [src/shared/types.ts](../../../src/shared/types.ts).
- Add `recordEmojiUse(emoji)` (via `frecency.recordUsage`) — mutating `ui.emojiUsage`
  triggers the existing debounced `putUiState` (persist + broadcast).
- Add `emojiUsage` to the account-global whitelist in `applyUiState`
  ([store.ts:710](../../../src/renderer/lib/store.ts)) — both the `same` idempotency
  check and the merged object.

### 10. Wiring in `ChannelView` / `DMView`

Both hold `composerRef` + `replyingTo` state. Thread through `MessageList` → `RowContext`
→ `MessageItem` → `MessageQuickBar`: `onReact(name, emoji)`, `onReply(name)` (exists),
`onCopyText(m)`, `onInfo(m)` (opens the Info popover — a bar-local popover, so mostly
self-contained), `onOverflow` handlers (view contact, copy key, copy paths, dismiss). Pass
`replyingTo`/`onClearReply` to `Composer`. Retire the standalone rich reply button in
`MessageItem`.

## Data flow (end to end)

1. Hover a row → `MessageQuickBar` fades in (120 ms), author-aware contents.
2. **Quick-react / picker emoji** → `recordEmojiUse(emoji)` (persist/broadcast) →
   `setReplyingTo(m)` + `insertReaction(sender, emoji)` → composer shows `@[sender] 🫡 `
   + the reply chip. Enter sends a normal mesh message; send clears `replyingTo`.
3. **Reply** → `setReplyingTo(m)` + `insertMention(sender)` + chip.
4. **Copy** → clipboard + toast. **Info** → Info popover from message fields.
5. **Overflow `⋯`** → View contact / Copy public key / Copy first/all paths / Dismiss
   (soon).
6. **Macros / Delete / Dismiss** → non-interactive "soon" placeholders.
7. Inline quick-react set recomputes from `emojiUsage` (top-5, seeded) as usage grows.

## Testing strategy (TDD)

- **Unit — `frecency.ts`:** score ordering (count vs recency), `topEmojis` top-N + seed
  backfill + dedupe/order, `recordUsage` increment + timestamp, empty-usage → full seed.
- **Unit — `paths.ts`:** comma-join order; first/all/no-path (null → omitted); multi-path
  newlines.
- **DOM — QuickBar:** hidden by default, revealed on hover; **others** vs **self**
  contents; quick-react click records usage + inserts `@[sender] emoji ` + sets the chip;
  picker select likewise; Reply inserts the mention; Copy → clipboard + toast; overflow
  items fire (view contact / copy key / copy paths); Info popover shows the right fields;
  macros/dismiss are disabled "soon"; Unreads previews render no bar; bar stays open while
  a popover is open. Use `flushSync` per the project's DOM-test timing note.
- **DOM — Composer:** `insertReaction` inserts at caret preserving a draft; reply chip
  shows/clears; clear keeps the draft.
- Baseline before/after: `pnpm typecheck` + `pnpm test` (green). Scope Biome to `src tests`.

## Open items to confirm during planning

- **frimousse specifics:** confirm the shadcn `emoji-picker` install; confirm the exact
  files/paths frimousse requests (`en/data.json`, `en/messages.json`) via the dev network
  tab; confirm `vite-plugin-static-copy` (or a small custom copy step) as the emit
  mechanism and that a `window.location.origin`-based `emojibaseUrl` resolves in dev + prod.
- **Info-for-others placement:** whether to add an Info row to the overflow menu for
  others' messages, or rely on the right-rail detail (not required for v1).
- **`settingsStore` persistence:** confirm `loadUiState`/`saveUiState`
  ([src/main/storage/settings.ts](../../../src/main/storage/settings.ts)) persists new
  `UiState` fields generically, or add `emojiUsage` to its schema.
- **Reply-chip lifecycle edge cases:** stale chip if the user deletes the mention text
  (cleared on send regardless) — acceptable for v1.
- **132-char interaction:** `@[LongName] 😀` consumes the budget (emoji = multiple UTF-16
  units); the composer already warns near the limit — no special handling planned.

## File-by-file change list

**Add**
- `src/renderer/features/message-actions/MessageQuickBar.tsx`
- `src/renderer/features/message-actions/EmojiPickerPopover.tsx`
- `src/renderer/features/message-actions/MessageInfoPopover.tsx`
- `src/renderer/features/message-actions/MacroPanel.tsx`
- `src/renderer/features/message-actions/OverflowMenu.tsx`
- `src/renderer/features/message-actions/frecency.ts` (+ unit test)
- `src/renderer/features/message-actions/paths.ts` (+ unit test)
- `src/renderer/features/message-actions/quickBarData.ts` (seed macros)
- `src/renderer/components/ui/emoji-picker.tsx` (shadcn/frimousse)

**Modify**
- `src/renderer/components/MessageItem.tsx` (mount `MessageQuickBar` for interactive rows;
  add `relative`; remove the standalone reply button; new callback props)
- `src/renderer/components/MessageRow.tsx` (thread new callbacks + frecency)
- `src/renderer/components/MessageList.tsx` (`RowContext` gains `onReact`/`onCopyText`/
  `onInfo`/overflow handlers; shared overflow item builder with right-click `ContextMenu`)
- `src/renderer/components/Composer.tsx` (`insertReaction`; reply-context chip;
  `replyingTo`/`onClearReply` props)
- `src/renderer/panels/ChannelView.tsx` (`replyingTo` state + react/reply wiring)
- `src/renderer/panels/DMView.tsx` (same)
- `src/renderer/lib/store.ts` (`recordEmojiUse`; add `emojiUsage` to `applyUiState`
  whitelist + idempotency check)
- `src/shared/types.ts` (`UiState.emojiUsage` + `DEFAULT_UI_STATE`)
- `src/main/storage/settings.ts` (only if it validates/whitelists `UiState` fields)
- `vite.renderer.config.mts` (static-copy of `emojibase-data/en/*` into the renderer
  output)
- `package.json` (`frimousse`, `emojibase-data`, and the copy plugin deps)
