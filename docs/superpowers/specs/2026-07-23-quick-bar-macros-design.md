# Quick Bar Macros — Wiring the Placeholder to Real Macros — Design

- **Date:** 2026-07-23
- **Branch/worktree:** `feat/custom-macros` (`.claude/worktrees/feat+custom-macros`)
- **Status:** Approved shape, pending spec review
- **Design reference:** [`.design-ref/macros/mac-incontext.jsx`](../../../.design-ref/macros/mac-incontext.jsx)
  — panel **B · Quick-reply menu** (row shape, char counter, header). Recreate, don't
  copy verbatim; the mockup's standalone 360px menu is adapted to the quick bar's
  anchored popover.
- **Supersedes (in part):** [2026-07-05-message-quick-actions-design.md](2026-07-05-message-quick-actions-design.md)
  §8 "Macros — soon placeholder".

## Summary

PR #9 shipped the message quick bar with its macro affordances as **non-functional
"soon" placeholders**: two disabled `MacroChip`s and a `MacroPanel` listing six
hardcoded `SEED_MACROS`. PR #7 (this branch) shipped the macros backend, HTTP API,
store slice, library and studio. The two were rebased together but never connected.

This change connects them. The two inline chips become the user's **most-frecent
applicable macros**; the panel lists every macro that applies to the conversation,
each row showing its **rendered output and character count against the 132-char
MeshCore limit**. Clicking either **inserts the rendered text into the composer** as
`@[sender] <text> ` — it does not transmit.

During the rebase the branch's own in-chat entry point (`QuickReplyMenu`) lost its
mount point in favour of main's quick bar. It is the reference implementation to
cannibalise; it is retired by this change.

## Goals

- Two inline `MacroChip`s driven by **frecency**, mirroring how `ReactionRow` already
  auto-pins the top-5 emoji from the same folder's `frecency.ts`.
- `MacroPanel` lists the macros **applicable to this conversation**, each row showing
  name + rendered output + `Nc` counter (red past 132).
- Clicking a chip or a row **inserts** the rendered text at the composer caret via the
  existing `insertReaction(name, content)` path. No transmit.
- Macro usage persisted account-global (`UiState.macroUsage`), synced through the same
  `applyUiState` subset that carries `emojiUsage`.
- Retire `QuickReplyMenu.tsx`, its test, `quickBarData.ts`, and `sendMacroReply`.

## Non-goals

- **Transmitting** a macro. Nothing in the quick bar sends; `sendMacroReply` is deleted
  rather than rewired.
- Pin/favourite UI in the Macros library — frecency covers ordering without new
  library surface.
- Segment-coloured render previews (dim placeholders, warn for unavailable) as the
  mockup shows. `POST /api/macros/render` returns plain text only; the preview is plain
  text with `?` placeholders. Colour would need a new segment-returning endpoint.
- Re-mounting `QuickReplyMenu` or restoring the retired `quickReply` prop slot.
- Changing the quick bar's layout, its other popovers, or message-row rendering.

## Decisions

| Decision | Choice |
| --- | --- |
| Click action | **Insert into composer** (`@[sender] <rendered> `), not transmit — consistent with emoji/Reply in the same pill, and the user sees the 132-char counter before spending airtime |
| Inline chip contents | **Most-frecent** applicable macros, backfilled by store order |
| Panel row contents | **Rendered output + `Nc` counter**, per the mockup; raw `<Snippet>` as the loading/error fallback |
| Frecency storage | Account-global `UiState.macroUsage`, in the `applyUiState` synced subset |
| Scope filtering | Panel and chips show `global` macros plus `channel`/`contact` macros whose key matches the message's conversation key |
| `client` delivery | Prop-threaded from `MessageList`'s existing `RowContext` — no new React context |
| `sendMacroReply` | **Deleted** (dead once nothing transmits) |

## 1. Data flow

`client` already reaches `MessageList` and is already carried in its `RowContext`, but
stops there. Thread it one hop further, alongside a new insert callback:

```
ChannelView / DMView   handleMacro(name, text) → composerRef.current?.insertReaction(name, text)
  └ MessageList        RowContext { …, client, onMacro }      ← client already present
      └ MessageRow     client, onMacro                        ← new pass-through
          └ MessageItem      client?, onMacro?                ← optional: Unreads previews pass neither
              └ MessageQuickBar   client, onMacro
                  ├ MacroChip  ×2
                  └ MacroPanel
```

`handleMacro` is a two-line sibling of the existing `handleReact` in both
`ChannelView` and `DMView`, reusing `insertReaction(name, content)` unchanged. No new
Composer imperative API.

`MessagesTab` (repeater-admin) renders `MessageList` without `onReact`, so
`MessageItem` renders no quick bar there and nothing changes for it.

### `MacroPanel` props

