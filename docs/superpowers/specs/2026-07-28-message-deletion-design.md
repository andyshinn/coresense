# Deleting Messages

Hard-delete a single message from the app view and from `messages.db`, behind a confirmation,
reachable from the message action bar's dropdown and from the right-click menu — which become
one shared item set — in every conversation view and in search results.

## Problem

There is no way to delete a message. Two disabled stubs promise one and disagree about what it
would mean:

- `src/renderer/features/message-actions/MessageQuickBar.tsx:165` — a `Trash2` icon button
  labelled **"Delete"**, rendered only on **own** messages, no `onClick`.
- `src/renderer/features/message-actions/OverflowMenu.tsx:72` — a menu row labelled
  **"Dismiss locally"**, rendered only on **received** messages (the whole `OverflowMenu` sits
  inside the quick bar's `!isSelf` branch), no `onClick`.

Neither semantic has ever shipped, and the two labels encode mental models — *retract mine* vs
*hide theirs* — that MeshCore cannot distinguish. The firmware has no delete primitive, so both
are equally local.

The two menus are also structurally incompatible and carry disjoint item sets, so "make them the
same thing" is a prerequisite for the feature rather than a side effect of it.

## Goals

- `DELETE` a message row from SQLite. Not a `deleted` flag, not a renderer-side filter.
- Confirm before deleting.
- One item set shared by the action-bar dropdown and the right-click menu.
- Reachable in channels, DMs, and search results.
- Survive the message being re-heard over the mesh.

## Non-goals

- **Multi-select and bulk delete.** The renderer has no multi-select concept at all —
  `selectedMessageId` is a single global string — so it is a new interaction model, not an
  increment. The storage and route layers take a list of ids so a later bulk feature does not
  require a rewrite.
- **Clear-conversation / clear-history.** Separate feature; see *Known bugs left alone*.
- **Undo.** See *Rejected alternatives*.
- **A "don't ask again" preference.** No such pattern exists anywhere in the app; `AppSettings`
  has no `confirm*` field.
- **The Unreads panel.** Its rows are deliberately static previews with no `onSelect`,
  `onReact`, or `onContextMenu`. Making them interactive is scope creep with its own
  hover/selection questions.
- **A keyboard shortcut.** There is no keyboard-selected-message concept — selection is
  click-driven and the action bar is hover-driven — so a Delete binding would have no referent.
- **E2E coverage.** `tests/e2e/support/launch.ts` seeds only `channels.json` and `contacts.json`;
  there is no message-seeding capability. Integration and component layers cover this instead.

## The resurrection problem

This is the only genuinely hard part, and it shapes the data model.

`@andyshinn/meshcore-ts@0.4.0` mints channel-message ids **deterministically**
(`dist/index.js:2261`):

```js
const id = `chmsg-${channel.key}-${parsed.timestampUnix}-${bodyHash}`;
```

That is correct and intentional — it is what merges multi-path flood receipts into one row rather
than duplicating them. But the library fires `messageUpserted` on **every** receipt, including the
second and third path of the same packet, and `messagesStore.insert` is an upsert on `mid`
(`src/main/storage/messages.ts:104`). So:

> Delete a channel message, hear the same packet over another route, and the row is silently
> re-created.

DMs are immune — their ids are `radio-${Date.now().toString(36)}-${Math.random()…}`
(`dist/index.js:3144`), freshly random per receipt, so a re-receipt creates a new row rather than
reviving a deleted one.

The library also keeps its own in-memory `Map<id, Message>` that SQLite deletes do not touch, and
its public store surface (`dist/index.d.ts:478-500`) is entirely additive — `insertMessage`,
`upsertMessage`, `setMessageState`, `appendMessagePath`. There is no `removeMessage` and no
suppression call.

**Resolution:** ship a coresense-side tombstone now; fix the library separately. Filed as
[andyshinn/meshcore-ts#2](https://github.com/andyshinn/meshcore-ts/issues/2), which requests
`removeMessage` plus a `suppressMessageIds()` seeding call — the seeding half matters because the
durable "this is deleted" fact lives in the consumer's database and must be replayed at startup
before packets flow. When that lands, the tombstone table becomes the seed source and the guard
below is deleted.

## Data layer

### Tombstone table

Appended to the existing `CREATE … IF NOT EXISTS` block in `src/main/storage/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS deleted_messages (
  mid TEXT PRIMARY KEY,
  ts  INTEGER NOT NULL      -- when the user deleted it
);
```

This fits the house idiom exactly: the whole schema is one `db.exec()` of idempotent `CREATE`s
re-run on every `openDb()`. There is **no migration system** — no `user_version` (it reads 0), no
migrations table, no runner, and no `ALTER TABLE` anywhere in `src/`. A new table needs none;
adding a *column* to `messages` would have been the first ever and has no safe mechanism on
installed copies. That is the deciding reason this is a separate table rather than a `deleted`
flag, independent of the hard-delete requirement.

Tombstones are kept forever, at roughly 40 bytes each. They must outlive the process: the library
rebuilds its in-memory map each session, but the id it mints for a re-heard packet is unchanged, so
a session-scoped guard would let the message return on the next launch.

### DAO

In `src/main/storage/messages.ts`, alongside `markState` and `findById`:

```ts
remove(key: string, ids: string[]): string[]      // returns the ids actually deleted
isDeleted(mid: string): boolean
```

`remove` takes a list although the UI sends exactly one — the cheap-bulk-later hook. It returns the
**ids it actually removed**, so the façade (`StateHolder.removeMessages(key, ids): string[]`) and the
route pass it straight through; the route maps an empty result to `404` and emits exactly those ids.
Both statements run inside one hand-rolled `BEGIN`/`COMMIT`, matching the only existing transaction in
the tree (`src/main/storage/search.ts:351-364`); there is no transaction helper to reuse.

**`key` scopes the delete, it is not just a lookup hint.** Both the probe and the `DELETE` filter on
`key = ? AND mid IN (…)`, so a message can never be deleted through the wrong conversation and the
key that drives the renderer's per-key cache prune is structurally the key that scoped the delete.
Enforcing this in the DAO rather than in the route means a future second caller — bulk delete,
clear-conversation — cannot skip the check.

**The id predicate is `mid`, never the integer `id`.** The table carries two and only one is
app-level:

| Column | Type | Reach |
|---|---|---|
| `mid` | `TEXT NOT NULL UNIQUE` | Becomes `Message.id` and `MessageHit.id`; crosses HTTP, WS, notifications, macros |
| `id` | `INTEGER PRIMARY KEY` | FTS5 `content_rowid` anchor only; never SELECTed into a `Message`, never crosses the wire |

The one existing `DELETE FROM messages` — `trimPerKey`, which has zero production callers —
filters on the integer `id`, so it is the wrong shape to copy.

### FTS needs no manual work

`db.ts:50-52` declares an `AFTER DELETE` trigger that reindexes:

```sql
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
END;
```

Verified empirically against the repo's own DDL: insert a row → `MATCH` finds it → `DELETE …
WHERE mid=…` → `MATCH` returns nothing → `integrity-check` passes. Deleting from `messages_fts`
by hand, or touching the integer rowid, would corrupt the index.

`conversations_fts` is unrelated — it indexes channel and contact names, and is dropped and
recreated on every `openDb()`. A message delete must not call `rebuildConversationsIndex`.

### Nothing else is coupled

`PRAGMA foreign_key_list(messages)` is empty. There is no attachments, reactions, read-state,
delivery/ACK, path-heard, or conversation-summary table; paths and `timesHeard` live inside the
`meta` JSON blob, and `state` is a plain TEXT column. `lastReadByKey` in `ui-state.json` is a
timestamp watermark containing no message ids, so it cannot desync — deleting the newest message
merely leaves the watermark ahead of the remaining rows.

### Resurrection guard

One guard, in `holder.recordLibMessage` (`src/main/state/holder.ts:322-337`): return early when
`messagesStore.isDeleted(message.id)`.

Placed there rather than inside `messagesStore.insert` deliberately. `recordLibMessage` is the only
path that **inserts** library-minted ids. Two other adapter handlers receive them
(`src/main/protocol/adapterEvents.ts:113-121`) but neither can revive a tombstoned row:

- `setMessageState` → `messagesStore.markState` is a bare `UPDATE … WHERE mid = ?` that matches
  nothing once the row is gone.
- `appendMessagePath` does call `messagesStore.insert`, but returns early when `findById` misses
  (`src/main/state/holder.ts:346-347`), so it never reaches the insert.

Their renderer-side WS handlers are `map`-based over the existing array
(`src/renderer/lib/store.ts:635-644`, `:646-666`), so they cannot re-create a row client-side
either. Local sends (`local-…`) and bridge echoes (`proxy-…`) mint random ids, so guarding
`insert` globally would buy nothing while risking suppression of a legitimate future send.

## Main process

### Route

```
DELETE /api/messages/:key/:id
```

**No Electron IPC.** This app has none of the invoke kind — `src/preload.ts` is 17 lines exposing
three `send`/`sendSync` channels, and there is not a single `ipcMain.handle` in the repo. Every
renderer→main command is authenticated HTTP to the local Hono server; every main→renderer push is
one WebSocket. Adding IPC here would also bypass the WS fan-out that keeps multiple clients
consistent.

Key-scoped so the event gets its conversation key without a lookup, mirroring the existing
`GET`/`POST /api/messages/:key`. The key is `decodeURIComponent`'d and `:id` taken raw — the split
the codebase already uses. Responses follow house convention (HTTP status plus `{error: string}`,
never a result union; no zod anywhere, so validation is hand-rolled `typeof` checks):

| Status | When |
|---|---|
| `200 {ok:true}` | Deleted |
| `404 {error}` | Unknown id |
| `400 {error}` | Key is not `ch:` or `c:` |

Note this route is immediately callable by anything holding the API key — there is exactly one
privilege level, a single Bearer token in `userData/config.json`. That is true of every existing
route including `DELETE /api/contacts/:key`, so it is consistent rather than a new exposure, but it
is a real consequence of using HTTP rather than IPC.

A façade method on `StateHolder` sits between the route and the DAO, alongside `insertMessage` and
`setMessageState`. `StateHolder` is the only *writer* of `messagesStore` in main; the one existing
direct read from outside it is `POST /api/macros/render` (`src/main/api/routes.ts:986`,
`messagesStore.findById`), which the delete route deliberately does not copy.

### Event

A **dedicated** event rather than reusing `emit.messages`:

```ts
messagesDeleted: (payload: { key: string; ids: string[] }) => void
```

Four coordinated edits, following `messagePathHeard` (same single-object-payload shape) as the
template:

1. `src/main/events/bus.ts` — emitter near `:65`, `BusEvents` entry near `:107`
2. `src/main/server.ts` — `onMessagesDeleted` broadcast near `:207`, `bus.on` near `:245`,
   `bus.off` near `:284`
3. `src/shared/types.ts` — a `WsMessage` union variant
4. `src/renderer/app/wsHandlers.ts` — a `case`

Reusing `emit.messages(key, holder.getMessagesForKey(key))` would need zero new wiring. The
dedicated event is worth the plumbing for three reasons:

- **It avoids a latent truncation.** `emit.messages` re-pushes only the newest 200 rows and
  `applyMessages` replaces the whole array, so every delete would silently clamp the client's
  window. Harmless today because no caller passes `limit`/`before`, but a real bug the moment
  load-older is wired.
- **It stops a spurious notification.** `bus.on('messages')` reaches `router.handleMessages`,
  which calls `processMessage(list[list.length-1])` — only ever the tail. Delete the newest
  message and the previous one becomes the tail; if it was never the tail while the app was
  running it is absent from `notifiedIds` and can raise a fresh OS banner for an old message.
- ~~**It gives the search panel an invalidation channel**~~ — this third reason did not survive
  implementation. The search panel splices its own local hits through an `onDeleted` callback
  instead, because `MainPane` renders either search or a conversation view and unmounts the panel
  on navigation, so only an in-panel delete can strand a hit. The event is still the right call on
  the first two reasons alone. A second WS client deleting while search is open leaves a stale hit
  until the next query — accepted. Original reasoning, kept for the record: it is what makes search coverage
  possible at all.

`bus.on('messagesDeleted', () => router.recomputeBadge())` is registered alongside the existing
`appSettings` / `channels` / `contacts` / `blockRules` recompute registrations, so the dock badge
stays correct without going through the tail path.

Everything else in main self-heals: `StateHolder` caches no messages, and channel stats and
activity are full recomputes per call.

## Renderer

### One item set

The two menus carry disjoint items today, so unifying them is the union — a larger diff than the
delete itself, and intended:

| Item | Overflow menu (received only) | Right-click (all) | After |
|---|---|---|---|
| Copy text | — | ✅ | ✅ |
| View contact | ✅ | ✅ | ✅ |
| Copy public key | ✅ | — | ✅ |
| Copy first path heard | ✅ | — | ✅ |
| Copy all paths heard | ✅ | — | ✅ |
| Re-send (failed only) | — | ✅ | ✅ |
| Block sender… | — | ✅ (all) | ✅ (received only) |
| Delete message | "Dismiss locally" *(disabled)* | — | ✅ |

Ordered inspect → navigate → act → destructive:

```
Copy text
────────────
View contact              (real pubkey only)
Copy public key           (real pubkey only)
Copy first path heard     (if a path was heard)
Copy all paths heard      (if a path was heard)
────────────
Re-send                   (state === 'failed')
Block sender…             (received only)
────────────
Delete message            (danger)
```

Separators collapse when their group is empty, so an own-message menu reduces to `Copy text` /
`Copy first path heard` / `Copy all paths heard` / `Delete message`.

Delete is labelled **"Delete message"** on every message regardless of sender, and
**"Dismiss locally"** is retired. Deleting your own message is exactly as local as hiding someone
else's, and two labels would imply a retraction that cannot happen. The local-only nature is
carried by the confirmation copy instead.

### Two behaviour changes this forces

- **Own messages gain a "…" trigger.** `OverflowMenu` currently renders only inside the quick
  bar's `!isSelf` branch. The trigger is added to the `isSelf` branch and the disabled `Delete`
  icon button removed, so delete on your own message is two clicks rather than one. Accepted for
  consistency; the button was never wired.
- **"Block sender…" is gated to received messages.** `buildMessageMenuItems` pushes it
  unconditionally (`MessageList.tsx:413-438`), so right-clicking your own message currently offers
  to block yourself. `isSelf` is already computed at `MessageList.tsx:83`. Pre-existing bug, fixed
  rather than faithfully ported.

### Mechanism

`ContextMenuEntry[]` becomes the single item model — already typed, already carrying `icon` /
`danger` / `disabled` / `hint` / `testid`, and already having a real `{kind:'separator'}` variant
rather than `OverflowMenu`'s raw `<div className="my-1 h-px bg-cs-border"/>`.

- `buildMessageMenuItems` moves from `components/MessageList.tsx` to
  `features/message-actions/menuItems.ts` and becomes the one producer, taking
  `{message, isSelf, senderName, onResend?, …}`.
- `OverflowMenu` keeps its radix `Popover` shell but renders `ContextMenuEntry[]` through its
  existing `MenuButton`, mapping `danger`→`destructive` and dropping the now-unused `soon` path.
- `components/ContextMenu.tsx` is untouched — it already consumes this type.

Two renderers, one list. The visual difference (anchored popover vs. fixed-position div) is
correct; they are different affordances.

### Confirmation

`features/message-actions/DeleteConfirmPopover.tsx` — a `Popover` from `ui/popover.tsx` with
`Button variant="destructive"`, both existing shadcn components. No hand-rolled markup.

Rendered **by the message row itself**, driven by one store field and its setter:

```ts
pendingDeleteMessageId: string | null
setPendingDeleteMessageId: (id: string | null) => void
```

When the field matches the row's message id, the row renders `<Popover open>` anchored to its own
element. Because the popover lives inside the row, Virtuoso recycling unmounts the confirm along
with the row rather than orphaning a detached anchor. The cost is that scrolling the message far
out of view dismisses the confirm — safe, if abrupt.

Both menus simply call `setPendingDeleteMessageId(id)`, so neither needs to know the popover
exists, and no `onDelete` prop is threaded through `MessageRow` → `MessageItem` →
`MessageQuickBar`. `OverflowMenu` already reads the store directly for `setActiveKey`.

An id alone is sufficient state because the rendering row already holds the message it needs for
the preview — `message.body` in the conversation views, `hit.body` in search. Note that
`MessageHit` carries both `body` and `snippet` (`src/shared/types.ts:321-324`); the confirm uses
`body`, since `snippet` contains `<mark>` tags and is meant for `dangerouslySetInnerHTML`.

Copy:

> **Delete this message?**
> *"<first ~80 chars of the body>"*
> This deletes it from this device only, and can't be undone. It stays on other devices that
> received it.
> `Cancel` · `Delete`

`onOpenAutoFocus` is **not** prevented — that is what leaves the existing macro confirm
(`panels/macros/MacroRow.tsx:64-69`) with nothing focused and no Enter-to-confirm. Cancel comes
first in DOM order so it takes focus: Escape dismisses, Enter cancels, Delete needs a deliberate
click or Tab.

Cleared on conversation switch by extending the existing reset effect at `MessageList.tsx:153-159`
to call `setPendingDeleteMessageId(null)` — unlike its neighbours `menu` / `flashId` /
`blockPrefill`, which are `MessageList` local state, this one lives in the store, so the effect
calls the setter rather than a local `setState`. Not strictly required, since the delete is keyed
by id and stays correct across a switch, but a confirm outliving the view it was opened from is
confusing.

### Store and list

`removeMessages(key, ids)` splices from `messagesByKey[key]` rather than replacing the array, and
is called from the `messagesDeleted` WS case.

A shrinking array fails all four of `MessageList`'s imperative fast paths (tail append, first
batch, head prepend, in-place map) and lands on the fallback `replace` at `MessageList.tsx:261-263`.
That already works — it preserves scroll and rebuilds date separators and the unread divider via
`buildItems`.

> **Corrected during implementation.** This section originally called for an explicit removal branch,
> on the assumption that a full `replace` for a one-row delete is wasteful on a long conversation.
> One was built and then removed: its body was byte-identical to the fallback, so it saved nothing,
> and because it built an id `Set` unconditionally it made *every* fallback sync measurably slower.
> Virtuoso does expose `deleteRange(offset, count)`, so a real optimisation is possible — but the
> rendered item indices include date dividers and the unread divider, both owned by `buildItems`, so
> a correct `deleteRange` would also have to drop a newly-empty date divider and re-derive
> `firstUnreadIdx` when the removed row sat above it. That index math is not worth it for a window
> capped at 200 rows. Deletions land on the fallback deliberately.

Derived state recomputes for free on the identity change: unread counts, LeftNav badges, keyboard
unread nav, "last active", search sender-filter options. `useChannelStats` and `useChannelActivity`
subscribe to `messagesByKey[key]` purely as a refetch trigger and re-query the server, so they
self-correct — which is precisely what a renderer-only optimistic removal would have broken.

### Surfaces

| Surface | Coverage |
|---|---|
| `panels/ChannelView.tsx` | Action bar + right-click |
| `panels/DMView.tsx` | Action bar + right-click |
| `panels/search/MessageRow.tsx` | Delete + local invalidation |
| `panels/Unreads.tsx` | Out of scope — static previews |
| `panels/repeater-admin/MessagesTab.tsx` | **Deleted** — see below |

`MessagesTab.tsx` is orphaned. The tab union is `'login' | 'path' | 'status' | 'acl' |
'neighbours' | 'owner' | 'cli'` (`lib/store.ts:87`), the panel's `TABS` array and render switch
cover exactly those seven (`repeater-admin/index.tsx:145-151`), and `grep -rn MessagesTab src/
tests/` matches only its own `export function` line. Selecting a repeater or sensor contact renders
`RepeaterAdmin` *instead of* `DMView` (`shell/MainPane.tsx:120-123`), so there is no route to a
repeater conversation view at all, and the CLI tab keeps its own local history rather than going
through `messagesByKey`. The file is removed as part of this branch: 235 lines that would otherwise
acquire a delete handler that can never run.

### Search invalidation

The search panel holds page-accumulated `MessageHit[]` in local `useState`
(`panels/search/index.tsx:36-38`), paginated against a server `total`, with nothing to invalidate
it. On `messagesDeleted` it filters its local array by the deleted ids and decrements `total`.

Deliberately **not** re-running the query to backfill the now-missing row from the next page — it
would fight the user's scroll position for one row.

### Dangling references

| Ref | Behaviour on a dead id | Action |
|---|---|---|
| `selectedMessageId` | Right rail drops its message sections via `.find() ?? null` | **Clear it** — the stale id keeps driving the `selectedId === id ? null : id` toggle |
| `pendingJumpMid` | Consuming effect returns early and never calls `onJumpConsumed`, so it lingers and can misfire on a later view | **Clear it** — `menuActions.ts:42-45` already documents this hazard |
| Standing OS notification | `onClick` emits `focusMessage` with a dead id (`notifications/router.ts:119`). **Not** a no-op — `menuActions.ts:33-34` switches conversation *and* re-installs a stale `pendingJumpMid`, reintroducing the hazard the row above clears | **Leave alone** — the presenter exposes only `clearGroup(conversationKey)`, so per-id retraction is a notifications change. The stale id is bounded by `focusFirstUnread`, which always sets `pendingJump` (`menuActions.ts:41-45`) precisely to flush leftovers |

## Testing

Storage and route tests **must** live under `tests/integration/`. Only that project wires the
temp-userData setup (`tests/support/sqlite-temp.ts` via `tests/integration/setup.ts:12`), which
injects a temp dir per test and closes the DB singleton on cleanup. A `tests/unit` test importing
`src/main/storage` would throw `userData directory not set` on the first `openDb()` —
`userDataDir()` deliberately has no fallback and does not import `electron`
(`src/main/runtime/userData.ts:12-19`).

| Layer | Location | Assertions |
|---|---|---|
| Storage | `tests/integration/storage/` | Row removed; **FTS no longer matches** (no existing test asserts this); tombstone written; `remove` returns 0 for an unknown mid |
| Resurrection | `tests/integration/inbound/` | Record a channel message, delete it, replay the same `messageUpserted` id, assert the row stays gone |
| Route | `tests/integration/api/` | `200 {ok:true}`; `404` unknown id; `400` bad key — via `createRoutes()` in-process, no server bound, no auth middleware |
| Event | `tests/integration/` | `bus.on('messagesDeleted')` fires `{key, ids}`; `handleMessages` is **not** reached |
| Menu items | `tests/unit/renderer/` | Delete present on own and received; Block sender absent on own |
| Components | `tests/component/` | Click delete → confirm appears, api **not** called; confirm → called with the right id; cancel → not called; deleting the last message of an open conversation renders an empty state |

`@testing-library/user-event` is not a dependency — component tests use `fireEvent`. The
`ResizeObserver` stub radix needs is already in `tests/component/setup.ts`.

The empty-state case is worth pinning explicitly: deleting the last message of an open conversation
does not hit `MessageList`'s `EmptyState` short-circuit, because `initialItemsRef` is still
non-empty. Virtuoso's own `EmptyPlaceholder` handles it — an accident of two code paths agreeing.

Testids: `delete-message-menu-item`, `confirm-delete-message`, `cancel-delete-message`.

In this worktree, run tooling via `npx` (`npx vitest run --project integration`, `npx tsc
--noEmit`, `npx biome check src tests`) rather than the `pnpm` wrappers.

## Rejected alternatives

**Undo toast.** `src/renderer/lib/notify.ts:5-9` returns `undefined` when
`appSettings.toasts.enabled` is false, so every `notify.*` renders nothing — an undo living only in
a toast would be invisible for those users, which is worse than no undo. The default duration is 4s,
too short. And since the row is genuinely gone from SQLite, undo means holding it in memory and
re-inserting, which returns it with a new rowid and must also reconcile with the tombstone. The
confirmation is the safety net; the protected object is one message on one device.

**Soft delete (`deleted` flag on `messages`).** Explicitly ruled out by the requirement, and
independently blocked: it would be the first column ever added to an existing table in a schema
with no migration mechanism.

**Modal `AlertDialog` for the confirm.** More robust — survives row recycling, identical from every
surface, focus-trapped. Rejected in favour of the lighter anchored popover, which matches the
existing `MacroRow` confirm.

**Reusing `emit.messages`.** Zero new wiring, but truncates the client window to 200 rows, routes
through the notification tail path, and leaves search with nothing to listen to.

**Tombstoning channel messages only.** DMs cannot resurrect, so tombstones are strictly unnecessary
for them. Rejected: it saves nothing measurable and makes the delete path asymmetric.

## Known bugs left alone

Named so they are on the record, not silently inherited:

- **`deleteChannel` / `deleteContact` do not clear history.** `holder.removeChannel` and
  `holder.removeContact` filter only the JSON-backed arrays; no message row is touched. The menu
  items are labelled "Delete from app (clears history)" and "Remove (clears history)". Message rows
  already outlive their conversations, and re-adding a channel with the same name — the key is
  `ch:<name>` — resurfaces its full history. A real bug, but it belongs to clear-conversation.
- **Block-rule `matchCount` inflation.** Bumped once at first sight
  (`src/main/blocking/store.ts:103-113`), never decremented, so deleting a blocked message leaves
  the tally high. Whether it is a historical tally or a live count is undecided.
- **Cmd+K "Jump to unread (N)"** uses `m.ts > lastRead` alone
  (`features/command-palette/items/goto.ts:38`), ignoring `m.state` and `meta.blocked`, so it
  already disagrees with `useUnreads`. Unrelated to deletion.
- **No `VACUUM` anywhere.** Irrelevant for single-row deletes; would matter for a bulk feature.
