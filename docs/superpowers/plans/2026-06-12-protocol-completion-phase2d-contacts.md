# Protocol Completion — Phase 2d: Contacts Iterator Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate the contacts cluster — the GET_CONTACTS iterator (`RESP_CONTACTS_START` / `RESP_CONTACT` / `RESP_END_OF_CONTACTS`), the `PUSH_NEW_ADVERT` and `PUSH_CONTACT_DELETED` push handlers, the contact wire encoders/decoders, and the contact-ingest/discovered-store logic — into a stateful `contacts.ts` feature module, registered in the `FeatureRegistry`. Behavior-preserving.

**Architecture / the crux (sync-coordination bridge):** The iterator handlers currently drive the connect handshake's progress bar (`updateSyncProgress`) and resolve its `contactsStartWaiter` / `contactsDoneWaiter` promises. We do NOT move that handshake machinery. Instead the moved feature emits a single synchronous bus signal `emit.contactsSync(signal)`, and a permanent session subscription (`onContactsSync`, wired in `start()` / torn down in `stop()`) translates it into the EXACT existing `updateSyncProgress(...)` + `resolveWaiter(...)` calls. Because Node's `EventEmitter.emit` runs listeners synchronously, the feature's `emit.contactsSync(...)` invokes `onContactsSync` synchronously — identical timing to today's direct calls. The handshake code (armWaiter, the `await contactsStart` / `await contactsDone` sequence) is UNCHANGED.

**Tech Stack:** TypeScript, Vitest, `pnpm typecheck`, Biome (`pnpm exec biome check src tests`).

**Process constraints (carry forward):** stay on `feat/protocol-completion`; never `git checkout`/`switch`/`reset` (reviewers inspect read-only); never touch `OwnerCard.tsx`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; `git commit` needs sandbox disabled; biome scope `src tests`; **encoders/decoders move VERBATIM** (rename `build*`→`encode*`, `parse*`→`decode*`; keep byte layout exactly).

---

## Module: `src/main/protocol/features/contacts.ts`

Owns, at completion:
- **Wire encoders:** `encodeGetContacts(since?)`, `encodeAddUpdateContact(input)` + `UpdateContactInput`, `encodeResetPath(pk)`, `encodeRemoveContact(pk)`.
- **Wire decoders:** `decodeContact(frame)` + `ContactRecord`, `decodeContactsStart(frame)`, `decodeEndOfContacts(frame)`, `decodeContactDeleted(frame)`.
- **Ingest/app-logic (moved from session private methods):** `ingestContact(ctx, record, source)`, `upsertOnRadioContact(record)`, `emitDiscovered()`, `shouldAutoAdd(advType)`, `scheduleContactsResync(ctx)` (+ module-level `resyncTimer`).
- **Iterator state (module-level):** `iterTotal`, `iterCount`, `syncSeen`.
- **`contactsFeature: Feature`** handling `[RESP.CONTACTS_START, RESP.CONTACT, RESP.END_OF_CONTACTS, PUSH.NEW_ADVERT, PUSH.CONTACT_DELETED]`, plus a `reset()` for disconnect.

`advTypeToKind` / `contactKindToAdvType`: import the existing helpers (do NOT duplicate). `advTypeToKind` exists in `src/main/storage/discoveredContacts.ts:27` (and a dup in session.ts:2173). Prefer the shared one — see Task 3.

---

## Task 1: Contacts wire layer → `contacts.ts` (mechanical, LOW RISK)

Move ONLY the encoders/decoders/types. Handlers + ingest stay in session, now calling the moved `encode*`/`decode*`.

**Files:** Create `src/main/protocol/features/contacts.ts`, `tests/unit/main/protocol/features/contacts.test.ts`. Modify `session.ts`, `encode.ts`, `decode.ts`, `encode.test.ts`, `decode.test.ts`.

### - [ ] Step 1: Create `contacts.ts` with the 4 encoders + 4 decoders + `ContactRecord` + `UpdateContactInput`

Move verbatim from `encode.ts` (`buildGetContacts`→`encodeGetContacts`, `buildAddUpdateContact`→`encodeAddUpdateContact` + `UpdateContactInput`, `buildResetPath`→`encodeResetPath`, `buildRemoveContact`→`encodeRemoveContact`) and `decode.ts` (`parseContact`→`decodeContact` + `ContactRecord` + the `CONTACT_FRAME_LEN` const, `parseContactsStart`→`decodeContactsStart`, `parseEndOfContacts`→`decodeEndOfContacts`, `parseContactDeleted`→`decodeContactDeleted`). Imports: `{ Buffer } from 'node:buffer'`, `{ CMD } from '../codes'`. (No Feature yet in Task 1.)

