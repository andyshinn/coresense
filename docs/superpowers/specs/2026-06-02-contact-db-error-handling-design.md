# Contact Database Error Handling & Discovery Notifications — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design); pending implementation plan
**Branch:** `main` (work to be branched per worktree convention)

## Summary

Four related fixes to harden contact-database handling in CoreSense (Electron + React
desktop client for MeshCore) and add a discovery notification:

1. **Check the CMD_ADD_UPDATE_CONTACT reply.** Today `addContactToRadio` writes the frame
   and optimistically marks the contact on-radio without awaiting any reply. Inspect the
   reply; treat `RESP_ERR` with error code `0x03` (`ERR_CODE_TABLE_FULL`) as "database
   full" and surface it: *"Contact list full — remove a contact or enable
   overwrite-oldest."*
2. **Async push codes `0x8F` / `0x90`** — already wired in the frame reader. Confirm and
   extend: `0x8F PUSH_CODE_CONTACT_DELETED` removes the contact locally (done) and now
   also raises a toast + an info-level tslog line; `0x90 PUSH_CODE_CONTACTS_FULL` already
   warns the user (done, unchanged).
3. **Deletion toast** when a contact is removed. The firmware-eviction path (`0x8F`) is
   currently silent — add a toast. User-initiated deletes already toast at every call
   site and are left as-is.
4. **"Discovered contact" native notification** fired the first time a contact is ever
   heard, for all contact kinds, gated by a new `discoveredContact` toggle under
   Notification settings (default **enabled**).

Firmware truth: error/push/command codes are already catalogued in
[`src/main/protocol/codes.ts`](../../../src/main/protocol/codes.ts). `ERR_CODE_TABLE_FULL`
is the firmware's `[RESP_ERR=0x01][0x03]` reply to `CMD_ADD_UPDATE_CONTACT` when the
on-device contact store is full and overwrite-oldest is off (or all slots are favourites).

## Goals

- Never silently mark a contact on-radio when the radio actually rejected it.
- Surface "store full" consistently for both the synchronous add reply (`ERR_CODE_TABLE_FULL`)
  and the asynchronous `PUSH_CODE_CONTACTS_FULL`.
- Tell the user (toast) when a contact disappears because the radio evicted it.
- Notify on first discovery of any new node, user-controllable via existing settings.
- Log evictions in tslog for diagnosis.

## Non-Goals

- Reworking the optimistic-update model for other device writes.
- Auto-freeing space on the radio when full (no automatic eviction of our own).
- Fixing the broader "notification click doesn't navigate" bug noted in `NOTES.md`
  (the discovered notification wires click→focus the same way message notifications do).
- Unifying user-initiated delete toast wording with the eviction toast (intentionally
  left as-is — call sites already show "Removed X from radio").
- De-duplicating discovered notifications beyond the first-sighting gate.

## Current State (verified)