`{ open, onOpenChange }` stay first so `MessageQuickBar`'s `P('macro')` spread keeps
working, matching `EmojiPickerPopover` / `OverflowMenu` / `MessageInfoPopover`:

```ts
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  macros: MacroTemplate[];        // already scope-filtered by the caller
  client: ApiClient | null;
  message: Message;
  /** Rendered text is passed through when the row already previewed it. */
  onPick: (macro: MacroTemplate, renderedText?: string) => void;
  children: ReactNode;
}
```

## 2. Which macros apply — `features/message-actions/macroPicks.ts`

A new pure module, no React, unit-testable directly:

```ts
/** Macros valid for one conversation: global always, scoped ones only on their key. */
export function applicableMacros(macros: MacroTemplate[], conversationKey: string): MacroTemplate[];

/** Stable frecency sort — unused macros (score 0) keep store order. */
export function topMacros(macros: MacroTemplate[], usage: UsageMap, nowMs: number, n: number): MacroTemplate[];
```

`applicableMacros` matches `macro.channelKey` / `macro.contactKey` against the
message's `key` (`ch:…` for channel messages, `c:<pk>` for DMs — the same keyspace the
macro store persists). Today `QuickReplyMenu` lists **every** macro regardless of
scope, so a contact-scoped macro shows on channel messages; this closes that gap
rather than porting it forward.

`topMacros` relies on `Array.prototype.sort` being stable: ranking by descending
frecency score leaves all-zero (never used) macros in their original store order, so
"most-frecent, else the first two" falls out of one sort with no separate seed list.

## 3. Frecency generalization

`frecency.ts` is emoji-shaped only in its identifiers — the algorithm is already
generic over string keys.

**`src/shared/types.ts`**

```ts
export interface UsageEntry { count: number; lastUsedMs: number }   // was EmojiUse
export type UsageMap = Record<string, UsageEntry>;                  // was EmojiUsage
```

`UiState` gains `macroUsage: UsageMap` (macro id → entry) next to `emojiUsage`, and
`DEFAULT_UI_STATE` gains `macroUsage: {}`. `settingsStore.loadUiState` already runs
`mergeDefaults`, so existing `ui-state.json` files backfill the field on read — no
migration step.

**`features/message-actions/frecency.ts`** — `scoreEmoji` → `score`, `topEmojis` →
`topIds`, typed on `UsageEntry` / `UsageMap`. `score` tolerates `undefined` so
`topMacros` can score a macro with no history. `recordUsage` is already generic and
keeps its name. `EMOJI_SEED` stays. `ReactionRow` updates to `topIds`.

**`lib/store.ts`** — `recordMacroUse(id)` mirroring `recordEmojiUse`. `macroUsage`
joins the `applyUiState` synced subset (both the equality guard and the merge), and
`emojiUsageEqual` is renamed `usageMapEqual` and applied to both maps. Without this
the field would persist but never propagate between windows.

Macros deleted from the library leave orphan `macroUsage` entries. `topMacros` only
ever ranks macros that currently exist, so orphans are inert — no cleanup pass.

## 4. Rendering previews

**`panels/macros/lib/inchat.ts`** gains the reply-mode sibling of the existing
`expandMacro`:

```ts
/** Render a macro against a received message's reply context. Toasts on failure. */
export async function expandMacroReply(
  client: ApiClient | null,
  macro: MacroTemplate,
  message: { id: string },
): Promise<string | null>;
```

`sendMacroReply` is deleted in the same edit — it is the only "send a macro" path and
nothing calls it once `QuickReplyMenu` is gone.

**`panels/macros/lib/useReplyPreviews.ts`** — a hook that, on the panel's
closed→open transition, fires one `api.renderMacro({ macroId, mode: 'reply',
messageId, placeholder: '?' })` per applicable macro in parallel and keys the results
by macro id:

```ts
type PreviewState =
  | { status: 'loading' }
  | { status: 'ok'; text: string; len: number }
  | { status: 'error'; message: string };
```

The batch re-fires when `open` goes false→true, and while open when `message.id` or
the applicable-macro id list changes (a macro edited or deleted in the library
broadcasts over the WebSocket and re-renders the panel). Previews are never cached
across opens: reply context includes time-varying values (`received_ago`,
`peer_last_seen`), so a cached preview would drift from what actually gets inserted.
Requests are local HTTP to the app's own main process against a render-limited Liquid
engine, so a full re-fetch is cheap; no cap is imposed on the number of macros
previewed.