### - [ ] Step 2: Unit test `contacts.test.ts`

Relocate the byte-exact cases from `encode.test.ts` (the contact builders) and `decode.test.ts` (`parseContact`, `parseContactsStart` / `parseEndOfContacts`) into `contacts.test.ts`, renamed. Preserve every byte assertion.

### - [ ] Step 3: Run `pnpm test:unit -- "features/contacts"` → PASS.

### - [ ] Step 4: Repoint session call sites (encoders only; decoders in handlers)
- Encoders: `buildGetContacts()`→`encodeGetContacts()` (handshake ~1476, scheduleContactsResync ~1771); `buildAddUpdateContact(...)`→`encodeAddUpdateContact(...)` (~595, ~642, ~710); `buildResetPath(...)`→`encodeResetPath(...)` (~412, ~623); `buildRemoveContact(...)`→`encodeRemoveContact(...)` (~690).
- Decoders: `parseContact`→`decodeContact`, `parseContactsStart`→`decodeContactsStart`, `parseEndOfContacts`→`decodeEndOfContacts`, `parseContactDeleted`→`decodeContactDeleted` (in the still-in-session handlers ~1551–1616).
- Imports: remove the 4 `build*` from the `./encode` block and the 4 `parse*`/`ContactRecord`/`UpdateContactInput` from the `./decode` block; add `import { ... } from './features/contacts'`. Check `ContactRecord`/`UpdateContactInput` are imported from contacts where still referenced in session (ingest methods + write methods).

### - [ ] Step 5: Remove the moved defs from `encode.ts` / `decode.ts` (+ the `CONTACT_FRAME_LEN` const).

### - [ ] Step 6: Relocate the moved test cases out of `encode.test.ts` / `decode.test.ts` (remove imports + cases; sweep for orphaned `Buffer`/`frameBuf`/`pk` helpers).

### - [ ] Step 7: Full suite + biome `--write`; `pnpm typecheck` 0. Commit (`refactor(protocol): migrate contacts wire layer to a feature module`).

---

## Task 2: Move contact ingest/app-logic into `contacts.ts` (MEDIUM RISK)

Move the private session methods `ingestContact`, `upsertOnRadioContact`, `emitDiscovered`, `shouldAutoAdd`, `scheduleContactsResync` + the iterator state fields + `resyncTimer` into `contacts.ts`. Session handlers + write methods call the module functions. Handlers STILL dispatch in session's `onPacket` (the Feature comes in Task 3).

**Files:** Modify `contacts.ts`, `session.ts`. Add `tests/unit/main/protocol/features/contacts-ingest.test.ts` (or extend the integration tests in Task 3).

### - [ ] Step 1: Add to `contacts.ts`
- Module state: `let iterTotal = 0; let iterCount = 0; let syncSeen: string[] = []; let resyncTimer: NodeJS.Timeout | null = null;`
- `export function emitDiscovered(): void` — verbatim body (uses `stateHolder()`, `discoveredStore`, `emit.discovered`).
- `export function shouldAutoAdd(advType: number): boolean` — verbatim (uses `stateHolder().getAutoAddConfig()`, `ADV_TYPE`).
- `export function scheduleContactsResync(ctx: FeatureContext): void` — verbatim but `this.writeFrame(buildGetContacts())` → `ctx.writeFrame(encodeGetContacts())`, `this.resyncTimer` → module `resyncTimer`.
- `export function upsertOnRadioContact(record: ContactRecord): void` — verbatim body (uses `stateHolder`, `advTypeToKind`, `hopsFromOutPathLen`, `emit.contacts`).
- `export function ingestContact(ctx: FeatureContext, record: ContactRecord, source: 'sync' | 'advert'): void` — verbatim but `this.upsertOnRadioContact` → `upsertOnRadioContact`, `this.emitDiscovered()` → `emitDiscovered()`, `this.shouldAutoAdd` → `shouldAutoAdd`, `this.scheduleContactsResync()` → `scheduleContactsResync(ctx)`.
- Imports add: `stateHolder`, `discoveredStore`, `emit`, `ADV_TYPE`, `hopsFromOutPathLen`, `advTypeToKind`, `contactKindToAdvType` (verify exact source paths), `type FeatureContext`.

