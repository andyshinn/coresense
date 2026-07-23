# Text-Derived Mentions Bar — Design

- **Date:** 2026-07-20
- **Branch/worktree:** `worktree-feat+message-quick-actions`
- **Status:** Approved shape, pending spec review
- **Supersedes:** the `replyingTo` reply-context chip introduced in
  [2026-07-05-message-quick-actions-design.md](2026-07-05-message-quick-actions-design.md)

## Summary

Today the composer shows a **"Replying to `<name>`"** chip driven by a `replyingTo`
state value the views own. That state and the message text can drift: reply to
someone, delete the inserted `@[name]` from the text box, and the chip stubbornly
remains; mention a second person in the text and they never appear.

This change makes the bar a **pure function of the composer text**. The composer
parses its own current text for well-formed `@[Name]` mention tokens and renders one
static `@Name` chip per unique mention — **no label, no remove button**. Delete any
part of a mention (so it stops matching `@[…]`) and its chip disappears; type or insert
another mention and a new chip appears. The bar always reflects exactly who the message
actually mentions, at a glance.

Because `replyingTo` was never part of the send payload — the `@[name]` token *in the
body* is the only real signal — this is a net **simplification**: the state, its
per-conversation reset effect, and all `setReplyingTo(...)` calls are deleted.

## Goals

- The mentions bar is derived from the composer's current text, with **no independent
  state**.
- Deleting any part of an `@[Name]` token removes that name from the bar automatically.
- Adding/inserting another `@[Name]` adds it to the bar; the bar lists **all** unique
  mentioned users in first-appearance order.
- Chips are **display-only** (no `X`) and show **no leading label** — just a row of
  `@Name` chips.
- Chips mirror the app's existing mention convention: soft-accent for a name that
  resolves to a known contact, dim for an unknown name.
- Identical behavior in `ChannelView` and `DMView` (no DM special-casing).

## Non-Goals

- No change to the send payload, wire format, or reaction/reply mechanics — the
  Reply/react buttons still insert `@[Name]` (or `@[Name] <emoji>`) exactly as today.
- No click-to-navigate on the composer chips (unlike inline `MentionPill`, which
  navigates away from the conversation — inappropriate mid-compose).
- No per-chip remove affordance; removal is done by editing the text.
- No autocomplete/typeahead changes (that is a separate feature/worktree).

## Architecture

### 1. Pure derivation helper

Add to [src/renderer/lib/messageContent.ts](../../../src/renderer/lib/messageContent.ts),
co-located with the existing `parseMessageContent` tokenizer it builds on:

```ts
/** Ordered, de-duplicated names of every well-formed @[Name] mention in a body. */
export function mentionedNames(body: string): string[]
```

Implementation: run `parseMessageContent(body)`, keep tokens with `type === 'mention'`,
map to `.name`, and de-duplicate preserving first-appearance order (e.g. via a `Set`
seeded while iterating). It recognizes only **well-formed** `@[…]` tokens, so a
partially-deleted mention (`@[TLF` with the `]` removed) simply isn't a token and drops
out — this is the mechanism behind "delete part of a mention → removed from bar," with
no extra code.

This unit is pure and has one job: `string → string[]`. It is independently testable
and has no React or store dependency.

### 2. The bar (inside `Composer`)

[src/renderer/components/Composer.tsx](../../../src/renderer/components/Composer.tsx)
already owns `value` (the draft text, whether store-backed via `draftKey` or local).
It computes `mentionedNames(value)` on render and, when the list is non-empty, renders a
chip row above the `<textarea>`, replacing the old `replyingTo` chip block.

- **No label, no `X`.** Just the chips.
- Each chip renders `@Name`. To distinguish known vs unknown mentions, the Composer
  reads `contacts` from the store (it already uses the store for drafts) and styles each
  chip like `MentionPill`:
  - **known contact** (`contacts.some((c) => c.name === name)`): soft-accent chip
    (e.g. `bg-cs-accent-soft/20 text-cs-text`).
  - **unknown**: dim chip (e.g. `bg-cs-bg-3 text-cs-text-dim`).
- Chips are **static** (`<span>`, non-interactive) — no click handler, no focus trap.
- Hidden entirely (row not rendered) when there are no mentions.

The chip visual mirrors `MentionPill` but is intentionally a **separate, static
presentation** — `MentionPill` is a `<button>` that navigates to a contact, which must
not happen from inside the composer. A small local chip (inline in `Composer`, or a
tiny `MentionChip` helper) keeps that separation clear.

### 3. Removing the `replyingTo` machinery

