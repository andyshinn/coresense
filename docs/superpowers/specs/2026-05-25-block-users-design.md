# Block users — design

**Status:** approved, ready for implementation plan
**Date:** 2026-05-25

## Problem

The MeshCore protocol has no concept of blocking on the radio. We need client-side blocking that lets the user silence noisy or unwanted senders across channels, DMs, search, and notifications.

Channel messages don't carry the sender's full public key — only an embedded `"name: body"` prefix plus a routing path of short pubkey-prefix hops. DMs carry a full `fromPublicKeyHex`. So blocking needs multiple rule types to cover both cases.

## Goals

- Block messages by full public key, public-key prefix, exact sender name, or sender-name regex.
- Right-click a message → block its sender via a single dialog pre-filled with whatever identifiers we have.
- Optionally retro-hide that sender's recent messages (default: last 24h) at block time.
- Manage existing rules (edit, disable, unblock, see match counts) from a new Settings tab.
- Reversible: removing a rule restores all previously hidden messages.

## Non-goals

- Per-conversation block scoping (global only).
- Body-content regex (only sender-name regex).
- AND-composite rules (each rule has one identifier).
- Destructive deletion of past messages.
- Cross-device sync of block rules.
- Any UI affordance to reveal hidden messages outside the Settings tab.

## Approach

**Approach A: Computed filter via rule list.** Rules live in a new persisted settings slice. No schema change to the messages table. Three gates evaluate rules at runtime:

1. **Notification gate** (main): before emitting toast / dock badge / OS notification / sound.
2. **Unread counter** (main): excludes blocked messages from unread totals.
3. **`getMessages` / search query path** (main): attaches `meta.blocked = true` and `meta.blockedByRuleId` per matching row.

Renderer filters rows where `meta.blocked === true` out of the rendered output. No divider, no count, no reveal affordance.

Retro-hide is modelled as a `tsFrom` field per rule — a rule matches a message iff its predicate holds *and* `msg.ts >= rule.tsFrom`. No bulk UPDATE; no schema migration.

Rejected alternatives:
- **Denormalized `blocked_by_rule_id` column on messages.** Requires a migration and a bulk UPDATE on every rule change; awkward when two rules match the same message.
- **Renderer-only filter.** Notifications and unread badges would stay unaware and ping for blocked senders.

## Data model

A new persisted slice `blockRules` lives in `userData/block-rules.json`, following the per-concern pattern in [settings.ts](src/main/storage/settings.ts). Each rule is atomic (one identifier per rule).

```ts
export type BlockRuleType = 'pubkey' | 'pubkeyPrefix' | 'name' | 'nameRegex';

export interface BlockRule {
  id: string;              // uuid
  type: BlockRuleType;
  // pubkey / pubkeyPrefix: lowercase hex, no separators
  // name: exact match (case-sensitive)
  // nameRegex: JS regex source string (no flags; matcher uses case-insensitive)
  pattern: string;
  createdAt: number;       // epoch ms
  tsFrom: number;          // matches messages where msg.ts >= tsFrom
  enabled: boolean;        // soft-off without delete
  note?: string;           // optional user note
  matchCount: number;      // bumped on each hide; flushed to disk on a debounce
}
```

Pushed to the renderer over the existing ws channel as a new event:

```ts
| { type: 'blockRules'; payload: BlockRule[] }
```

…and included in `StateSnapshot`.

**Notes:**
- No per-rule scope — global only.
- `pubkeyPrefix` matches both DM `fromPublicKeyHex.startsWith(pattern)` *and* the channel-message origin-hop `shortId.startsWith(pattern)`. One rule type covers both.
- `nameRegex` patterns are compiled once into a `Map<ruleId, RegExp>` cache on load. Invalid regex is logged, the rule is treated as disabled, and surfaced as "invalid — fix or delete" in the Blocked tab.
- `matchCount` is incremented **once per message** — at first-match time only, either when a new message arrives and the predicate evaluates true, or once per matching message during the rule-creation backfill scan. Per-query render-time filtering does **not** bump the counter (otherwise opening a conversation twice would double-count). Lives in memory; flushed to disk on a debounce (~30s) and on app quit.

## Match logic

A pure module `src/shared/blocking/match.ts` exports:

