# Channel addition flow

Add UI for creating and joining MeshCore channels from CoreSense, matching the popover mockup in `project/MeshCore Desktop.html`. Four add-types: Create private (generate key), Join private (paste key), Join public (one-tap), Join hashtag (name-keyed). Backend uses the existing `PUT /api/channels/:key` + `POST /api/channels/:key/push-to-device` sequence — no new endpoints.

## Goals

- A connected radio can have channels added directly from the LeftNav without dropping to a terminal or the firmware's serial CLI.
- Match the mockup's popover-with-four-actions structure.
- Reuse existing channel write/push primitives; do not introduce a parallel "create" path that the rest of the codebase would have to learn about.

## Non-goals

- QR code scanning (deferred — needs camera permissions + capture UI).
- Importing channels via `meshcore://` URIs (separate flow, already partially scaffolded).
- Editing an existing channel's name or secret (rename/rekey is a separate concern).
- Adding channels without a connected radio. The popover is gated to `transport === 'connected'`.

## User flow

1. User clicks the `+` icon next to "Channels" in the LeftNav (or right-clicks the "Channels" parent row → "Add channel…", or invokes the Command Palette entry).
2. A Radix `Popover` opens anchored to the trigger, with state `pick`. Four rows are shown, matching the mockup:
   - Create private channel — "Generate a new shared key"
   - Join private channel — "Paste a shared key"
   - Join public channel — "Anyone in range"
   - Join hashtag channel — "Open, name-keyed"
3. Picking a row transitions the popover to state `form` (except Join public, which submits immediately). The form is inline inside the same popover and contains only the fields needed for that type plus Cancel / Add buttons.
4. On Add: client validates, then issues `PUT /api/channels/ch:<name>` followed by `POST /api/channels/ch:<name>/push-to-device`. On success the popover closes, a toast announces the slot ("Added 'Foo' to channel slot 3"), and `setActiveKey('ch:<name>')` selects the new channel.
5. On any failure: popover stays open, error surfaced inline. If the failure happens after the PUT but before/in the push, the client deletes the channel via `DELETE /api/channels/:key` to roll back app state.

## Gating: connection required

The `+` button, the right-click "Add channel…" entry, and the Command Palette entry are all disabled when `useStore((s) => s.transportState) !== 'connected'`. Hover/title text: "Connect a radio to add channels." If the transport state changes to disconnected while the popover is open, its body switches to a "Lost connection" message and Add is disabled; a final pre-flight check before each API call guards the race.

## Form fields per type

| Action | `kind` | Fields | What client submits to PUT |
|---|---|---|---|
| Create private | `private` | Name | `{ key: 'ch:<name>', name, kind: 'private', secretHex: <16 random bytes hex> }` |
| Join private | `private` | Name + Shared key (hex) | `{ key: 'ch:<name>', name, kind: 'private', secretHex: <user-pasted, normalized> }` |
| Join public | `public` | None (one-tap) | `{ key: 'ch:Public', name: 'Public', kind: 'public' }` (no `secretHex`; server-side `pushChannelToDevice` calls `session.deriveSecret('Public')`) |
| Join hashtag | `hashtag` | Name | `{ key: 'ch:<name>', name, kind: 'hashtag' }` (no `secretHex`; server derives via `session.deriveSecret(name)`) |

The "no secret in PUT body" pattern relies on the existing route at `src/main/api/routes.ts:387`, which falls back to `session.deriveSecret(channel.name)` when `channel.secretHex` is absent.

## Validation