### - [ ] Step 2: Update session
- Delete the five private methods (`ingestContact`, `upsertOnRadioContact`, `emitDiscovered`, `shouldAutoAdd`, `scheduleContactsResync`) and the iterator-state + `resyncTimer` fields from session (the iterator handlers still in `onPacket` now read/write the module state via the feature — but in Task 2 they still need the counters; see note).
- Repoint call sites: write methods (`addContactToRadio` ~671/683/684, `removeContactFromRadio` ~695, `setContactFavourite`, `setContactPath`) call the module functions (`upsertOnRadioContact(record)`, `emitDiscovered()`, `scheduleContactsResync(this.ctx)`).
- The still-in-session iterator handlers call `ingestContact(this.ctx, record, 'sync'|'advert')`.

> **Iterator-state note:** in Task 2 the START/CONTACT/END handlers still live in session and need `iterTotal`/`iterCount`/`syncSeen`. Simplest: leave those three counters in session for Task 2 and move them in Task 3 together with the handlers. Move ONLY `resyncTimer` + the 5 methods in Task 2. (So Task 2 = move stateless-ish ingest helpers; Task 3 = move the stateful iterator + handlers.)

### - [ ] Step 3: Full suite + biome + typecheck green. Commit (`refactor(protocol): move contact ingest logic into the contacts feature`).

---

## Task 3: contactsFeature + handlers + the `contactsSync` bus bridge (HIGH RISK — fully test-guarded)

Move the five handlers into `contactsFeature.handle`; register it; remove the five legacy `onPacket` branches; wire the `contactsSync` bridge.

**Files:** Modify `contacts.ts`, `session.ts`, `src/main/events/bus.ts`. Add `tests/integration/inbound/contacts-iterator.test.ts`. Keep the existing `tests/integration/inbound/contact-discovered.test.ts` / `contact-evicted.test.ts` GREEN (they are the regression guard).

### - [ ] Step 1: Add the bus signal (`src/main/events/bus.ts`)

```ts
// Contact-sync coordination signal emitted by the contacts feature; the
// ProtocolSession forwards it to the handshake's progress + waiters.
export type ContactsSyncSignal =
  | { phase: 'start'; total: number | null }
  | { phase: 'progress'; done: number; total: number }
  | { phase: 'done'; done: number };
```
Add to the `emit` object: `contactsSync: (s: ContactsSyncSignal) => bus.emit('contactsSync', s),` and to the bus event-map type: `contactsSync: (s: ContactsSyncSignal) => void;`.

### - [ ] Step 2: Move the iterator state + handlers into `contacts.ts`

Add `iterTotal`/`iterCount`/`syncSeen` module state (moved from session) and:
```ts
export const contactsFeature: Feature = {
  handles: [RESP.CONTACTS_START, RESP.CONTACT, RESP.END_OF_CONTACTS, PUSH.NEW_ADVERT, PUSH.CONTACT_DELETED],
  handle: (code, frame, ctx) => {
    if (code === RESP.CONTACTS_START) {
      const total = decodeContactsStart(frame);
      if (total !== null) { iterTotal = total; iterCount = 0; syncSeen = []; log.debug(...); }
      emit.contactsSync({ phase: 'start', total });
      return;
    }
    if (code === RESP.CONTACT) {
      const record = decodeContact(frame);
      if (record) {
        syncSeen.push(record.publicKeyHex);
        ingestContact(ctx, record, 'sync');
        iterCount += 1;
        if (iterCount > iterTotal) iterTotal = iterCount;
        emit.contactsSync({ phase: 'progress', done: iterCount, total: iterTotal });
      }
      return;
    }
    if (code === RESP.END_OF_CONTACTS) {
      const mostRecent = decodeEndOfContacts(frame);
      log.debug(...);
      const seen = syncSeen;
      discoveredStore.reconcileOnRadio(seen);
      const holder = stateHolder();
      const seenSet = new Set(seen.map((pk) => `c:${pk}`));
      for (const c of holder.getContacts()) {
        if (!seenSet.has(c.key) && c.publicKeyHex.length >= 64) holder.removeContact(c.key);
      }
      syncSeen = [];
      emit.contacts(holder.getContacts());
      emitDiscovered();
      const done = iterCount;
      iterTotal = 0; iterCount = 0;
      emit.contactsSync({ phase: 'done', done });
      return;
    }
    if (code === PUSH.NEW_ADVERT) {
      const record = decodeContact(frame);
      if (record) { ingestContact(ctx, record, 'advert'); log.debug(...); }
      return;
    }
    // PUSH.CONTACT_DELETED — verbatim body from session (decodeContactDeleted →
    // name resolve → discoveredStore.setOnRadio(false) → holder.removeContact →
    // emit.contacts → emitDiscovered() → emit.contactEvicted → log).
  },
};
export function resetContactsIter(): void { iterTotal = 0; iterCount = 0; syncSeen = []; }
```
> The `END_OF_CONTACTS` progress-snap (`done:count,total:count`) is delivered by `onContactsSync('done')` → `updateSyncProgress({contacts:{done,total:done}})` — see Step 3.