```ts
export interface BlockMatchHints {
  senderNameFromBody?: string;       // parsed once when channel msg is built
  contactNameByPk?: (pk: string) => string | undefined;
  originHopShortId?: string;         // lowercase hex
  originHopPk?: string;              // when path-origin hop has a resolved pk
}

export function isMessageBlocked(
  msg: Message,
  hints: BlockMatchHints,
  rules: BlockRule[],
  regexCache: Map<string, RegExp>,
): { blocked: boolean; ruleId?: string };
```

| Rule type      | DM message                                          | Channel message                                          |
|----------------|-----------------------------------------------------|----------------------------------------------------------|
| `pubkey`       | `fromPublicKeyHex === pattern`                      | `originHopPk === pattern` (only when resolved)           |
| `pubkeyPrefix` | `fromPublicKeyHex.startsWith(pattern)`              | `originHopShortId.startsWith(pattern)`                   |
| `name`         | `contactNameByPk(fromPk) === pattern`               | `senderNameFromBody === pattern`                         |
| `nameRegex`    | `regex.test(contactNameByPk(fromPk) ?? '')`         | `regex.test(senderNameFromBody ?? '')`                   |

All matches additionally require `msg.ts >= rule.tsFrom` and `rule.enabled === true`. Self-sent messages (no `fromPublicKeyHex`) never match. Disabled or invalid-regex rules are skipped.

Iteration order is `createdAt asc`; first hit wins for `ruleId` attribution and counter increment.

## Right-click flow + Block dialog

Right-clicking any message row adds one menu item: **Block sender…**.

The dialog pre-fills identifiers from the message:

```
┌─ Block sender ────────────────────────────┐
│  Create block rule(s) for this sender.     │
│                                            │
│  Identifiers from this message:            │
│  ☑ Public key   a3f9c2e8…b1                │  (greyed if unknown)
│  ☑ Key prefix   a3f9                       │  (greyed if no path)
│  ☑ Name         "Bob"                      │
│  ☐ Name regex   [^Bob.*$_____________]     │  (editable; pre-seeds escaped name)
│                                            │
│  ☑ Also hide past messages from last       │
│     [24h ▾]                                │
│                                            │
│  Note (optional)                           │
│  [____________________________________]    │
│                                            │
│              [ Cancel ]  [ Block ]         │
└────────────────────────────────────────────┘
```

**Behaviour:**
- Each checked identifier becomes its own atomic `BlockRule` — submitting with 3 boxes ticked writes 3 rules in one IPC round-trip.
- **Public key** pre-fill: ticked + enabled iff resolved (DM always; channel only when origin hop has `pk`).
- **Key prefix** pre-fill: ticked + enabled iff `originHopShortId` exists OR pubkey known (in which case prefix = first 4 hex chars of pubkey). Disabled with tooltip "no path yet" otherwise.
- **Name** pre-fill: ticked + enabled iff we have a name.
- **Name regex** pre-fill: unchecked; checking pre-fills `^<escaped name>$` as a starting point.
- **"Hide past messages"** controls `tsFrom`. Checked → `tsFrom = now - windowMs`. Unchecked → `tsFrom = now`. Dropdown: `1h / 24h / 7d / 30d / All` (where All = `0`).
- **Validation:** at least one identifier ticked (Block button disabled otherwise); if Name regex ticked, the regex must compile (inline error).
- **Wire:** new IPC `block:addRules(rules: BlockRule[])`. Main writes the file, pushes updated `blockRules` state.

## Settings → Blocked tab

A new tab in the existing Settings panel (see [SettingsPanel.tsx](src/renderer/panels/settings/SettingsPanel.tsx)).

```
┌─ Settings ───────────────────────────────────────────┐
│ General  Notifications  Radio  ...  [Blocked]        │
├──────────────────────────────────────────────────────┤
│  Blocked senders                                      │
│  Hide messages matching these rules everywhere.       │
│                                                       │
│  [ + Add rule ]                          [ 🔍 filter ]│
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │ Type    │ Pattern        │ Since │ Matches │  │   │
│  │ pubkey  │ a3f9…b1        │ 24h ago│ 12     │…│   │
│  │ prefix  │ a3f9           │ now    │  3     │…│   │
│  │ name    │ "Bob"          │ all    │  0     │…│   │
│  │ regex   │ ^spam.*$       │ now    │  4     │…│   │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  Empty: "No block rules yet. Right-click any message  │
│  and choose Block sender…, or click Add rule."        │
└──────────────────────────────────────────────────────┘
```

**Per-row affordances** (`…` menu):
- **Edit** — opens the same dialog shape as right-click, pre-populated from the rule (no message pre-fills).
- **Disable / Enable** — soft-off without delete. Flips `enabled`.
- **Unblock** — deletes the rule. Toast confirmation: "Unblocked."