`replyingTo` is deleted end-to-end:

- **Composer** ([Composer.tsx](../../../src/renderer/components/Composer.tsx)):
  - Remove the `replyingTo` and `onClearReply` props from `Props`.
  - Remove the old reply-context chip JSX block.
  - Remove now-unused imports (`Reply`, `X`).
- **ChannelView** ([ChannelView.tsx](../../../src/renderer/panels/ChannelView.tsx)) and
  **DMView** ([DMView.tsx](../../../src/renderer/panels/DMView.tsx)):
  - Delete the `const [replyingTo, setReplyingTo] = useState(...)`.
  - Delete the per-conversation reset `useEffect` that calls `setReplyingTo(null)` on
    `channel.key`/`contact.key` change (it existed only to clear this state).
  - Delete `setReplyingTo(null)` from `onSend`.
  - `handleReply` / `handleReact` reduce to just the `composerRef.current?.insertMention`
    / `insertReaction` call.
  - Remove the `replyingTo` / `onClearReply` props passed to `<Composer>`.

`ComposerHandle` (`insertMention` / `insertReaction`) is unchanged.

## Data Flow

```
Reply/react button ─▶ composerRef.insertMention("Air Force 1")
                          │  inserts "@[Air Force 1] " into draft text
                          ▼
   draft text (store or local)  ──────────  single source of truth
                          │
                          ▼
   Composer render: mentionedNames(value) = ["Air Force 1", ...]
                          │
                          ▼
   chip row: [ @Air Force 1 ] [ @TLF ] …   (known=accent, unknown=dim)

Edit text (delete "]", delete whole token, add "@[TLF] ") ─▶ re-derive ─▶ chips update
Send ─▶ draft cleared ("") ─▶ mentionedNames("") = [] ─▶ bar hidden
```

## Edge Cases

- **Duplicate mention** (`@[TLF] hi @[TLF]`): one chip (`TLF`), dedup by name.
- **Reaction insertion** (`@[Name] 👍 `): the `@[Name]` is a mention → one `Name` chip;
  the emoji is plain text and is ignored by the bar.
- **Malformed / partial token** (`@[TLF`, `@[]`): `@[TLF` is not a token → no chip;
  `@[]` matches `@\[[^\]]+\]`? No — `[^\]]+` requires ≥1 char, so `@[]` does not match →
  no empty chip.
- **Whitespace/self**: names are taken verbatim from the token; no filtering of the
  owner's own name (out of scope, and unlikely to be typed).
- **Draft persistence**: because the bar derives from `value`, switching conversations
  (which swaps `draftKey` → different draft) shows that conversation's mentions with no
  extra reset logic. This is strictly better than the old per-view `replyingTo` reset.

## Testing

**Unit** — `mentionedNames`, added to the existing
`tests/unit/renderer/lib/messageContent.test.ts`:
- `''` → `[]`
- one mention → `['Name']`
- several mentions → in first-appearance order
- duplicates → de-duplicated
- partially-deleted token (`'@[TLF'`) → `[]`
- reaction form (`'@[Name] 👍'`) → `['Name']`
- plain text with no mentions → `[]`

**Component** — Composer / view behavior:
- typing `@[TLF] ` shows a `@TLF` chip; deleting the `]` removes it.
- two mentions render two chips.
- clicking Reply/react (via the existing quick-bar wiring) produces the chip.
- known contact → accent chip; unknown name → dim chip.
- empty composer → no bar rendered.
- Update/replace existing tests that assert the old **"Replying to"** chip / `replyingTo`
  prop behavior. The known reference is
  `tests/component/composer-reactions.test.tsx` (asserts the "Replying to" chip appears
  after a reaction); re-point it at the new `@Name` chip.

## Files Touched

| File | Change |
|------|--------|
| `src/renderer/lib/messageContent.ts` | **add** `mentionedNames()` |
| `src/renderer/components/Composer.tsx` | derive + render chip row; drop `replyingTo`/`onClearReply` props and old chip block; drop `Reply`/`X` imports |
| `src/renderer/panels/ChannelView.tsx` | delete `replyingTo` state, reset effect, `setReplyingTo` calls, props |
| `src/renderer/panels/DMView.tsx` | same as ChannelView |
| tests (unit + component) | add `mentionedNames` tests; add composer chip tests; update old reply-chip tests |

## Rollback

Self-contained to the renderer composer/views plus one pure helper. Reverting the
commit restores the `replyingTo` chip with no data migration (nothing is persisted for
this feature beyond the draft text, which is unchanged in shape).