- `addContactToRadio` ([session.ts:599](../../../src/main/protocol/session.ts#L599)) does
  `await this.writeFrame(frame)` then immediately `discoveredStore.setOnRadio(pk, true)` +
  `upsertOnRadioContact` + `scheduleContactsResync()`. **No reply is awaited.**
- The generic `RESP.OK / RESP.ERR` handler
  ([session.ts:1675](../../../src/main/protocol/session.ts#L1675)) resolves the FIFO ack
  queue or fails an in-flight DM. It reads only `frame[0]` (the code) — **never `frame[1]`
  (the error-code byte).**
- `awaitAck()` ([session.ts:1272](../../../src/main/protocol/session.ts#L1272)) resolves a
  bare `Promise<boolean>`. ~8 callers (`setChannel`, `setRadioParams`, `setRadioTxPower`,
  the SET_* settings writes) consume it as a boolean.
- Push handling ([session.ts:1476-1492](../../../src/main/protocol/session.ts#L1476-L1492)):
  `PUSH.CONTACT_DELETED (0x8f)` already removes the contact (DB `setOnRadio(false)` +
  `holder.removeContact` + `emit.contacts` + `emit.discovered`) and `log.debug`s it;
  `PUSH.CONTACTS_FULL (0x90)` already `emit.error(...)` + `log.warn`. These run in the
  single `handleFrame` reader, so they fire for unsolicited pushes.
- `ingestContact` ([session.ts:1769](../../../src/main/protocol/session.ts#L1769)) is the
  single upsert path for both `'sync'` (GET_CONTACTS) and `'advert'` (PUSH_NEW_ADVERT).
- Toasts: `notify.{error,success,info}` ([notify.ts](../../../src/renderer/lib/notify.ts))
  wrap `sonner`, gated by the global `toasts.enabled`. Precedent for a main→renderer toast
  is the `pathLearned` event → `notify.success`
  ([wsHandlers.ts:118](../../../src/renderer/app/wsHandlers.ts#L118)).
- Native notifications: [`notifications.ts`](../../../src/main/notifications.ts) is the
  main-process router, gated per-kind by `settings.notifications.*`, honoring `sound` and
  `suppressWhenFocused`.
- Renderer add/remove call sites already `catch → notify.error(...)`
  ([ContactRows.tsx:80-95](../../../src/renderer/panels/contacts/ContactRows.tsx#L80-L95))
  and bulk ops use `Promise.all` (first rejection → one toast). `request()`
  ([api.ts:33](../../../src/renderer/lib/api.ts#L33)) throws `Error("<status> <body>")` on
  non-2xx.

## Architecture Decision: generalize the ack result (Approach A)

Replace the ack's `boolean` payload with a small struct so device writes can read the
firmware error code:

```ts
export interface AckResult { ok: boolean; errorCode?: number }
```

- `PendingAck.resolve` becomes `(r: AckResult) => void`; `awaitAck()` returns
  `Promise<AckResult>`; `resolveNextAck(ok, errorCode?)` forwards the code.
- The `RESP.OK / RESP.ERR` handler computes
  `errorCode = code === RESP.ERR ? frame[1] : undefined` and calls
  `resolveNextAck(code === RESP.OK, errorCode)`.
- Existing boolean callers get a one-line change: `return (await ack.promise).ok` (or
  `const r = await ack.promise; … r.ok`). Behavior unchanged for them.

Rejected alternative (B): a dedicated one-shot waiter just for add-contact, leaving
`awaitAck` untouched. Avoids the ripple but creates two ack paths competing for the same
single OK/ERR reply — more fragile ordering. Chosen A for a clean, reusable mechanism.

Add a named error constant to `codes.ts` (only the value we actually need and have
verified — `0x03`, given by the firmware's `[RESP_ERR][0x03]` table-full reply):

```ts
export const ERR_CODE = {
  TABLE_FULL: 0x03,
} as const;
```

## Item 1 — Check the ADD_UPDATE_CONTACT reply (TABLE_FULL)

`addContactToRadio` registers the ack **before** `writeFrame` (mirroring `setChannel`),
then awaits it:

- `result.ok` → proceed exactly as today (`setOnRadio(true)`, `upsertOnRadioContact`,
  `emitDiscovered`, `scheduleContactsResync`).
- `result.errorCode === ERR_CODE.TABLE_FULL` → **do not** mark on-radio or upsert;
  `log.warn('add contact rejected: contact table full <pk12>')`; throw a new
  `ContactTableFullError` (in [`errors.ts`](../../../src/main/protocol/errors.ts)) whose
  message is the user-facing string *"Contact list full — remove a contact or enable
  overwrite-oldest."*
- Any other `!ok` (other error code, or timeout → `ok:false, errorCode:undefined`) →
  throw a generic error as today; existing call-site `catch` surfaces it.

**Route** ([routes.ts:536](../../../src/main/api/routes.ts#L536)): map `ContactTableFullError`
to HTTP 409 `{ error: <message>, code: 'CONTACT_TABLE_FULL' }` (keep the existing
`UnknownContactError` → 422 and generic → 503 branches).

**Renderer surfacing:** tidy `request()` so it surfaces the server JSON `error` field as the
thrown `Error.message` (instead of the raw `"<status> {json}"` body). Existing
`catch → notify.error` blocks then show the friendly message; bulk `Promise.all` adds
reject on the first failure → a single toast. No new main→renderer plumbing for this path.

## Item 2 — Async push codes 0x8F / 0x90

Already handled. Changes:

- `PUSH.CONTACT_DELETED (0x8f)`: keep the local removal; look up the contact name
  (holder/discovered) **before** removal for the toast (Item 3); upgrade `log.debug` →
  `log.info('contact evicted by radio: <name> <pk12>')` (the requested tslog line).
- `PUSH.CONTACTS_FULL (0x90)`: unchanged (already `emit.error` + `log.warn`).

## Item 3 — Deletion toast (eviction path)

- New bus event `emit.contactEvicted({ name })` + `WsMessage` variant
  `{ type: 'contactEvicted'; payload: { name: string } }` (mirroring `pathLearned`).
- Emitted from the `0x8F` handler after computing the name, before/after local removal.
- `wsHandlers` adds `case 'contactEvicted': notify.info(\`Contact removed by radio: ${name}\`)`.
- User-initiated deletes keep their existing per-call-site success toasts (unchanged).

## Item 4 — "Discovered contact" native notification

**Setting:**
- Add `discoveredContact: boolean` to `AppSettings.notifications`
  ([types.ts:323](../../../src/shared/types.ts#L323)); `DEFAULT_APP_SETTINGS.notifications.discoveredContact = true`.
- Extend `eqNotifications` and add a `Toggle` row in
  [`Notifications.tsx`](../../../src/renderer/panels/settings/app/Notifications.tsx)
  ("Discovered contacts" — description: "When a never-before-seen node is first heard.").

**Detection (first-ever sighting):**
- In `ingestContact`, only for `source === 'advert'`, read `discoveredStore.get(pubkey)`
  **before** the upsert; `isNew = !existingRow`.
- When `isNew`, `emit.contactDiscovered({ key: 'c:'+pk, name, kind })` (all kinds).
- `'sync'` source never notifies (GET_CONTACTS is the device listing what it already
  stores). Persisted DB rows from prior sessions mean "first discovered" is first-ever,
  not per-session.

**Fire (native OS notification):**
- New bus event `contactDiscovered`; [`notifications.ts`](../../../src/main/notifications.ts)
  subscribes via `bus.on('contactDiscovered', onContactDiscovered)` in `startNotifications`.
- `onContactDiscovered` fires a native `Notification` when `policy.discoveredContact` is on,
  honoring `sound` and `suppressWhenFocused` (skip when the main window is focused — the new
  contact is visible in the list anyway, consistent with all other kinds — confirmed with
  user). Title e.g. "New contact discovered", body the contact name.
- `n.on('click')` focuses the contact: `emit.menuAction({ kind: 'focusKey', key })`
  (same pattern as message notifications).

## Data Flow

```
ADD reply:  CMD_ADD_UPDATE_CONTACT → RESP_OK | RESP_ERR[0x03]
            → handleFrame reads frame[1] → resolveNextAck(ok, errorCode)
            → addContactToRadio awaits AckResult
              ok → optimistic on-radio commit
              TABLE_FULL → log.warn + throw ContactTableFullError → route 409 → toast

eviction:   PUSH_CONTACT_DELETED(0x8F) → handleFrame → remove local + log.info
            → emit.contactEvicted{name} → ws → notify.info toast

discovery:  PUSH_NEW_ADVERT(0x8A) → ingestContact('advert')
            → isNew? emit.contactDiscovered{key,name,kind}
            → notifications.ts → native Notification (policy.discoveredContact)
```

## Testing

Follow the repo's vitest + Playwright conventions.

- **Unit (protocol/session):** `addContactToRadio` resolves on `RESP_OK` and commits;
  on `RESP_ERR[0x03]` throws `ContactTableFullError` and leaves `on_radio` unchanged; on
  timeout throws generically. `AckResult` threading: existing boolean callers still
  behave (a `setChannel` smoke test).
- **Unit:** `0x8F` handler emits `contactEvicted` with the resolved name and removes the
  contact; `log.info` called. `ingestContact` emits `contactDiscovered` exactly once for a
  brand-new advert pubkey and **not** for a `'sync'` record nor a re-advert of a known
  pubkey.
- **Unit (notifications.ts):** `onContactDiscovered` fires only when
  `policy.discoveredContact` is on; suppressed when focused; click emits `focusKey`.
- **Settings:** default `discoveredContact === true`; toggle round-trips through
  `eqNotifications` / save.
- **Renderer:** `request()` surfaces server `error` field; an add returning 409
  `CONTACT_TABLE_FULL` produces the friendly `notify.error` message.

## Open Questions

None outstanding (surfacing, contact-kind scope, deletion-toast scope, focus-suppression
all confirmed with the user).
