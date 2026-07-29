# Repeater CLI — Autocomplete, Queue, and Reboot-Pending — Design

- **Date:** 2026-07-28
- **Branch/worktree:** `worktree-cli-autocomplete` (`.claude/worktrees/cli-autocomplete`)
- **Status:** Approved shape, pending spec review
- **Design reference:** [`.design-ref/cli-autocomplete/`](../../../.design-ref/cli-autocomplete/)
  — `cli-data.js` (91-command catalog), `cli-engine.js` (parse/match/suggest/airtime),
  `cli-palette.jsx`, `cli-prompt.jsx`, `cli-transcript.jsx`, `cli-reboot.jsx`,
  `cli-icons.jsx`, `cli-app.jsx` (wiring). Recreate, don't copy: the mockup is a
  browser-global demo against a fake repeater, and several of its assumptions are
  contradicted by firmware ([§0](#0-ground-truth)).
- **Depends on:** a `@andyshinn/meshcore-ts` release adding `expectReply` and `signal`
  to `repeaterSendCli` ([§7.1](#71-meshcore-ts-external-prerequisite)). Phases 1 and 2
  ([§12](#12-phasing)) do not need it.
- **Library baseline:** verified against the installed `@andyshinn/meshcore-ts@0.4.0`
  — `repeaterSendCli(contactKey, command): Promise<string>` (`dist/index.d.ts:2178`,
  no options bag), `CLI_REPLY_TIMEOUT_MS = 30_000` (`dist/index.js:3593`), `pendingCli`
  keyed on `contact.publicKeyHex.slice(0, 12)` with the older command rejected as
  `superseded by newer CLI command` (`dist/index.js:3852-3866`). §7.1 is the diff
  against this.

## Summary

The repeater CLI tab is 98 lines: a bare `<input>`, a `$ cmd` / reply log, two
hardcoded suggestion chips, and a `busy` lock that dead-locks the prompt for the full
30-second reply timeout with no cancel and no explanation. There is no command catalog
anywhere in the repo, no history recall, no keyboard handling of any kind, and no way
to tell a timeout from a refusal.

This change rebuilds it as a real console: a ranked, grouped, keyboard-driven
suggestion palette over a 91-command catalog carrying the metadata that actually
matters over LoRa; shell-style history with reverse-i-search; a client-side FIFO queue
in front of a library that allows one outstanding command per repeater; an honest
in-flight and timeout story; and persistent tracking of settings written to a node but
not yet applied.

`{{ liquid }}` variables, filters, and `/macro` expansion are **out of scope**, though
the engine for all three already ships on `main` (`src/shared/macros/`). The parse
layer leaves room for them.

## Goals

- A **command catalog** in `src/shared/repeater-cli/catalog.ts`, reconciled against
  firmware source, carrying group, description, argument shapes, enums with per-value
  descriptions, presets, `get`/`set` pairing, firmware floor, serial-only / no-reply /
  reboot-required / destructive flags, and the operational note explaining the trap.
- A **ranked palette** — prefix › word-start › substring › subsequence › description,
  with a recency boost scoped to the repeater in front of you, and serial-only commands
  sunk into a trailing "Not available over radio" group rather than hidden.
- **Context-aware completion**: command names in the leading token, argument values
  (enums, presets, and the value the node last reported) after one.
- **Shell keyboard**: ghost completion, `Tab` to longest common prefix then to the top
  suggestion, `↑`/`↓` history with draft preservation, `⌃R` reverse-i-search,
  `⌃Space`, `⌃L`.
- **A queue that matches the transport**: one command in flight, the rest visibly
  queued and cancellable, aborted cleanly on repeater switch.
- **An honest transcript**: elapsed time and airtime estimate while waiting, duration
  on completion, firmware `Err -` replies distinguished from transport failures,
  timeouts explained rather than dumped.
- **Reboot-pending as unsaved-changes state** — persisted per repeater public key,
  demoting rather than disappearing when dismissed.
- **A usable read-only mode**: the palette and command reference work without an admin
  session, because they are worth reading even when you cannot send.

## Non-goals

- `{{ variables }}`, Liquid filters, the "On air" expansion strip, `/macro` expansion.
- Multi-frame or streaming replies. Firmware sends exactly one packet (§0).
- Per-message SNR on CLI replies (§5.3).
- A right-rail command reference. The CLI tab's right-rail slot is free
  (`src/renderer/shell/rightrail/sectionsFor.tsx:165` special-cases only
  `'neighbours'`), but the two-pane palette detail already covers the need.
- Local-device (serial) CLI. This is the over-the-air repeater path only.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Scope = autocomplete + transcript + reboot-pending; liquid/macros deferred | Liquid couples this branch to a separate feature surface for no gain here |
| 2 | Fire-and-forget lands as a real `meshcore-ts` API, not a shim | We own the library; a main-process workaround leaves `pendingCli` wrong and needs cleanup |
| 3 | Guest: tab browsable, sending blocked | The catalog is a useful reference logged out; hiding the tab throws that away |
| 4 | Client-side FIFO queue | Prevents this UI from colliding with itself; see the caveat below |
| 5 | Packet Log and Reload move off `mod+L` / `mod+R`, freeing `⌃L` / `⌃R` | Shell muscle memory beats two developer-adjacent app shortcuts; registering both in `SHORTCUTS` makes the collision visible |
| 6 | Catalog ported from the mockup, reconciled against vendored firmware | Nothing exists in-repo; the mockup is the most complete artifact, firmware is the authority |
| 7 | Firmware floors annotate, never gate | Login gives `firmwareVerLevel: number \| null`, not a semver; a mapping table would silently rot |
| 8 | Two-pane palette detail, folding to inline under 560px | Params, defaults, on-node value, and note need somewhere to live that isn't a hover |
| 9 | Pure reducer for the prompt state machine | The keyboard logic is the bug surface; a pure function makes it exhaustively testable without a DOM |
| 10 | Hand-rolled list rows, no `cmdk` | `cmdk@1.1.1`'s controlled-`value` mode is broken for this usage (§4.1) and we need none of what it provides |
| 11 | One spec, three sequenced plans | ~25–30 tasks against a repo whose largest plan is 12 (§12) |

**Caveat on #4.** `pendingCli` is main-process, session-scoped, and keyed by pubkey
prefix, while the FIFO is component-local and destroyed by the deliberate remount at
`src/renderer/panels/repeater-admin/index.tsx:144`. Supersede can still fire from a
second window, an external loopback client, or a remount-plus-resend inside the
timeout window — and it rejects the **older** command. §5.4 gives it a treatment.

## 0. Ground truth

Verified by opening the vendored firmware and the shipped transport. These facts are
why the design departs from the mockup, and they belong in code comments.

**All mesh CLI is admin-only, in firmware.**
`docs/firmware/MyMeshRepeater.cpp:685` dispatches CLI only when `client->isAdmin()`.
A guest-authenticated client gets **silence**, not a refusal, which today surfaces as
a 30-second timeout with no explanation. Admin is therefore a **tab-level** condition,
not the per-command chip the mockup models.

**Replies are a single packet, ≤160 bytes.**
`MyMeshRepeater.cpp:716-718` — `uint8_t temp[166]` with a five-byte header. There is
no multi-frame reply, so the mockup's streaming reveal and per-command `rx: 3` frame
counts are fiction. `neighbors` in particular overflows and is truncated.

**An empty reply means no packet is sent.**
`MyMeshRepeater.cpp:725` — `if (text_len > 0)`. In the vendored repeater file exactly
one path is reachable over the air: a retry carrying an identical `sender_timestamp`
(`:693`, `:719-720`). Two other empty-reply branches are **not** mesh-reachable as
written — the `get acl` branch is guarded by `sender_timestamp == 0` and prints to
`Serial` (`:1234-1244`), and the `region_load_active` branch (`:1198`) is only entered
from an un-vendored region-load command. Over the air, `get acl` falls through to
`_cli.handleCommand()` (`:1255`) in the un-vendored `CommonCLI.cpp`, so its
behaviour is **unknown** until that file is reconciled (§1.2). Do not describe it as
guaranteed silence.

**Command length is not currently capped.**
`src/renderer/lib/messageLimits.ts:4` defines `MAX_MESSAGE_LENGTH = 132` — documented
as *characters* of an outgoing text message body, and consumed only by `Composer.tsx`
and `MacroPanel.tsx`. Today's CLI input has no `maxLength` and no validation, so
nothing caps a CLI command. **This design applies the same 132-character cap at the
prompt**, which is what makes the single-outbound-frame conclusion below hold.

**Airtime is effectively constant per command.** With the cap above applied, commands
are single-frame and replies are single-frame, so round-trip cost is a function of
spreading factor, bandwidth, and hop count only. A per-row airtime chip would print
the same number 91 times; one estimate on the prompt and one in the detail pane is the
honest presentation.

**One outstanding CLI command per repeater.** `meshcore-ts@0.4.0` keys `pendingCli` on
`contact.publicKeyHex.slice(0, 12)`; a second command rejects the **older** one with
`superseded by newer CLI command`. Reply timeout is `CLI_REPLY_TIMEOUT_MS = 30_000`
(`dist/index.js:3593, 3852-3866`). The library's own choice of `publicKeyHex` is why
§2.6 keys persistence the same way.

**No command catalog exists anywhere.** Not in `src/`, not in `@andyshinn/meshcore-ts`
(its `CMD` export is binary companion-frame opcodes for the locally attached node — a
disjoint vocabulary; overlaps like `REBOOT` are coincidental). The vendored
`MyMeshRepeater.cpp` implements only three repeater-local commands (`setperm` `:1212`,
`get acl` `:1234`, `discover.neighbors` `:1245`); everything else lives in
`helpers/CommonCLI.cpp`, which is **not vendored**.

## 1. Command catalog

`src/shared/repeater-cli/catalog.ts` — pure data and types, no React, no renderer
imports. In `shared/` mirroring `src/shared/macros/manifest.ts`.

```ts
export type CliGroup =
  | 'Operational' | 'Neighbors' | 'Statistics' | 'Logging' | 'Info'
  | 'Radio' | 'System' | 'Routing' | 'ACL' | 'Region' | 'GPS';

export interface CliArg {
  name: string;
  hint?: string;                    // '5–12', 'MHz', 'companion public key'
  enum?: string[];
  enumDesc?: Record<string, string>;
  range?: [number, number];         // rendered in the detail pane; no validation
}

export interface CliPreset { value: string; label: string; note?: string }

export interface CliCommand {
  name: string;                     // 'set radio' — longest match wins over 'set'
  group: CliGroup;
  desc: string;
  spec?: string;                    // '<freq>,<bw>,<sf>,<cr>' — ghost + detail hint
  args?: CliArg[];
  presets?: CliPreset[];
  key?: string;                     // pairs get/set, drives "on node now"
  replyValue?: RegExp;              // extracts the bare value from a get reply (§2.3)
  def?: string;
  serialOnly?: true;
  noReply?: true;
  reboot?: true;
  danger?: true;
  fw?: string;                      // annotation only, never gates
  deprecated?: string;
  experimental?: true;
  note?: string;
}

export const CLI_COMMANDS: readonly CliCommand[];
export const CLI_GROUP_ORDER: readonly CliGroup[];
export const CLI_BY_NAME: Readonly<Record<string, CliCommand>>;
```

`CliArg.range` renders as a hint in the detail pane and is not validated — the prompt
never blocks a command, since firmware is the authority. `alias` from the mockup is
dropped: nothing consumes it.

### 1.1 Departures from the mockup's `cli-data.js`

- **`admin` dropped** — firmware gates all mesh CLI on admin (§0), a tab condition.
- **`rx` (reply frame count) dropped** — replies are always one packet.
- **`fw` annotates only** — a `v1.14.1+` chip and a detail-pane line; never dims,
  sorts, or blocks.

### 1.2 Reconciliation against firmware — a pre-plan gate

`cli-data.js` was distilled from `docs.meshcore.io/cli_commands/` — documentation, not
source. It must be reconciled against the dispatcher in `helpers/CommonCLI.cpp`,
vendored into `docs/firmware/` beside the two `.cpp` files already there, together
with a `docs/firmware/PROVENANCE.md` recording the upstream repo and commit for all
three.

Per command, five checks: the name exists; argument count and order match; enum values
match; `serialOnly` matches whether the handler is reachable from the mesh path;
`noReply` matches whether the handler writes into `reply` before returning. Commands in
firmware but not the catalog are added; catalog entries with no firmware handler are
removed and noted.

**`CommonCLI.cpp` is not in the repo and the implementation shell is
network-sandboxed.** Fetch it (`WebFetch` against the raw upstream URL) or drop it in
manually. **This is a gate on phase 1, not a task inside it**: the outcome must be
recorded before the phase-1 plan is written.

**Pre-decided fallback** if it cannot be obtained: ship the catalog with **no command
marked `noReply`** and a header comment stating it is documentation-derived and
unverified. A wrongly-absent `noReply` costs a 30-second wait; a wrongly-present one
reports success for a command that failed. Bias to the former.

## 2. Pure logic layer

`src/renderer/panels/repeater-admin/cli/lib/` — pure functions over plain data,
unit-tested with no DOM, following `src/renderer/panels/macros/lib/autocomplete.ts`.

### 2.1 `parse.ts`

```ts
export type CliParse =
  | { mode: 'command'; token: string; start: 0 }
  | { mode: 'arg'; cmd: CliCommand; argIndex: number; token: string; start: number };

export function parseCliLine(text: string, caret: number): CliParse;
```

Considers only text up to the caret. **Exact equality with a command name stays in
`command` mode**, with the whole prefix as the token — `⌃Space` on a complete name
must offer sibling commands, not arguments nobody has started typing. Only
`name + ' '` enters `arg` mode, and the **longest** such match wins: `set radio 869`
parses as arguments to `set radio`, never to `set`.

The mockup's `variable`, `filter`, and `macro` modes are omitted. The discriminated
union makes adding them additive.

### 2.2 `match.ts`

```ts
export interface CliMatch { score: number; ranges: [number, number][] }
export function matchCommand(query: string, cmd: CliCommand): CliMatch | null;
export function commonPrefix(items: { label: string }[]): string | null;
```

| Tier | Score | Example |
|---|---|---|
| **Empty query** | `1` | `⌃Space` browse — every command ties |
| Prefix | `1000 − name.length` | `set r` → `set radio` |
| Word start (after space, `.`, `-`) | `700 − len` | `radio` → `set radio` |
| Mid-substring | `450 − len` | `ycle` → `set dutycycle` |
| Subsequence | `300 − len` | `sdc` → `set dutycycle` |
| Description hit | `120 − len` | `battery` → `set adc.multiplier` |
| No match | `null` | |

The empty-query row is load-bearing: without it every command would prefix-match at
`1000 − len`, ordering the browse list by name length and swamping the recency bonus
that populates "Recent on this node". At `score: 1` the recency bonus dominates and
`Array.prototype.sort` stability preserves catalog order for the rest.

`ranges` are merged spans for highlighting; description-only hits highlight nothing.
`commonPrefix` is case-insensitive, **computed over non-`serialOnly` items only** —
otherwise one sunk serial-only command sharing no prefix collapses it to `null` and
`Tab` does nothing — and returns `null` when the set diverges at character zero.

### 2.3 `suggest.ts`

```ts
export interface CliSuggestCtx {
  recent: string[];                        // command names, most-recent first, max 5
  nodeValues: Record<string, string>;      // cmd.key → last extracted get value
}
export interface CliSuggestion {
  id: string; label: string; desc: string;
  kind: 'command' | 'value' | 'preset' | 'current';
  cmd?: CliCommand; group?: CliGroup;
  ranges?: [number, number][];
  meta?: string;
  insert: string; replaceFrom: number; replaceAll?: boolean;
  serialOnly?: true; recent?: true;
}
export function suggest(text: string, caret: number, ctx: CliSuggestCtx):
  { parse: CliParse; items: CliSuggestion[] };
```

**Applying a suggestion** yields
`value.slice(0, replaceFrom) + insert + (replaceAll ? '' : value.slice(caret))`, with
the caret at `replaceFrom + insert.length`. Stated once here; every call site follows
it.

**Command mode.** Score every command, add `260 − position × 10` for names in
`ctx.recent`, subtract `2000` for `serialOnly`, sort descending. The penalty is large
enough that serial-only always sorts last regardless of match quality, which is what
lets §4.2 group them in one pass.

**Arg mode**, in order:

1. **The value the node last reported** for `cmd.key` — `meta: 'on node now'` — **only
   when `argIndex === 0`**, and only when it isn't already an enum value. Injecting it
   at every index would offer the whole `869.525,250,11,5` string as a suggestion for
   `<cr>`.
2. **Enum values** for `cmd.args[argIndex]`, each carrying its `enumDesc` entry.
3. **Presets**.

The node value and enum values are filtered by **prefix** against the token under the
caret; presets match on **value prefix or label substring**, so `us` finds
`910.525,250,11,5` via its `US 915` label.

**`ctx.nodeValues` extraction.** Firmware replies are not guaranteed to be bare values,
and `MyMeshRepeater.cpp:1205-1209` can reflect a three-character companion-radio prefix
verbatim. When a `get` succeeds and its catalog entry has a `key`, apply `replyValue`
if present, else accept the trimmed reply only if it is a single line with no `:`
separator. **If extraction fails, record nothing** — a missing suggestion is
recoverable, a wrong prefill is not. `nodeValues` is session-only and dies with the
panel remount; it is not persisted.

**`ctx.recent` derivation.** History stores raw lines, not command names. Map each
`ok`-status history entry through the same longest-name resolution `parse.ts` uses,
walking newest-first, collecting distinct command names until five. Lines that resolve
to no catalog command, and non-`ok` entries, are skipped.

### 2.4 `airtime.ts`

```ts
export function cliRoundTrip(
  command: string, radio: RadioSettings, hops: number, noReply: boolean,
): { ms: number; label: string };
```

Wraps `loraAirtimeMs()` from `src/renderer/lib/airtime.ts`. Following the shipped
caller (`Composer.tsx:106`, which adds `+ 32 /* rough wrapper overhead */`), the
outbound leg is `byteLength(command) + 32` and the inbound leg is `160 + 32`; each is
multiplied by hop count, since every hop retransmits. `noReply` counts the outbound leg
only.

Inputs: `hops = Math.max(1, contact.hops ?? 1)` — `Contact.hops` is optional
(`src/shared/types.ts:103`) and an unfloored `0` yields a meaningless `~0.0 s`.
`radioSettings` comes from the store, as `MessagesTab.tsx:27` already does. When
`radioSettings` is absent at first paint, the estimate renders as `—`, not `~0.0 s`.

Label: `~2.9 s` when `ms < 10_000`, else `~14 s`.

### 2.5 `queue.ts`

```ts
export type CliEntryState =
  | 'queued' | 'sending' | 'ok' | 'error' | 'timeout' | 'sent' | 'cancelled';

export interface CliEntry {
  id: string;
  text: string;                     // exactly what goes on the air
  cmd: CliCommand | null;           // resolved catalog entry, null if unknown
  state: CliEntryState;
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  reply: string | null;
  error: { kind: 'refused' | 'timeout' | 'transport' | 'superseded'; message: string } | null;
}

export interface CliQueueState { entries: CliEntry[] }

export function enqueue(s: CliQueueState, e: CliEntry): CliQueueState;
export function beginNext(s: CliQueueState): { state: CliQueueState; next: CliEntry | null };
export function settle(s: CliQueueState, id: string, patch: Partial<CliEntry>): CliQueueState;
export function cancel(s: CliQueueState, id: string): CliQueueState;
export function abortAll(s: CliQueueState): CliQueueState;
```

`beginNext` returns `null` when an entry is already `sending` — the invariant that
keeps the library from ever seeing two outstanding commands.

`cancel` moves a `queued` entry to `cancelled`. `abortAll` moves **every non-terminal
entry, including the `sending` one**, to `cancelled` with
`error.kind: 'transport'`. Leaving an aborted entry in `sending` would make
`beginNext` return `null` forever and wedge the queue — the exact failure this change
exists to remove.

The `AbortController` is **not** in queue state. It lives in a ref in `CliTab`,
recreated per send and aborted by the same effect that calls `abortAll`; queue state
stays serialisable and pure. A cancelled entry stays in the transcript and **is not**
added to history.

### 2.6 `persistence.ts`

Per-repeater history ring and reboot-pending, keyed by **`contact.publicKeyHex`** —
named explicitly because "pubkey" could mean `Contact.key` (`'c:<hex>'`),
`publicKeyHex`, or the library's 12-char prefix, and `CliTab` and `RebootPending.tsx`
picking differently would silently split the two stores. Both loaders route through
the same key helper.

```ts
export interface CliHistoryEntry {
  text: string;
  status: 'ok' | 'error' | 'timeout' | 'sent';
}

export function loadHistory(pubkeyHex: string, storage?: Storage): CliHistoryEntry[];
export function saveHistory(pubkeyHex: string, h: CliHistoryEntry[], storage?: Storage): void;
export function loadPendingReboot(pubkeyHex: string, storage?: Storage): RebootPending;
export function savePendingReboot(pubkeyHex: string, p: RebootPending, storage?: Storage): void;
```

`storage` defaults to `globalThis.localStorage` and is injectable — the `unit` vitest
project runs in `environment: 'node'` with no `setupFiles` (`vitest.config.ts:29-31`),
so without injection every test would silently exercise only the degraded no-storage
path and pass green. Every access is `try`/`catch`-wrapped, degrading to session-only.

Keys: `coresense.cli.history.<pubkeyHex>`, `coresense.cli.pendingReboot.<pubkeyHex>`.

**History semantics**, all three of which change behaviour and so are stated
explicitly: stored **oldest-first**; entries are **pushed on submit** (so `↑`
immediately recalls what you just ran) with `status` patched at settle; consecutive
duplicates collapse on push; the 200-entry cap **trims from the front**.

This lives outside the panel because
`src/renderer/panels/repeater-admin/index.tsx:144` keys the tab body on `contact.key`,
remounting on every repeater switch. That remount is deliberate and documented there;
the transcript should keep dying with it, history and reboot-pending must not.

## 3. Prompt state machine

`lib/promptReducer.ts` — a pure reducer over everything the keyboard touches. It is
the decision that makes the keyboard exhaustively testable without a DOM, and it
matters because the tricky interactions are cross-cutting: `navigated` changes what
`Enter` does, `dismissed` is a latch rather than a mirror of visibility, the history
index shadows a saved draft, and reverse-search is modal.

```ts
interface CliPromptState {
  value: string;
  caret: number;
  history: CliHistoryEntry[];
  histIndex: number;          // -1 = not recalling
  draft: string;              // saved on the first ArrowUp
  manualOpen: boolean;
  dismissed: boolean;
  navigated: boolean;
  activeId: string;
  rsearch: { query: string; index: number; restore: string } | null;
  confirmPending: { text: string; cmd: CliCommand } | null;
  ctx: CliSuggestCtx;
}

type CliEffect =
  | { kind: 'submit'; text: string }
  | { kind: 'clearTranscript' };

export function cliPromptReducer(
  s: CliPromptState, a: CliPromptAction,
): { state: CliPromptState; effect?: CliEffect };
```

The reducer returns an **optional effect** rather than mutating anything outside its
state: `Enter` and `⌃L` act on the queue and transcript, which the reducer does not
own. `CliTab` applies the effect. This keeps the reducer pure while letting the key map
be its single description.

It calls `suggest()` itself — `suggest` is pure and `ctx` is in state — so callers
never keep a derived list in sync with a dispatch.

**Actions beyond the key map**, each with its own test: `value/change` (typing and
paste), `caret/set`, `item/apply` (mouse click on a row, §4), `line/set` (follow-up
chip prefill, §5.5), `history/loaded`, `history/push`, `history/patchStatus`,
`ctx/setNodeValue`, `ctx/setRecent`, `confirm/cancel`.

**Palette visibility** is derived, never stored:

```
open = (manualOpen || (value.trim() !== '' && !dismissed)) && !rsearch && !confirmPending
```

Note there is deliberately **no `items.length > 0` term** — a zero-item palette must
still render §4.1's "press ↵ to send it raw" hint.

**`activeId` invariant:** whenever the item list changes and `navigated` is false, set
`activeId = items[0].id`. Nothing else initialises it.

### 3.1 Key map

| Key | Behavior |
|---|---|
| *any value change* (including Backspace/Delete/paste) | clear `dismissed` and `manualOpen`, reset `histIndex` and `navigated` |
| `⌃Space` | toggle `manualOpen`, clear `dismissed` — works on an empty line, giving catalog browse |
| `↑` / `↓` | open → move selection, set `navigated`. Closed → history recall; `↑` **also sets `dismissed`** so the next `↑` steps further back instead of moving the palette selection; `↓` deliberately does not. The first `↑` saves `value` into `draft`; `↓` past the newest restores it |
| `Tab` | closed → open. One item → apply. `navigated` → apply selection. Else complete to `commonPrefix` via the §2.3 splice; if that adds nothing, set `navigated` |
| `→` / `End` | accept the ghost when one exists and the caret is at end; otherwise fall through to native cursor movement |
| `Enter` | palette open **and** `navigated` → apply selection, don't run. Else if the resolved command is `danger` → set `confirmPending`. Else emit `{ kind: 'submit' }` |
| `Escape` | confirm open → clear `confirmPending`. Palette open → clear `manualOpen` **and** set `dismissed`. Else clear the line |
| `⌃R` | enter reverse-i-search, saving `value` into `restore` |
| `⌃L` | emit `{ kind: 'clearTranscript' }` |

`Enter` requires `open && navigated`, not `navigated` alone: `navigated` survives
`Escape`, so the weaker test would apply an invisible selection instead of submitting.

Applying a command with no arguments closes the palette; applying one with arguments
leaves it open so argument suggestions appear immediately.

### 3.2 Reverse-i-search

While `rsearch` is non-null it swallows every key. `⌃R` steps to an older match and
**clamps at the oldest** (as bash does); with zero matches it is a no-op. `↵` accepts
and runs, `→` or `Tab` accepts into the line for editing, `⌃G` or `Escape` aborts and
restores `restore`. Backspace shortens the query and resets the index to zero.

Search is a case-insensitive substring over the persisted history, walked newest-first.
With no match the line reads `failing reverse-i-search` and the `n/total` counter is
suppressed rather than showing `0/0`.

### 3.3 Ghost completion

Rendered only when the caret is at end of line and the top item's label prefix-matches
the current token case-insensitively. In command mode the suffix follows the whole
value; in argument mode it follows the token. Accepting **appends only the suffix,
preserving typed casing** — `SET r` + ghost becomes `SET radio`, not `set radio`.

Implemented as an absolutely positioned layer behind the input holding an invisible
copy of the value plus a dim span, so the ghost aligns to real glyph advance without
measuring text. **This is why the prompt uses a native `<input>` rather than the
design system's `Input`** — it needs a bare element to layer behind and its own mono
type tokens. (`Input` forwards refs fine under React 19: it is a plain function typed
`React.ComponentProps<'input'>`, in which `ref` is an ordinary prop. There is nothing
to fix upstream.)

## 4. Palette

A Radix `Popover` anchored to the prompt, containing hand-rolled rows.

### 4.1 Why not `cmdk`

`cmdk` is a dependency and three surfaces use it
(`features/command-palette/index.tsx:162`, `settings/quick-actions/QuickActionsTab.tsx:36`,
`components/path/SetPathEditor.tsx:208`) — all in **default mode**, with `CommandInput`
and built-in filtering. This palette needs none of that: we rank ourselves, the prompt
is the input, focus must stay in the prompt, and the reducer owns selection.

What is left would have to run in controlled-`value` mode, and in the pinned `1.1.1`
that path is a layout effect that bypasses `setState`, so the `scrollIntoView` call and
the `selectedItemId` update driving `aria-activedescendant` never fire — and item
unregistration writes back to the store, stomping `activeId` on every keystroke that
reshuffles the list.

So the rows are plain `<button type="button">`, exactly as
`src/renderer/panels/macros/studio/MacroEditor.tsx:187-203` already does, and we own
`scrollIntoView` and `aria-activedescendant` ourselves. Being explicit about a11y is a
feature here: the palette must announce correctly while focus never leaves the prompt.

### 4.2 Popover traps

**Already solved by `MacroEditor.tsx`, follow it:** `onOpenAutoFocus` and
`onCloseAutoFocus` both `preventDefault()` (`:178-179`); rows use `onMouseDown` with
`preventDefault()`, never `onClick` (`:191-192`), or the click blurs the field first;
refocus and caret reposition inside `requestAnimationFrame`, because the value is
controlled; and the `sameMenu` guard (`:62-74`) — `ArrowUp`/`ArrowDown` are handled in
`onKeyDown`, but their `onKeyUp` re-runs caret tracking with an unchanged caret and
would snap the selection back to zero.

**New here, no in-repo precedent:** `side="top" align="start"` (MacroEditor opens
downward at `:174`); a zero-height positioned anchor spanning the prompt width, rather
than MacroEditor's whole-container anchor (`:98-99`); the list, scrolling, and
roving-selection a11y.

### 4.3 Layout

```
available = window.innerWidth − anchorRect.left
width     = clamp(380, 660, available − 20)
fold      = width < 560       // two-pane → inline
```

List scrolls at `max-height: 302px`; the detail pane is 250px and follows keyboard
navigation. Measured on mount and on resize.

Header row: surface label (`Commands` / `Values`), the active argument name in argument
mode, the item count, and key hints (`↹ complete · ↑↓ move · ↵ run · esc dismiss`)
using `components/ui/kbd`.

Empty state: *"No command matches — press ↵ to send it raw."*

### 4.4 Groups

Command mode: **Recent on this node** (empty query only), then catalog groups, then
**Not available over radio**. Catalog groups are ordered by **their best member's
score**, not by `CLI_GROUP_ORDER` — a fixed order would put a weak substring hit at the
top of the list while a perfect prefix match sat three groups down, breaking both the
ghost ("the top item") and the `activeId` invariant. `CLI_GROUP_ORDER` orders the
browse list, where every command ties at `score: 1`. Argument mode is one ungrouped
list.

### 4.5 Chips

Right-aligned, blockers first. Tones are named concretely because "info" is not a token
in this codebase:

| Chip | Token | Meaning |
|---|---|---|
| `serial only` | `cs-text-dim` on `cs-bg-3` | never answered over the air |
| `destructive` | `cs-danger` on `cs-danger/15` | asks for confirmation |
| `no reply` | `cs-text-muted` on `cs-bg-3` | the node never answers |
| `reboot` | `cs-accent` on `cs-accent-soft` | takes effect after a reboot |
| `v1.14.1+` | `cs-text-muted` on `cs-bg-3`, italic | firmware floor |
| `deprecated` / `exp` | `cs-text-dim` on `cs-bg-3` | |

`no reply` and `v1.14.1+` share a fill and are distinguished by weight/italic rather
than a third tint, because `--cs-accent` and `--cs-warn` are byte-identical
(`index.css:27,30`) and `cs-accent` is already spoken for. Contrast is measured against
each chip's own `/15` fill per the rule at `index.css:114-119`, not against the page.

No `admin` chip (§0). No per-row airtime chip (§0).

### 4.6 Detail pane

Command name and spec, description, parameters with hints / enum values / ranges,
firmware default, the value currently on the node, the round-trip estimate
(`1↑ 1↓ · ~2.9 s`, or `1↑ · no reply`), and the note below a rule. Argument-mode items
show value, description, and what it resolves to.

## 5. Transcript & queue

### 5.1 Queue

Submitting enqueues. A drain effect starts the next entry whenever nothing is
`sending`. Queued entries render with a `×`; the prompt shows `N queued` when non-zero.
On repeater switch or unmount the effect calls `abortAll` and aborts the live
`AbortController`.

### 5.2 In-flight

**Dimmed echo, blinking cursor, elapsed milliseconds.** The mockup's other three
treatments are deliberately not built: `SENT → ACK → AWAITING REPLY` and the airtime
progress bar both present phase information we do not have. The route holds one HTTP
response open and tells us nothing until it resolves, so a phase readout would be a
stopwatch dressed as telemetry.

### 5.3 Completed

Reply lines render monospace and wrapped, with `Err`-prefixed lines in danger tone.
Metadata line: the elapsed duration only — **no frame count** (it would be a constant
`1 frame` on every row, §0) and **no SNR**. `Contact.snr` exists
(`src/shared/types.ts:102`) but is the contact's rolling last-heard value, not this
reply's; attributing it to a line would be fabrication. Surfacing it properly means
having the route return the reply DM's SNR — a worthwhile follow-up, out of scope.

**Truncation hint** when `byteLength(reply) >= 156`: a dim *"may be truncated by
firmware"*. `neighbors` is the routine case (§0).

### 5.4 Failure

Four distinct treatments, driven by `CliEntry.error.kind`:

| `kind` | Source | Treatment |
|---|---|---|
| `refused` | HTTP **200** with an `Err -` body | danger tone, rendered as a reply. Not a transport failure |
| `timeout` | `504` / `code: 'cli_timeout'` | *"no reply after 30 s"* + Retry + edit-and-resend. If the command is `serialOnly`, add *"this command is serial-console only"* |
| `superseded` | `superseded by newer CLI command` | *"cancelled — another client sent a command to this repeater"* (§Decisions caveat) |
| `transport` | everything else | the server message, plus Retry |

### 5.5 Follow-ups

After a successful `get X` whose entry has a `key`, a matching `set X`, and a
successful value extraction (§2.3): *Change this value* → `set X <value>`, dispatched
as `line/set` into the prompt, not sent. After a successful `set` marked `reboot`:
*Apply with* → `reboot`.

### 5.6 Empty state

Current prose plus the key legend: `⌃Space` suggestions, `↹` complete, `↑` previous,
`⌃R` reverse search, `⌃L` clear.

## 6. Reboot-pending

A `set` marked `reboot: true` that reaches a **successful terminal state — `ok` or
`sent`** — leaves configuration written to a remote node but not live. (`sent` matters:
a `noReply` reboot-required command can never reach `ok`.) That is unsaved-changes
state, not a notification, so dismissing must not discard it.

```ts
interface RebootPending {
  settings: { label: string; verify: string | null }[];
  dismissed: boolean;
  rebootSentAtMs: number | null;   // persisted, unlike the mockup's transient flag
}
```

All three fields persist. `rebooting` is **derived**: `rebootSentAtMs !== null`.

**Deriving a settings entry** from the command that armed it: `verify` is the
`CLI_BY_NAME` entry whose `key` equals `cmd.key` and whose name starts with `get `,
else `null`; `label` is the command name minus a leading `set `. Dedup is on `cmd.key`,
falling back to `label` — not string surgery on the name, which breaks for any
reboot-required command not shaped `set <x>`. Re-writing the same setting clears
`dismissed` rather than adding a duplicate.

**Tier one** — a warn-tinted strip above the prompt while `!dismissed`: the count, a
clickable chip per setting running its `verify`, **Reboot now**, and a `×` setting
`dismissed`.

**Tier two** — once dismissed, a `reboot pending · N` chip in the repeater header with
a hover card, and a warn dot on the CLI tab. Both live in
`src/renderer/panels/repeater-admin/index.tsx`, above the remount boundary, which is
what lets them survive a repeater switch. Clicking either clears `dismissed`.

**Clearing.** Sending `reboot` or `clkreboot` sets `rebootSentAtMs` **on settle, not on
submit** — arming it at submit would leave a permanently stuck "Rebooting" strip if the
send failed. The state clears when
`contact.lastSeenMs != null && contact.lastSeenMs > rebootSentAtMs` — the node has been
heard again, the only real evidence the reboot happened. `Contact.lastSeenMs` is
optional (`src/shared/types.ts:100`); while it is undefined the strip stays in its
"rebooting" form and offers a manual dismiss, so the state is never unclearable. The
live `contact` comes from the panel's own prop, which is why tier two must sit in
`index.tsx`.

## 7. Transport & API changes

### 7.1 `meshcore-ts` (external prerequisite)

`repeaterSendCli(contactKey, command, opts?)` gains:

- `expectReply?: boolean` (default `true`). When `false`: send the same
  `TXT_TYPE.CLI_DATA` DM, resolve on send confirmation, register no `pendingCli` entry,
  arm no reply timer.
- `signal?: AbortSignal` — cancellation that clears the `pendingCli` entry rather than
  merely detaching the caller.
- `CLI_REPLY_TIMEOUT_MS` exported, so §5.4's *"no reply after 30 s"* is derived rather
  than hardcoded.

`timeoutMs` is **not** requested: no call site in this design sets it.

Separately requested, not blocking: tag the synthetic `cli-<base36>-<rand>` DM ids so
consumers can filter them out of `messageState` (coresense writes a no-op row and
broadcasts a junk WS frame per CLI command, `src/main/protocol/adapterEvents.ts:113-116`).

### 7.2 This repo

| File | Change |
|---|---|
| `src/renderer/lib/api.ts:265` | `repeaterCli(c, key, command, opts?: { expectReply?, signal? })`; return widens to `{ ok: true; reply: string } \| { ok: true; sent: true }`. `request()` at `:50` already spreads `...init` into `fetch`, so `signal` needs no change there |
| `src/renderer/lib/api.ts:41-48` | `parseServerError` reads only `body.error` and discards status; surface a `code` so the renderer can classify (§5.4) |
| `src/main/api/routes.ts:799-811` | accept `expectReply`; forward `c.req.raw.signal` into the options bag so an aborted HTTP request clears `pendingCli` rather than leaving it registered for the full timeout; return `202 { ok, sent: true }` for no-reply, `504 { error, code: 'cli_timeout' }` for timeout, `503 { error, code: 'transport' }` otherwise |
| `src/main/protocol/sessionAdapter.ts:169` | forward the options bag |
| `src/shared/shortcuts.ts` | move `packetLog` off `mod+L`; register Reload (currently an unregistered `{ role: 'reload' }`) on a non-colliding accelerator; add `cliReverseSearch` (`ctrl+R`) and `cliClear` (`ctrl+L`) as `surface: 'contextual'` so they appear in the help overlay |
| `src/main/menu.ts:139` | replace `{ role: 'reload' }` with an item using `accelFor('reload')`, so the accelerator lives in the one source of truth |
| `src/renderer/panels/repeater-admin/index.tsx:151` | pass `session` and `contact` to `CliTab`; `isAdmin` is computed at `:78` and handed to `AclTab` at `:148`, but not to `CliTab` |
| `src/renderer/panels/repeater-admin/CliTab.tsx:73` | `text-cs-error` → `text-cs-danger`; the token does not exist, so CLI errors render unstyled today |
| `vitest.config.ts:29-38` | no change needed if `persistence.ts` takes an injectable `Storage` (§2.6); listed so the alternative is a conscious choice |
| `package.json` | raise the `@andyshinn/meshcore-ts` floor once the release lands |

`⌃⇧R` is **not** available for Reload — `src/shared/shortcuts.ts:185` already binds it
to Reconnect Radio. `mod+shift+L` is Toggle Theme (`:52`). Both replacements must be
checked against `SHORTCUTS` when the phase-2 plan is written, which is the point of
registering them there.

The CLI tab registration at `index.tsx:30` stays without `adminOnly` — deliberately
unlike the ACL tab at `:27` — because the palette is worth reading logged out (§8).

## 8. Guest / no admin session

Firmware refuses all mesh CLI from a non-admin client with silence (§0), so sending
without an admin session can only produce a 30-second timeout.

`session` starts `null` and is filled by an async effect (`index.tsx:55,59-76`), so
this is a **three-way** state, not a boolean:

| `session` | Prompt | Banner |
|---|---|---|
| `null`, fetch in flight | enabled, submit is a no-op | none |
| resolved, `role !== 'admin'` | enabled, submit is a no-op | *"This repeater only answers CLI from an admin session"* + **Log in as admin →** |
| resolved, `role === 'admin'` | enabled | none |

**The input is never `disabled`.** A disabled `<input>` takes no focus, keystrokes, or
selection changes, which would kill ghost text, `Tab`, history, and `⌃R` — the entire
read surface that justifies keeping the tab visible. Submission is blocked at the
reducer's `submit` effect and by greying Run, not by disabling the field.

Because admin is a tab condition and not a per-command flag, `suggest()` takes no auth
input at all.

## 9. Design tokens & components

Tokens come from `src/renderer/index.css` (Tailwind v4 CSS-first; no
`tailwind.config.js`): `cs-bg`/`-2`/`-3`, `cs-text`/`-muted`/`-dim`,
`cs-border`/`-strong`, `cs-accent`/`-soft`, `cs-online`, `cs-warn`, `cs-danger`.
`cs-online`, `cs-accent`, and `cs-danger` are documented as exclusively semantic
(`:41-43`) and the `--cs-id-*` identity ramp is reserved for per-person hues — neither
may be borrowed for suggestion categories.

Used from `src/renderer/components/ui/`: `popover`, `hover-card`, `kbd`, `button`,
`badge`, `tooltip`. Not used: `command` (§4.1). There is no `ScrollArea` — scrollbars
are styled globally and auto-hiding (`index.css:227-264` + `lib/scrollbarReveal.ts`),
so plain `overflow-y-auto` gets the right handle.

Popover list content follows the converged recipe: override the default `w-72 p-4` to
`p-1`, with `border-cs-border-strong bg-cs-bg-2`.

## 10. File structure

**Create**

| Path | Purpose |
|---|---|
| `src/shared/repeater-cli/catalog.ts` | command catalog + types |
| `src/renderer/panels/repeater-admin/cli/lib/parse.ts` | line → parse mode |
| `…/cli/lib/match.ts` | scoring + common prefix |
| `…/cli/lib/suggest.ts` | ranked suggestions |
| `…/cli/lib/airtime.ts` | round-trip estimate |
| `…/cli/lib/queue.ts` | `CliEntry` + FIFO transitions |
| `…/cli/lib/promptReducer.ts` | keyboard state machine |
| `…/cli/lib/persistence.ts` | history + reboot-pending |
| `…/cli/CliPrompt.tsx` | input, ghost, airtime, Run |
| `…/cli/CliPalette.tsx` | popover + hand-rolled list |
| `…/cli/CliDetail.tsx` | detail body |
| `…/cli/CliTranscript.tsx` | scroller + empty state |
| `…/cli/CliRow.tsx` | one transcript row (named to avoid colliding with the `CliEntry` type) |
| `…/cli/CliReverseSearch.tsx` | `⌃R` line |
| `…/cli/CliConfirmBar.tsx` | hold-to-send |
| `…/cli/RebootPending.tsx` | strip + header chip + tab dot |
| `docs/firmware/CommonCLI.cpp` | vendored, for §1.2 reconciliation |
| `docs/firmware/PROVENANCE.md` | upstream repo + commit for all three `.cpp` files |

**Commit** (already on disk, untracked): `.design-ref/cli-autocomplete/` — eight files
including `cli-icons.jsx`, which `cli-palette.jsx:7,55` depends on.

**Modify**: `CliTab.tsx` (rewritten thin), `repeater-admin/index.tsx`, `lib/api.ts`,
`main/api/routes.ts`, `main/protocol/sessionAdapter.ts`, `main/menu.ts`,
`shared/shortcuts.ts`, `package.json`.

**Delete**: nothing. `SUGGESTIONS` at `CliTab.tsx:18` is subsumed by the catalog.

## 11. Testing

**unit** — `tests/unit/renderer/panels/repeater-admin/cli/`

| File | Covers |
|---|---|
| `parse.test.ts` | command vs arg mode; **exact-name stays in command mode**; longest-match (`set radio` over `set`); caret mid-line; trailing space; empty line |
| `match.test.ts` | all six scoring rows incl. **empty query**; tie-break by length; sort stability preserving catalog order; merged ranges; `commonPrefix` over non-`serialOnly` items; full divergence → `null` |
| `suggest.test.ts` | recency boost; serial-only sunk last; enum prefix filtering; **preset label-substring match**; "on node now" only at `argIndex 0`; extraction failure records nothing; apply/splice semantics |
| `promptReducer.test.ts` | every §3.1 row; `↑ ↑` steps back twice; Escape-then-Enter submits; `⌃Space` then Escape closes; `danger` → `confirmPending`; reverse-search modality, clamp-at-oldest, abort-restores; every §3 non-key action |
| `queue.test.ts` | FIFO order; one-at-a-time invariant; cancel queued; **`abortAll` moves the `sending` entry to `cancelled` and `beginNext` recovers**; cancelled entries stay out of history |
| `airtime.test.ts` | hop multiplication; `+32` overhead; `noReply` outbound only; `hops` floor; absent `radioSettings` → `—`; `ms < 10_000` label boundary |
| `persistence.test.ts` | round-trip **against an injected in-memory `Storage`**; oldest-first order; 200-cap trims the front; duplicate collapse; throwing storage degrades |

`tests/unit/shared/repeater-cli/catalog.test.ts`: names unique; `key` present whenever
a `get`/`set` pair exists; `enumDesc` keys ⊆ `enum`; every `CliGroup` in
`CLI_GROUP_ORDER`; **every `serialOnly` and `noReply` entry is individually asserted**
— those two flags decide whether a user waits 30 seconds for silence, so they are
pinned by name rather than by shape.

**component** — `tests/component/`

`cli-palette.test.tsx` (open, apply, dismiss, group ordering by best score, **the
zero-item empty state**, and a keyboard-navigation assertion on `aria-activedescendant`
rather than on `scrollIntoView`, which `tests/component/setup.ts:43-45` stubs);
`cli-prompt-keys.test.tsx` (Tab, ghost casing, history — through a `flushSync` harness,
per the discrete-flush trap jsdom does not reproduce); `cli-guest-blocked.test.tsx`
(all three §8 states, including the in-flight one, asserting the input stays focusable);
`cli-transcript-states.test.tsx` (all four §5.4 error kinds, truncation threshold);
`cli-reboot-pending.test.tsx` (arm on `ok` and on `sent`, dedup, tier demotion, clear
on `lastSeenMs` advance, undefined `lastSeenMs`); `cli-confirm.test.tsx` (hold gesture,
cancel on early release).

**integration** — extend `tests/integration/inbound/repeater-admin.test.ts`: the CLI
route with `expectReply` true and false; `504`/`cli_timeout` vs `503`/`transport`
classification; and an abort case asserting the `pendingCli` entry was **cleared**, not
merely that the client saw an abort.

**shortcuts** — a test asserting no two `SHORTCUTS` entries share a chord, so the
`mod+L` / `mod+shift+R` class of collision cannot recur silently.

`@testing-library/jest-dom` is **not** installed — assert with `toBeTruthy()` /
`toBeNull()` / attribute and `className` reads, never `toBeInTheDocument()`. A `.tsx`
under `tests/unit/` never runs; the project split is by extension.

Verification, from the worktree with `npx`:

```
npx tsc --noEmit
npx biome check src tests
npx vitest run --project unit
npx vitest run --project integration
npx vitest run --project dom
```

## 12. Phasing

Three sequenced plans under this one design doc, following the
`2026-05-29-contact-management-design.md` precedent.

**Gate (before phase 1):** vendor `CommonCLI.cpp` + `PROVENANCE.md`, or record that it
could not be obtained and the §1.2 fallback applies.

| Phase | Contents | Blocked by |
|---|---|---|
| **1 — Catalog & logic** | `catalog.ts` reconciled; `parse`, `match`, `suggest`, `airtime`, `queue`, `promptReducer`, `persistence`; all unit tests. No UI, no transport. | the gate |
| **2 — UI** | `CliPrompt`, `CliPalette`, `CliDetail`, `CliTranscript`, `CliRow`, `CliReverseSearch`, `CliConfirmBar`, `RebootPending`; thin `CliTab` on today's two-argument transport; shortcut and `text-cs-error` fixes; component tests. Ships useful on its own. | phase 1 |
| **3 — Queue & no-reply** | `expectReply` / `signal` through `api.ts` → `routes.ts` → `sessionAdapter.ts`; error-code classification; queue wiring; abort on switch; integration tests. | phase 2 + the `meshcore-ts` release |

## 13. Deliberate deviations from the handoff

| Mockup | Built | Why |
|---|---|---|
| Per-command `admin` chip and `auth` scoring | Tab-level guest banner | Firmware gates all mesh CLI on admin (§0) |
| `rx` reply-frame counts, streaming reveal | Single reply + truncation hint | Replies are one packet ≤160 B (§0) |
| Per-row airtime chip | One estimate on prompt and detail | Every command costs the same at a given SF/hop count (§0) |
| Four in-flight treatments | Dimmed echo + elapsed ms | The other three imply phase data we don't have (§5.2) |
| `SNR +5.0 dB`, `1 frame` in reply meta | Duration only | SNR is rolling last-heard, not this reply's; frame count is a constant (§5.3) |
| `cmdk` command list | Hand-rolled rows | Controlled-`value` mode is broken in the pinned version (§4.1) |
| `{{ vars }}`, filters, `/macros`, "On air" strip | Deferred | Couples to a separate feature surface |
| Transient `rebooting` flag | Persisted `rebootSentAtMs` | A repeater switch would otherwise strand the state permanently (§6) |
| Tweak panel, 11 switches | One locked configuration | A design exploration tool, not a product surface |

## 14. Risks

**The catalog is only as good as `CommonCLI.cpp`.** Not vendored yet, and the
implementation shell is network-sandboxed. §1.2 makes this a gate with a pre-decided
fallback rather than a mid-plan judgement call, but if the fallback fires, 91 commands
ship documentation-derived and `noReply` ships empty.

**`promptReducer` is where the bugs will be.** Modal reverse-search, the `dismissed`
latch, and draft preservation interact in ways easy to get subtly wrong — which is why
it is a pure function with exhaustive unit tests rather than logic reachable only
through the DOM.

**Two global shortcuts move.** Packet Log and Reload change accelerators for everyone,
not just this tab. Registering them in `SHORTCUTS` plus the collision test in §11 makes
that visible, but it is a real change outside this feature's blast radius.

**Hand-rolling the list means owning its accessibility.** `aria-activedescendant`, a
correct `role="listbox"`/`option` structure, and scroll-into-view are all ours now.
§11 asserts the first; the rest need care in review.

**The `meshcore-ts` dependency gates phase 3 only** — phases 1 and 2 are buildable and
testable today.

**`adminSessions` is never `reset()` in production** — a pre-existing gap.
`GET /api/repeater/:key/session` can report a live session after a transport drop, so
the prompt would look enabled when it isn't. Out of scope to fix; an auth-shaped CLI
failure should re-check the session rather than trust cached state.

## 15. Rollback

New code is confined to `src/renderer/panels/repeater-admin/cli/` plus
`src/shared/repeater-cli/`; reverting those directories and restoring the old
`CliTab.tsx` returns previous behaviour. Two changes sit outside that boundary and
revert separately: `repeater-admin/index.tsx` (the reboot-pending header chip and tab
dot, which must live above the remount boundary — §6), and the `shortcuts.ts` /
`menu.ts` accelerator moves.

The API changes are additive and default to today's semantics — `expectReply` defaults
to `true`, `signal` is optional — so main and the transport can stay even if the UI is
reverted.