A stale-response guard (a cancelled flag set by the effect's cleanup) prevents a slow
batch from overwriting a newer one.

## 5. Panel and chip presentation

**Panel** — width 244px → **300px** to fit the counter column. Header loses the `soon`
badge and becomes `REPLY MACROS` (existing `text-[10px] uppercase tracking-wider
text-cs-text-dim` treatment) with a right-aligned `vs this message` hint, per the
mockup. `disabled` / `opacity-60` / `cursor-default` are dropped throughout; the list
scrolls at `max-h-64`.

The panel lists **all** applicable macros, including the two already on chips. The
chips are shortcuts, not a partition — de-duplicating would make the panel's contents
silently reshuffle as frecency shifts.

Each row is a button: macro name on the first line with the counter right-aligned
(`font-mono text-[9.5px]`, `text-cs-danger` when `len > MAX_MESSAGE_LENGTH`), and a
truncated second line by preview state:

| State | Second line |
| --- | --- |
| `loading` | existing `<Snippet template={m.template} />` — instant, syntax-coloured, no dead space or layout hole |
| `ok` | rendered text, dim; counter shown |
| `error` | `<Snippet>` plus the truncated error in `text-cs-danger`; the row stays clickable and re-renders on click |

**Chips** — `MacroChip` takes `{ macro, onPick }` instead of `{ label }`, renders the
bolt + `macro.name` truncated (`max-w-[92px] truncate`), and picks up the hover
treatment already used by the bar's Reply button.

**Empty states** distinguish the two cases:

- store has no macros at all → *"No macros yet — create one in the Macros tool."*
  (`QuickReplyMenu`'s wording, preserved)
- macros exist but none apply here → *"No macros for this conversation."*

## 6. Click behaviour

```
row click   → text already previewed?  yes → insert it (no second round-trip)
                                        no → expandMacroReply(), then insert
chip click  → expandMacroReply(), then insert          (chips are never previewed)

insert = recordMacroUse(macro.id); onMacro(senderName, text); close panel
```

A `busy` guard (ported from `QuickReplyMenu`) prevents a double-click from firing two
renders. `expandMacroReply` returning `null` (render failure — already toasted) aborts
before `recordMacroUse`, so a failed macro doesn't gain frecency weight.

**`MAX_MESSAGE_LENGTH`** moves from `components/Composer.tsx` to a new
`lib/messageLimits.ts` so `MacroPanel` can import the limit without pulling in the
composer tree. Nothing outside `Composer.tsx` imports it today, so this is a clean
move, not a re-export.

## 7. Inherited behaviour, deliberately unchanged

- **Unresolved sender** (`senderName === ''`, e.g. a channel message whose origin name
  didn't decode): emoji and Reply already silently no-op to avoid inserting `@[] `.
  Macro clicks match that guard rather than special-casing a mention-less insert.
- **No client** (`client == null`): the macro cluster — both chips and the `⋯` button —
  is omitted, since nothing can render. The rest of the bar is untouched.
- **Self messages:** unchanged. The macro cluster is in the `!isSelf` branch and stays
  there; reply macros are about received messages.

## 8. Removals

| Path | Reason |
| --- | --- |
| `src/renderer/panels/macros/inchat/QuickReplyMenu.tsx` | Unmounted since the rebase; its logic moves into `MacroPanel` |
| `tests/component/macros/QuickReplyMenu.test.tsx` | Covers the retired component |
| `src/renderer/features/message-actions/quickBarData.ts` | Whole file — `SEED_MACROS` and its `Macro` type have no other consumers |
| `sendMacroReply` in `panels/macros/lib/inchat.ts` | Dead once nothing transmits |

## 9. Testing (Vitest)

**New**

- `tests/unit/renderer/features/message-actions/macroPicks.test.ts` — `applicableMacros`
  keeps globals, admits a matching `channelKey`/`contactKey`, rejects a non-matching
  one; `topMacros` orders by frecency and falls back to store order for unused macros
  (the stable-sort guarantee).
- `tests/unit/renderer/lib/macro-usage-store.test.ts` — `recordMacroUse` bumps
  count + `lastUsedMs`, mirroring `emoji-usage-store.test.ts`.

**Rewritten**

- `tests/component/macro-panel.test.tsx` — currently asserts the `soon` badge and
  `ACK`. Becomes: lists real store macros; shows rendered preview + counter once
  `renderMacro` resolves; flags an over-132 render; both empty states; a row click
  calls `onPick` with the already-rendered text and issues no second `renderMacro`.

**Updated**

- `tests/component/message-quick-bar.test.tsx` — two most-frecent chips render; a chip
  click renders, records usage, and calls `onMacro(senderName, text)`; `client == null`
  hides the macro cluster.
- `tests/unit/renderer/features/message-actions/frecency.test.ts` — `score` / `topIds`
  renames, `UsageMap` type.
- `tests/component/message-item-quick-bar.test.tsx` — `client` / `onMacro`
  pass-through.

## 10. Verification

Run from the worktree via `npx`, not `pnpm <script>` (pnpm's deps-check reflink-fails
in worktrees):

```
npx vitest run
npx tsc --noEmit
npx biome check src tests
```

Renderer-only change — no `@andyshinn/meshcore-ts` imports (Node-only).