**Add rule** uses the same dialog with no pre-fills; user picks one or more types and types patterns.

**Filter input:** local text filter over pattern / note columns. No persistence.

**Sort:** default `createdAt desc`. Column headers clickable for type / pattern / matches.

**Invalid regex display:** failing-to-compile regex rows show a red "invalid" badge and behave as disabled until edited.

## Renderer hide behavior

- **MessageList:** rows with `meta.blocked === true` are filtered out. No divider, no count, no reveal affordance.
- **Unreads panel:** blocked messages excluded from counts and preview cards.
- **Search panel:** blocked messages excluded from results. No toggle to include them.
- **Notifications:** `isMessageBlocked` gate runs before toast / dock badge / OS notification / sound in the main process.

The *only* surface that signals a rule is active is its `matchCount` in Settings → Blocked. The only path to recover hidden messages is to edit, disable, or delete the rule.

## Edge cases

1. **Owner's own messages** never match — `fromPublicKeyHex` is undefined for self-sent; predicate short-circuits.
2. **Rule edit (`tsFrom` backward, pattern change)** → re-evaluated on next query; affected messages appear or disappear naturally.
3. **Rule delete or disable** → instant un-hide on next state push.
4. **Path-less channel messages** (no `meta.paths`) can only be matched by `name` / `nameRegex`. `pubkey` / `pubkeyPrefix` silently no-op.
5. **DM from a blocked sender** → contact still appears in LeftNav; its conversation shows only non-matching messages. We do not hide the contact entry — doing so would require a reveal affordance, which contradicts the no-reveal rule.
6. **Multiple rules match one message** → first-hit rule (by `createdAt asc`) gets `matchCount` increment and `blockedByRuleId` attribution. Message stays hidden until *all* matching rules are removed/disabled.
7. **Performance:** predicate is O(rules) per message at query / notification time. Rules and regex cache loaded once. No per-render scan over history; matching only runs when messages are fetched, when new messages arrive, or when rules change.

## Wire / IPC additions

New `WsMessage` event:
```ts
| { type: 'blockRules'; payload: BlockRule[] }
```

`StateSnapshot` gains:
```ts
blockRules: BlockRule[];
```

New IPC actions (or equivalent HTTP routes — match existing convention):
- `block:addRules(rules: BlockRule[])` — append; returns updated list.
- `block:updateRule(id: string, patch: Partial<BlockRule>)` — edit pattern / note / tsFrom / enabled.
- `block:removeRule(id: string)` — delete.

## File-level changes (preview)

- **New:** `src/shared/blocking/match.ts` — pure `isMessageBlocked` + types.
- **New:** `src/main/blocking/store.ts` — persisted rule list, regex cache, counter debouncer.
- **New:** `src/main/storage/settings.ts` — add `loadBlockRules` / `saveBlockRules`.
- **New:** `src/renderer/panels/settings/Blocked.tsx` — Settings tab.
- **New:** `src/renderer/components/BlockSenderDialog.tsx` — shared dialog used by right-click + Add rule.
- **Edit:** `src/main/storage/messages.ts` — apply hints + rules in the `getMessages` path; attach `meta.blocked` + `meta.blockedByRuleId`.
- **Edit:** the notification dispatch site in main — locate via `grep -r "appSettings.notifications"` in `src/main/`.
- **Edit:** the unread counter site — locate via `grep -r "unread" src/main/storage/` and `lastReadByKey` consumers.
- **Edit:** `src/shared/types.ts` — `MessageMeta.blocked`, `MessageMeta.blockedByRuleId`, `StateSnapshot.blockRules`, `WsMessage` variant.
- **Edit:** `src/renderer/panels/settings/SettingsPanel.tsx` — register Blocked tab.
- **Edit:** message row component(s) — context menu entry "Block sender…".

## Testing

- Unit: `isMessageBlocked` truth table per rule type × DM/channel × edge cases (self, no path, disabled, invalid regex, ts boundary).
- Unit: regex cache invalidation on rule edit/delete.
- Integration: round-trip a rule add → push to renderer → MessageList re-renders without blocked rows.
- Integration: notification gate suppresses for blocked senders.
- Integration: `matchCount` debounce — bump several hides, confirm single flush, confirm persisted value on reload.
- Manual: right-click flow on a channel message vs DM, verify pre-fills.