**Name (all types except Join public):**
- Trim leading/trailing whitespace before evaluating.
- Length: 1–32 characters (matches firmware's `name` field limit observed elsewhere in the codebase).
- Uniqueness: reject if `holder.getChannels()` already contains a channel with the same `key` (`ch:<name>`). Inline error: `"A channel named '<name>' already exists"`. Add is disabled while this condition holds.

**Shared key (Join private only):**
- Normalize: strip all whitespace, strip an optional leading `0x`, lowercase.
- Must be exactly 32 hex characters (16 bytes). Reject anything else with: `"Shared key must be 32 hex characters (16 bytes)"`.

**Join public special-case:**
- If `ch:Public` already exists in app storage, the "Join public channel" row in the picker renders as non-clickable with subtitle "Already added".

## Backend wiring

No new endpoints, no new store fields. The flow is two existing API calls in sequence:

1. `PUT /api/channels/:key` — upserts the channel into app storage (`stateHolder.upsertChannel` then `emit.channels`). Body is the full `Channel` object built per the table above. The route at `src/main/api/routes.ts:341` already enforces `body.key === key` and emits a `channels` event.
2. `POST /api/channels/:key/push-to-device` — picks a free slot via `session.pickFreeSlot()`, calls `session.setChannel(idx, name, secretHex ?? deriveSecret(name))`, then stamps the confirmed `idx` and (if derived) `secretHex` back via `holder.upsertChannel`.

## Atomicity & rollback

If the PUT succeeds but the push fails (409 no free slots, 503 radio rejected, network error), the client issues `DELETE /api/channels/:key` to remove the orphan app-storage row before surfacing the error. This keeps app state and device state consistent.

The reverse case (push succeeds, but client somehow doesn't see the 200) is not handled specially — the next radio enumeration via `RESP_CHANNEL_INFO` will reflect the truth, and `session.markChannelPresent` will have already updated local presence.

## Components & files

**New:**

- `src/renderer/components/AddChannelPopover.tsx` (~200 LOC)
  - Controlled component: props `{ open, onOpenChange, anchor }`. Uses Radix Popover under the hood (already a project dependency).
  - Internal states: `'pick' | { type: 'create-private' | 'join-private' | 'join-hashtag', name: string, secretHex?: string, error?: string, submitting?: boolean }`.
  - "Join public" path triggers submit immediately from `'pick'` without entering `'form'`.
  - Read `transportState` and `channels` from the store; render "Lost connection" body when not connected.
  - Reset internal state when `open` flips from true to false.
- `src/renderer/lib/randomSecret.ts` (~10 LOC)
  - `export function generate16ByteHex(): string` — uses `crypto.getRandomValues(new Uint8Array(16))` and lowercase hex-encodes.

**Modified:**

- `src/renderer/shell/LeftNav.tsx`
  - `ParentBranch` for "Channels" gains a trailing `+` button when the row's identity is "Channels" — passed via a new optional prop (e.g. `trailingAction?: ReactNode`) to keep the abstraction generic.
  - The `+` button is a `Popover.Trigger`-equivalent (controlled). When `transport !== 'connected'`, it renders disabled with the tooltip.
  - The parent row gets a new `onContextMenu` handler that opens a small `ContextMenu` with a single item "Add channel…", which sets the controlled popover open state to true. Same gating rules.
- `src/renderer/features/CommandPalette.tsx`
  - Add an "Add channel…" command. Disabled when `transport !== 'connected'`. On activation, sets the controlled popover open state to true (via a store flag or a small `useUiCommands` bus — implementation detail for the plan).

**Unchanged:**

- `src/renderer/lib/api.ts` — `putChannel` and `pushChannelToDevice` are sufficient.
- `src/main/api/routes.ts` — existing PUT and push-to-device routes handle every case.
- `src/shared/types.ts` — `Channel` already has the fields we need (`key`, `name`, `kind`, optional `secretHex`).

## Error handling

| Failure | Where surfaced | Recovery |
|---|---|---|
| Empty name, dup name | Inline under name field | Add stays disabled; no API call. |
| Bad hex secret | Inline under secret field | Add stays disabled; no API call. |
| PUT fails (network, 5xx) | Inline below the form, generic error | "Retry" button re-issues PUT. App storage unchanged. |
| Push 409 (all slots used) | Inline below the form, with explanation | Roll back PUT via DELETE; user closes / removes another channel first. |
| Push 503 (radio rejected / timeout) | Inline below the form | Roll back PUT via DELETE; user retries. |
| Transport drops mid-flow | Popover body swaps to "Lost connection" | Pre-flight before the API calls re-checks; no half-state if it changed between mount and submit. |

Toasts are reserved for success (`notify.success(...)`); failures stay inline so the user keeps the context of what they were typing.

## Testing notes

Manual verification path (no automated UI tests in scope):

1. Connect a radio with at least one free slot.
2. Click `+`; verify popover opens with four rows.
3. Create private — enter a unique name, Add. Toast appears, channel selected, slot stamped (visible in right-rail Channel info).
4. Join public — click row. Toast, `ch:Public` exists, slot stamped. Reopen popover — "Join public" row shows "Already added".
5. Join private — enter name + paste 32 hex chars. Toast, channel selected. Validate that pasting `0xABCD…` and `ab cd …` both normalize correctly.
6. Join hashtag — enter name, Add. Verify secret was derived (channel info shows a secret prefix).
7. Duplicate name — try to create a second channel with the same name as an existing one; expect inline error.
8. Fill 16 slots, then attempt Create private — expect "All 16 channel slots are in use" inline error and that app storage didn't accumulate an orphan row.
9. Disconnect radio; verify `+` and right-click and palette entries all show disabled with tooltip. Open popover via palette before disconnect, then disconnect — popover swaps to "Lost connection".

Confirm `pnpm typecheck` and `pnpm lint` pass after changes.

## Open questions

None blocking. The popover-controlled-from-multiple-triggers wiring (LeftNav `+`, context menu, palette) is the one detail with multiple reasonable implementations; the plan can settle whether to use a UI store flag, a small event bus, or lifting state into `AppShell`.