### - [ ] Step 3: Wire the session bridge + register the feature

In `session.ts`:
```ts
private onContactsSync = (s: ContactsSyncSignal): void => {
  if (s.phase === 'start') {
    if (s.total !== null) this.updateSyncProgress({ contacts: { done: 0, total: s.total } });
    this.resolveWaiter('contactsStartWaiter');
  } else if (s.phase === 'progress') {
    this.updateSyncProgress({ contacts: { done: s.done, total: s.total } });
  } else {
    this.updateSyncProgress({ contacts: { done: s.done, total: s.done } });
    this.resolveWaiter('contactsDoneWaiter');
  }
};
```
- In `start()`: `bus.on('contactsSync', this.onContactsSync);` (alongside the existing `bus.on('packet', ...)`).
- In `stop()`/disconnect: `bus.off('contactsSync', this.onContactsSync);` and call `resetContactsIter()` (parity with the old per-START reset; prevents stale counters across reconnects).
- Add `contactsFeature` to the `FeatureRegistry([...])`.
- **Delete** the five legacy `if (code === RESP.CONTACTS_START / RESP.CONTACT / RESP.END_OF_CONTACTS / PUSH.NEW_ADVERT / PUSH.CONTACT_DELETED)` branches from `onPacket`.
- Keep `armWaiter`, `resolveWaiter`, `updateSyncProgress`, the waiter fields, and the handshake UNCHANGED.

### - [ ] Step 4: Dedupe `advTypeToKind`

`contacts.ts` and `discoveredContacts.ts` both need `advTypeToKind`; session.ts:2173 has a third copy. Export the canonical one from a shared spot (e.g. keep `discoveredContacts.ts`'s and export it, or move to `src/shared/contacts/`), import it in `contacts.ts`, and delete the session copy IF it has no other users (grep first; it's used by the moved handlers/ingest, so after the move session's copy is likely dead → remove). Do NOT change its logic.

### - [ ] Step 5: Integration tests
- New `tests/integration/inbound/contacts-iterator.test.ts`: drive `CONTACTS_START`(total=2) → `CONTACT`×2 → `END_OF_CONTACTS` through the registry; assert `emit.syncProgress` contact done/total transitions (0/2 → 1/2 → 2/2 → 2/2 done), `emit.contacts` fired, and stale-contact reconciliation.
- Confirm the existing `contact-discovered.test.ts` (NEW_ADVERT) and `contact-evicted.test.ts` (CONTACT_DELETED) pass unchanged — they are the regression guard for the push handlers.

### - [ ] Step 6: Full suite + biome + typecheck green; verify legacy `onPacket` branch count dropped by 5. Commit (`refactor(protocol): migrate contacts iterator + push handlers to a feature module`).

---

## RESP_CONTACT correlation hazard (document, don't fix here)
`GET_CONTACT_BY_KEY` (Phase 3 group B, not in 2d) will share `RESP_CONTACT` (0x03) with this iterator. In 2d the iterator stays **code-dispatched** via the registry (NOT via `request()`/`pendingTyped`). So the FIFO-by-code typed-reply hazard does not bite in 2d. CONSTRAINT for Phase 3: `getContactByKey` must NOT use the `pendingTyped` path for `RESP_CONTACT` — it must correlate by the requested pubkey (e.g. a dedicated one-shot keyed by pubkey, or an `expect`-with-predicate). Record this in the spec's Open Questions.

## Self-Review
- **Coverage:** all 5 inbound contact codes + 4 encoders + 4 decoders + ingest logic assigned to tasks. ✅
- **Risk isolation:** Task 1 (wire) and Task 2 (ingest helpers) are behavior-neutral relocations; Task 3 carries the dispatch + bridge change, guarded by new + existing integration tests. ✅
- **Sync-coordination fidelity:** handshake waiters + `updateSyncProgress` unchanged; synchronous `emit.contactsSync` preserves call timing; START null-total and END progress-snap edge cases preserved in `onContactsSync`. ✅
- **Hazard:** documented, not triggered (iterator stays code-dispatched). ✅
