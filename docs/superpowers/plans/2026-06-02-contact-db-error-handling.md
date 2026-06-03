# Contact Database Error Handling & Discovery Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check the CMD_ADD_UPDATE_CONTACT reply (surface `ERR_CODE_TABLE_FULL` as "database full"), toast on contact eviction, and add an opt-out "Discovered contact" native notification.

**Architecture:** The protocol session ([`src/main/protocol/session.ts`](../../../src/main/protocol/session.ts)) is the single companion-frame reader. We (1) generalize its ack mechanism to carry the firmware error-code byte so `addContactToRadio` can detect a full store, (2) add a main→WebSocket→renderer toast for the already-handled `PUSH_CONTACT_DELETED`, and (3) fire a native OS notification from the main-process notification router when a contact is heard for the first time, gated by a new settings toggle. The discovery notification is entirely main-process (no renderer plumbing); only the eviction toast crosses to the renderer.

**Tech Stack:** TypeScript, Electron (main process), React (renderer), Hono (local API), `sonner` (toasts), Vitest (unit + integration), Biome (lint/format).

**Spec:** [`docs/superpowers/specs/2026-06-02-contact-db-error-handling-design.md`](../specs/2026-06-02-contact-db-error-handling-design.md)

---

## File Map

| File | Change |
|------|--------|
| `src/main/protocol/codes.ts` | Add `ERR_CODE = { TABLE_FULL: 0x03 }` |
| `src/main/protocol/session.ts` | `AckResult` type; ack plumbing; `addContactToRadio` awaits reply; `0x8F` handler emits `contactEvicted` + `log.info`; `ingestContact` emits `contactDiscovered` on first sighting |
| `src/main/protocol/errors.ts` | Add `ContactTableFullError` |
| `src/main/api/routes.ts` | Map `ContactTableFullError` → HTTP 409 |
| `src/renderer/lib/api.ts` | `parseServerError` + surface server `error` field in `request()` |
| `src/main/events/bus.ts` | `contactEvicted` (→ws) and `contactDiscovered` (main-internal) bus events |
| `src/main/server.ts` | Forward `contactEvicted` to WebSocket |
| `src/shared/types.ts` | `WsMessage` `contactEvicted` variant; `notifications.discoveredContact` field + default |
| `src/renderer/app/wsHandlers.ts` | `contactEvicted` → `notify.info` toast |
| `src/shared/notifications/discovered.ts` | **New.** Pure `shouldFireDiscovered` predicate |
| `src/main/notifications.ts` | Fire native notification on `contactDiscovered` |
| `src/renderer/panels/settings/app/Notifications.tsx` | "Discovered contacts" toggle + `eqNotifications` |

**New test files:** `tests/integration/outbound/add-contact.test.ts`, `tests/integration/inbound/contact-evicted.test.ts`, `tests/integration/inbound/contact-discovered.test.ts`, `tests/unit/renderer/lib/api.test.ts`, `tests/unit/shared/notifications/discovered.test.ts`.

---

## Task 1: Generalize the ack to carry the firmware error code

**Files:**
- Modify: `src/main/protocol/codes.ts`
- Modify: `src/main/protocol/session.ts`

This is a structural refactor with no behavior change for existing callers. It is verified by the existing suite staying green and typecheck passing; Task 2 adds the first behavioral test that exercises the new error-code path.

- [ ] **Step 1: Add the `ERR_CODE` constant**

In `src/main/protocol/codes.ts`, immediately after the `RESP` block (after the line `} as const;` that closes `export const RESP = {`), add:

```ts
// Firmware error codes carried in a RESP_ERR frame as the byte after the code:
//   [RESP_ERR=0x01][err_code]. Only TABLE_FULL is acted on today — the radio
//   rejects CMD_ADD_UPDATE_CONTACT with 0x03 when its on-device contact store
//   is full (overwrite-oldest off, or every slot is a favourite).
export const ERR_CODE = {
  TABLE_FULL: 0x03,
} as const;
```

- [ ] **Step 2: Introduce `AckResult` and retype `PendingAck`**

In `src/main/protocol/session.ts`, replace the `PendingAck` interface (currently around line 153):

```ts
interface PendingAck {
  resolve: (ok: boolean) => void;
  timer: NodeJS.Timeout;
}
```

with:

```ts
export interface AckResult {
  ok: boolean;
  /** Firmware error code byte from a RESP_ERR reply (frame[1]); undefined on
   *  RESP_OK or on timeout. */
  errorCode?: number;
}

interface PendingAck {
  resolve: (result: AckResult) => void;
  timer: NodeJS.Timeout;
}
```

- [ ] **Step 3: Update `awaitAck` and `resolveNextAck`**

Replace the `awaitAck` method body (around line 1272) so the timeout resolves with an `AckResult`:

```ts
  private awaitAck(): { promise: Promise<AckResult>; entry: PendingAck } {
    let entry!: PendingAck;
    const promise = new Promise<AckResult>((resolve) => {
      const timer = setTimeout(() => {
        const i = this.pendingAcks.indexOf(entry);
        if (i !== -1) this.pendingAcks.splice(i, 1);
        resolve({ ok: false });
      }, SET_CHANNEL_TIMEOUT_MS);
      entry = { resolve, timer };
      this.pendingAcks.push(entry);
    });
    return { promise, entry };
  }
```

Replace `resolveNextAck` (around line 1286):

```ts
  private resolveNextAck(ok: boolean, errorCode?: number): boolean {
    const entry = this.pendingAcks.shift();
    if (!entry) return false;
    clearTimeout(entry.timer);
    entry.resolve({ ok, errorCode });
    return true;
  }
```

- [ ] **Step 4: Read the error-code byte in the RESP_OK/ERR handler**

Replace the OK/ERR block in `handleFrame` (around line 1675):

```ts
    if (code === RESP.OK || code === RESP.ERR) {
      // SET_CHANNEL awaiters get first crack at any OK/ERR. If none are
      // queued and we have a DM in flight, a bare RESP_ERR means the radio
      // rejected the send (e.g. unknown recipient prefix) — fail the DM.
      if (this.resolveNextAck(code === RESP.OK)) return;
      if (code === RESP.ERR) this.failOldestDmSend('radio rejected send');
      return;
    }
```

with:

```ts
    if (code === RESP.OK || code === RESP.ERR) {
      // Device-write awaiters get first crack at any OK/ERR. A RESP_ERR carries
      // an error-code byte (frame[1]) — thread it through so callers like
      // addContactToRadio can detect ERR_CODE_TABLE_FULL. If no awaiter is
      // queued and a DM is in flight, a bare RESP_ERR means the radio rejected
      // the send (e.g. unknown recipient prefix) — fail the DM.
      const errorCode = code === RESP.ERR ? frame[1] : undefined;
      if (this.resolveNextAck(code === RESP.OK, errorCode)) return;
      if (code === RESP.ERR) this.failOldestDmSend('radio rejected send');
      return;
    }
```

- [ ] **Step 5: Update the existing boolean ack callers**

The ack now resolves `AckResult`, not `boolean`. Update the 9 call sites:

1. Replace **all 4** identical occurrences of:
   ```ts
   const ok = await ack.promise;
   ```
   with:
   ```ts
   const ok = (await ack.promise).ok;
   ```
   (in `setAdvertName`, `setAdvertLatLon`, `setOtherParams`, `setAutoAddConfig` — around lines 773, 798, 830, 852).

2. `const ok1 = await paramsAck.promise;` → `const ok1 = (await paramsAck.promise).ok;` (around line 734).

3. `const ok2 = await powerAck.promise;` → `const ok2 = (await powerAck.promise).ok;` (around line 745).

4. `if (!(await ack1.promise)) return false;` → `if (!(await ack1.promise).ok) return false;` (around line 881).

5. `if (!(await ack2.promise)) return false;` → `if (!(await ack2.promise).ok) return false;` (around line 891).

6. In `setChannel` (around line 1231), `return ack.promise;` → 
   ```ts
   return (await ack.promise).ok;
   ```

- [ ] **Step 6: Import `ERR_CODE` (used in Task 2)**

In `src/main/protocol/session.ts`, find the import from `'./codes'` (currently `import { ADV_TYPE, PUSH, REQ_TYPE, RESP, STATS_TYPE, TXT_TYPE } from './codes';`) and add `ERR_CODE` to the named imports.

- [ ] **Step 7: Verify typecheck and the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. No behavior changed; all existing tests green.

- [ ] **Step 8: Commit**

```bash
git add src/main/protocol/codes.ts src/main/protocol/session.ts
git commit -m "refactor(protocol): thread firmware error code through device-write acks"
```

---

## Task 2: Check the ADD_UPDATE_CONTACT reply (TABLE_FULL)

**Files:**
- Modify: `src/main/protocol/errors.ts`
- Modify: `src/main/protocol/session.ts:599` (`addContactToRadio`)
- Modify: `src/main/api/routes.ts:536`
- Test: `tests/integration/outbound/add-contact.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/outbound/add-contact.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { ContactTableFullError } from '../../../src/main/protocol/errors';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { transportManager } from '../../../src/main/transport/manager';
import { FakeTransport, companionPacket } from '../../support/fake-transport';

const PUBKEY = 'aa'.repeat(32);

function seedDiscovered(): void {
  discoveredStore.upsert(
    {
      publicKeyHex: PUBKEY,
      type: 1,
      flags: 0,
      outPathLen: 0xff,
      outPathHex: '',
      name: 'Alice',
      lastAdvertUnix: 0,
      gpsLat: 0,
      gpsLon: 0,
      lastmod: 0,
    },
    { onRadio: false, nowMs: 1_700_000_000_000, heardLive: true },
  );
}

describe('addContactToRadio reply handling', () => {
  afterEach(() => protocolSession().stop());

  it('commits the contact on RESP_OK', async () => {
    const session = protocolSession();
    session.start();
    transportManager.setTransport(new FakeTransport());
    seedDiscovered();

    const p = session.addContactToRadio(PUBKEY);
    await Promise.resolve(); // let the synchronous write flush before we reply
    emit.packet(companionPacket(Buffer.from([0x00]))); // RESP_OK
    await p;

    expect(discoveredStore.get(PUBKEY)?.on_radio).toBe(1);
  });

  it('rejects with ContactTableFullError on RESP_ERR[0x03], leaving on_radio unset', async () => {
    const session = protocolSession();
    session.start();
    transportManager.setTransport(new FakeTransport());
    seedDiscovered();

    const p = session.addContactToRadio(PUBKEY);
    await Promise.resolve();
    emit.packet(companionPacket(Buffer.from([0x01, 0x03]))); // RESP_ERR + ERR_CODE_TABLE_FULL
    await expect(p).rejects.toBeInstanceOf(ContactTableFullError);

    expect(discoveredStore.get(PUBKEY)?.on_radio).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- add-contact`
Expected: FAIL — `ContactTableFullError` is not exported yet, and `addContactToRadio` resolves without awaiting a reply (the `rejects` assertion fails / `on_radio` is already 1).

- [ ] **Step 3: Add `ContactTableFullError`**

In `src/main/protocol/errors.ts`, append:

```ts
/** Thrown when CMD_ADD_UPDATE_CONTACT is rejected with ERR_CODE_TABLE_FULL —
 *  the radio's on-device contact store is full (overwrite-oldest off, or every
 *  slot is a favourite). Maps to HTTP 409. The message is user-facing. */
export class ContactTableFullError extends Error {
  constructor() {
    super('Contact list full — remove a contact or enable overwrite-oldest.');
    this.name = 'ContactTableFullError';
  }
}
```

- [ ] **Step 4: Await the reply in `addContactToRadio`**

In `src/main/protocol/session.ts`, add `ContactTableFullError` to the existing import from `'./errors'` (alongside `UnknownContactError`). Then replace the `addContactToRadio` method body (around line 599):

```ts
  async addContactToRadio(publicKeyHex: string): Promise<void> {
    const row = discoveredStore.get(publicKeyHex);
    if (!row) {
      log.warn(`unknown discovered contact ${publicKeyHex.slice(0, 12)}`);
      throw new UnknownContactError(publicKeyHex);
    }
    const hasFix = row.gps_lat !== 0 || row.gps_lon !== 0;
    const frame = buildAddUpdateContact({
      publicKeyHex,
      advType: row.type,
      flags: row.flags,
      outPathHex: row.out_path_len === 0xff ? '' : row.out_path_hex,
      name: row.name,
      ...(hasFix
        ? { gpsLat: row.gps_lat, gpsLon: row.gps_lon, lastAdvertUnix: row.last_advert_unix }
        : {}),
    });
    // Await the radio's reply before claiming the contact is on-radio. RESP_ERR
    // with ERR_CODE_TABLE_FULL means the store is full — surface it and leave
    // on_radio untouched rather than lying to the UI.
    const ack = this.awaitAck();
    try {
      await this.writeFrame(frame);
    } catch (err) {
      this.popPendingAck(ack.entry);
      throw err;
    }
    const result = await ack.promise;
    if (!result.ok) {
      if (result.errorCode === ERR_CODE.TABLE_FULL) {
        log.warn(`add contact rejected: contact table full ${publicKeyHex.slice(0, 12)}`);
        throw new ContactTableFullError();
      }
      throw new Error('radio did not confirm add-contact');
    }
    discoveredStore.setOnRadio(publicKeyHex, true);
    this.upsertOnRadioContact({
      publicKeyHex,
      type: row.type,
      flags: row.flags,
      outPathLen: row.out_path_len,
      outPathHex: row.out_path_hex,
      name: row.name,
      lastAdvertUnix: row.last_advert_unix,
      gpsLat: row.gps_lat,
      gpsLon: row.gps_lon,
      lastmod: row.lastmod,
    });
    this.emitDiscovered();
    this.scheduleContactsResync();
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:integration -- add-contact`
Expected: PASS (both cases).

- [ ] **Step 6: Map the error in the route**

In `src/main/api/routes.ts`, add `ContactTableFullError` to the existing import from the protocol errors module (next to `UnknownContactError`). Then update the add-to-radio handler (around line 536):

```ts
  api.post('/api/contacts/:key/add-to-radio', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const pubkey = key.startsWith('c:') ? key.slice(2) : key;
    try {
      await protocolSession().addContactToRadio(pubkey);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof UnknownContactError) return c.json({ error: err.message }, 422);
      if (err instanceof ContactTableFullError) {
        return c.json({ error: err.message, code: 'CONTACT_TABLE_FULL' }, 409);
      }
      return c.json({ error: (err as Error).message }, 503);
    }
  });
```

- [ ] **Step 7: Verify typecheck + suite, then commit**

Run: `pnpm typecheck && pnpm test:integration -- add-contact`
Expected: PASS

```bash
git add src/main/protocol/errors.ts src/main/protocol/session.ts src/main/api/routes.ts tests/integration/outbound/add-contact.test.ts
git commit -m "fix(contacts): surface ERR_CODE_TABLE_FULL when adding to a full radio store"
```

---

## Task 3: Surface the server error field cleanly in the renderer

**Files:**
- Modify: `src/renderer/lib/api.ts:33` (`request`)
- Test: `tests/unit/renderer/lib/api.test.ts`

So the existing `catch → notify.error` at the add call sites shows "Contact list full — …" instead of `503 {"error":"…"}`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseServerError } from '@/lib/api';

describe('parseServerError', () => {
  it('extracts the error field from a JSON body', () => {
    expect(parseServerError('{"error":"Contact list full"}')).toBe('Contact list full');
  });

  it('returns null for a non-JSON body', () => {
    expect(parseServerError('Internal Server Error')).toBeNull();
  });

  it('returns null when error is absent or not a string', () => {
    expect(parseServerError('{"ok":true}')).toBeNull();
    expect(parseServerError('{"error":123}')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- renderer/lib/api`
Expected: FAIL — `parseServerError` is not exported.

- [ ] **Step 3: Implement `parseServerError` and use it in `request`**

In `src/renderer/lib/api.ts`, add this exported helper just above `request`:

```ts
/** Pull a `{ "error": "…" }` message out of a JSON error body, or null if the
 *  body isn't JSON / has no string error. Lets callers show the server's
 *  friendly message instead of the raw status + payload. */
export function parseServerError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed?.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}
```

Then replace the error branch inside `request` (currently):

```ts
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${message}`);
  }
```

with:

```ts
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(parseServerError(body) ?? `${res.status} ${body || res.statusText}`);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- renderer/lib/api`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/api.ts tests/unit/renderer/lib/api.test.ts
git commit -m "feat(api): surface server error field in request() failures"
```

---

## Task 4: Toast on firmware eviction (PUSH_CONTACT_DELETED)

**Files:**
- Modify: `src/shared/types.ts` (`WsMessage` union)
- Modify: `src/main/events/bus.ts`
- Modify: `src/main/server.ts`
- Modify: `src/renderer/app/wsHandlers.ts`
- Modify: `src/main/protocol/session.ts:1476` (`0x8F` handler)
- Test: `tests/integration/inbound/contact-evicted.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/inbound/contact-evicted.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { companionPacket } from '../../support/fake-transport';

const PUBKEY = 'bb'.repeat(32);

function contactDeletedFrame(pubkeyHex: string): Buffer {
  const frame = Buffer.alloc(1 + 32);
  frame[0] = 0x8f; // PUSH_CODE_CONTACT_DELETED
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  return frame;
}

describe('inbound PUSH_CONTACT_DELETED', () => {
  afterEach(() => protocolSession().stop());

  it('removes the contact and emits contactEvicted with its name', () => {
    const session = protocolSession();
    session.start();
    discoveredStore.upsert(
      {
        publicKeyHex: PUBKEY,
        type: 1,
        flags: 0,
        outPathLen: 0xff,
        outPathHex: '',
        name: 'Bob',
        lastAdvertUnix: 0,
        gpsLat: 0,
        gpsLon: 0,
        lastmod: 0,
      },
      { onRadio: true, nowMs: 1_700_000_000_000, heardLive: false },
    );

    const evicted: string[] = [];
    bus.on('contactEvicted', (name: string) => evicted.push(name));

    emit.packet(companionPacket(contactDeletedFrame(PUBKEY)));

    expect(evicted).toEqual(['Bob']);
    expect(discoveredStore.get(PUBKEY)?.on_radio).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- contact-evicted`
Expected: FAIL — `contactEvicted` is never emitted.

- [ ] **Step 3: Add the `contactEvicted` bus event**

In `src/main/events/bus.ts`, add to the `emit` object (e.g. after the `discovered:` line):

```ts
  contactEvicted: (name: string) => bus.emit('contactEvicted', name),
```

and to the `BusEvents` type (after the `discovered:` line):

```ts
  contactEvicted: (name: string) => void;
```

- [ ] **Step 4: Add the `WsMessage` variant**

In `src/shared/types.ts`, add to the `WsMessage` union (e.g. after the `discovered` variant):

```ts
  | { type: 'contactEvicted'; payload: { name: string } }
```

- [ ] **Step 5: Forward the event to the WebSocket**

In `src/main/server.ts`, add a broadcaster next to `onDiscovered` (around line 203):

```ts
  const onContactEvicted = (name: string) =>
    broadcast({ type: 'contactEvicted', payload: { name } });
```

Register it next to `bus.on('discovered', onDiscovered)`:

```ts
  bus.on('contactEvicted', onContactEvicted);
```

And add the matching cleanup next to `bus.off('discovered', onDiscovered)`:

```ts
    bus.off('contactEvicted', onContactEvicted);
```

- [ ] **Step 6: Handle the toast in the renderer**

In `src/renderer/app/wsHandlers.ts`, add a case to the switch (e.g. after `case 'discovered':`):

```ts
      case 'contactEvicted':
        notify.info(`Contact removed by radio: ${msg.payload.name}`);
        break;
```

(`notify` is already imported in this file.)

- [ ] **Step 7: Emit from the 0x8F handler + upgrade the log**

In `src/main/protocol/session.ts`, replace the `PUSH.CONTACT_DELETED` block (around line 1476):

```ts
    if (code === PUSH.CONTACT_DELETED) {
      const pubkey = parseContactDeleted(frame);
      if (pubkey) {
        discoveredStore.setOnRadio(pubkey, false);
        const holder = stateHolder();
        holder.removeContact(`c:${pubkey}`);
        emit.contacts(holder.getContacts());
        this.emitDiscovered();
        log.debug(`contact evicted by firmware: ${pubkey.slice(0, 12)}`);
      }
      return;
    }
```

with:

```ts
    if (code === PUSH.CONTACT_DELETED) {
      const pubkey = parseContactDeleted(frame);
      if (pubkey) {
        const holder = stateHolder();
        // Resolve a display name before dropping the contact, for the toast.
        const name =
          holder.getContacts().find((c) => c.key === `c:${pubkey}`)?.name ??
          discoveredStore.get(pubkey)?.name ??
          pubkey.slice(0, 12);
        discoveredStore.setOnRadio(pubkey, false);
        holder.removeContact(`c:${pubkey}`);
        emit.contacts(holder.getContacts());
        this.emitDiscovered();
        emit.contactEvicted(name);
        log.info(`contact evicted by radio: ${name} ${pubkey.slice(0, 12)}`);
      }
      return;
    }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test:integration -- contact-evicted`
Expected: PASS

- [ ] **Step 9: Verify typecheck, then commit**

Run: `pnpm typecheck`
Expected: PASS

```bash
git add src/shared/types.ts src/main/events/bus.ts src/main/server.ts src/renderer/app/wsHandlers.ts src/main/protocol/session.ts tests/integration/inbound/contact-evicted.test.ts
git commit -m "feat(contacts): toast + log when the radio evicts a contact"
```

---

## Task 5: "Discovered contact" native notification + setting

**Files:**
- Create: `src/shared/notifications/discovered.ts`
- Modify: `src/shared/types.ts` (`notifications.discoveredContact` + default)
- Modify: `src/main/events/bus.ts` (main-internal `contactDiscovered`)
- Modify: `src/main/protocol/session.ts:1769` (`ingestContact`)
- Modify: `src/main/notifications.ts`
- Modify: `src/renderer/panels/settings/app/Notifications.tsx`
- Test: `tests/unit/shared/notifications/discovered.test.ts`, `tests/integration/inbound/contact-discovered.test.ts`

The notification fires entirely in the main process — `notifications.ts` subscribes to the bus event. No WebSocket/renderer plumbing (unlike the eviction toast).

- [ ] **Step 1: Write the failing unit test for the pure predicate**

Create `tests/unit/shared/notifications/discovered.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldFireDiscovered } from '../../../../src/shared/notifications/discovered';
import { DEFAULT_APP_SETTINGS } from '../../../../src/shared/types';

const base = DEFAULT_APP_SETTINGS.notifications;

describe('DEFAULT_APP_SETTINGS', () => {
  it('enables discovered-contact notifications by default', () => {
    expect(DEFAULT_APP_SETTINGS.notifications.discoveredContact).toBe(true);
  });
});

describe('shouldFireDiscovered', () => {
  it('fires when enabled and the window is not focused', () => {
    expect(shouldFireDiscovered({ ...base, discoveredContact: true }, false)).toBe(true);
  });

  it('does not fire when the toggle is off', () => {
    expect(shouldFireDiscovered({ ...base, discoveredContact: false }, false)).toBe(false);
  });

  it('suppresses while focused when suppressWhenFocused is on', () => {
    expect(
      shouldFireDiscovered(
        { ...base, discoveredContact: true, suppressWhenFocused: true },
        true,
      ),
    ).toBe(false);
  });

  it('fires while focused when suppressWhenFocused is off', () => {
    expect(
      shouldFireDiscovered(
        { ...base, discoveredContact: true, suppressWhenFocused: false },
        true,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- shared/notifications/discovered`
Expected: FAIL — `shouldFireDiscovered` and `discoveredContact` don't exist yet.

- [ ] **Step 3: Add the `discoveredContact` setting field + default**

In `src/shared/types.ts`, add to the `notifications` object inside the `AppSettings` interface (after `sensorAlert: boolean;`, around line 328):

```ts
    /** Fire a native notification the first time a contact is heard. */
    discoveredContact: boolean;
```

and to `DEFAULT_APP_SETTINGS.notifications` (after `sensorAlert: false,`, around line 409):

```ts
    discoveredContact: true,
```

- [ ] **Step 4: Create the pure predicate**

Create `src/shared/notifications/discovered.ts`:

```ts
import type { AppSettings } from '../types';

/** Whether a "discovered contact" native notification should fire, given the
 *  notification policy and whether the main window is currently focused.
 *  Honors the per-kind toggle and the shared "suppress while focused" rule. */
export function shouldFireDiscovered(
  policy: AppSettings['notifications'],
  windowFocused: boolean,
): boolean {
  if (!policy.discoveredContact) return false;
  if (policy.suppressWhenFocused && windowFocused) return false;
  return true;
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `pnpm test:unit -- shared/notifications/discovered`
Expected: PASS

- [ ] **Step 6: Write the failing integration test for the emit**

Create `tests/integration/inbound/contact-discovered.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { transportManager } from '../../../src/main/transport/manager';
import { FakeTransport, companionPacket } from '../../support/fake-transport';

// PUSH_NEW_ADVERT (0x8a) carries a full 148-byte contact record — same layout
// as RESP_CONTACT, only the code byte differs.
function advertFrame(pubkeyHex: string, name: string): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = 0x8a;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = 1; // type = chat
  frame[35] = 0xff; // out_path_len = direct
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

const PUBKEY = 'cc'.repeat(32);

describe('inbound PUSH_NEW_ADVERT discovery', () => {
  afterEach(() => protocolSession().stop());

  it('emits contactDiscovered the first time a pubkey is heard', () => {
    const session = protocolSession();
    session.start();
    transportManager.setTransport(new FakeTransport());

    const discovered: Array<{ key: string; name: string; kind: string }> = [];
    bus.on('contactDiscovered', (c: { key: string; name: string; kind: string }) =>
      discovered.push(c),
    );

    emit.packet(companionPacket(advertFrame(PUBKEY, 'Carol')));

    expect(discovered).toEqual([{ key: `c:${PUBKEY}`, name: 'Carol', kind: 'chat' }]);
  });

  it('does not emit on a re-advert of a known pubkey', () => {
    const session = protocolSession();
    session.start();
    transportManager.setTransport(new FakeTransport());

    const discovered: unknown[] = [];
    bus.on('contactDiscovered', (c) => discovered.push(c));

    emit.packet(companionPacket(advertFrame(PUBKEY, 'Carol'))); // first → emits
    emit.packet(companionPacket(advertFrame(PUBKEY, 'Carol'))); // second → silent
    expect(discovered).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm test:integration -- contact-discovered`
Expected: FAIL — `contactDiscovered` is never emitted.

- [ ] **Step 8: Add the main-internal `contactDiscovered` bus event**

In `src/main/events/bus.ts`, add `ContactKind` to the type import from `'../../shared/types'`. Then add to the `emit` object (after the `contactEvicted:` line from Task 4):

```ts
  contactDiscovered: (c: { key: string; name: string; kind: ContactKind }) =>
    bus.emit('contactDiscovered', c),
```

and to `BusEvents`:

```ts
  contactDiscovered: (c: { key: string; name: string; kind: ContactKind }) => void;
```

(No `server.ts` / `WsMessage` change — this event is consumed only in the main process.)

- [ ] **Step 9: Detect first sighting in `ingestContact`**

In `src/main/protocol/session.ts`, replace the `ingestContact` method (around line 1769):

```ts
  private ingestContact(record: ContactRecord, source: 'sync' | 'advert'): void {
    const holder = stateHolder();
    const fullKey = `c:${record.publicKeyHex}`;
    const alreadyOnRadio = holder.getContacts().some((c) => c.key === fullKey);
    const onRadio = source === 'sync' ? true : alreadyOnRadio;

    discoveredStore.upsert(record, {
      onRadio,
      nowMs: Date.now(),
      heardLive: source === 'advert',
    });

    if (onRadio) {
      this.upsertOnRadioContact(record);
    }
    this.emitDiscovered();

    if (source === 'advert' && !onRadio && this.shouldAutoAdd(record.type)) {
      this.scheduleContactsResync();
    }
  }
```

with:

```ts
  private ingestContact(record: ContactRecord, source: 'sync' | 'advert'): void {
    const holder = stateHolder();
    const fullKey = `c:${record.publicKeyHex}`;
    const alreadyOnRadio = holder.getContacts().some((c) => c.key === fullKey);
    const onRadio = source === 'sync' ? true : alreadyOnRadio;

    // First-ever sighting: no row in the discovered pool yet (checked before
    // the upsert below). Only a live advert is a "discovery" — a GET_CONTACTS
    // sync is just the device listing what it already stores.
    const isNewDiscovery =
      source === 'advert' && discoveredStore.get(record.publicKeyHex) === null;

    discoveredStore.upsert(record, {
      onRadio,
      nowMs: Date.now(),
      heardLive: source === 'advert',
    });

    if (onRadio) {
      this.upsertOnRadioContact(record);
    }
    this.emitDiscovered();

    if (isNewDiscovery) {
      emit.contactDiscovered({
        key: fullKey,
        name: record.name || record.publicKeyHex.slice(0, 12),
        kind: advTypeToKind(record.type),
      });
    }

    if (source === 'advert' && !onRadio && this.shouldAutoAdd(record.type)) {
      this.scheduleContactsResync();
    }
  }
```

(`advTypeToKind` and `emit` are already imported/used in this file.)

- [ ] **Step 10: Run the integration test to verify it passes**

Run: `pnpm test:integration -- contact-discovered`
Expected: PASS (both cases).

- [ ] **Step 11: Fire the native notification**

In `src/main/notifications.ts`, add imports near the top:

```ts
import type { ContactKind } from '../shared/types';
import { shouldFireDiscovered } from '../shared/notifications/discovered';
```

(adjust the existing `'./shared/types'`-style import grouping as the file already imports `Message` from `'../shared/types'`).

In `startNotifications`, add a subscription next to the other `bus.on(...)` calls:

```ts
  bus.on('contactDiscovered', onContactDiscovered);
```

Then add the handler function (place it near `maybeNotify`):

```ts
function onContactDiscovered(c: { key: string; name: string; kind: ContactKind }): void {
  const holder = stateHolder();
  const policy = holder.getAppSettings().notifications;
  if (!shouldFireDiscovered(policy, isMainWindowFocused())) return;
  if (!Notification.isSupported()) {
    log.debug('native notifications unavailable; skipping discovered contact');
    return;
  }
  const n = new Notification({
    title: 'New contact discovered',
    body: c.name,
    silent: !policy.sound,
  });
  n.on('click', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    emit.menuAction({ kind: 'focusKey', key: c.key });
  });
  n.show();
  log.debug(`notified discovered contact ${c.key.slice(0, 14)}`);
}
```

(`stateHolder`, `isMainWindowFocused`, `getMainWindow`, `emit`, `Notification`, `log` are all already imported in this file.)

- [ ] **Step 12: Add the settings toggle**

In `src/renderer/panels/settings/app/Notifications.tsx`, extend `eqNotifications` — add this line inside the returned `&&` chain (after the `x.sensorAlert === y.sensorAlert &&` line):

```ts
    x.discoveredContact === y.discoveredContact &&
```

Then add a `Row` in the JSX, after the "Sensor alerts" `Row` and before "Play sound":

```tsx
      <Row
        label="Discovered contacts"
        description="When a never-before-seen node is first heard."
        changed={n.discoveredContact !== s0.discoveredContact}
        control={
          <Toggle
            checked={n.discoveredContact}
            onChange={(v) => setN({ discoveredContact: v })}
          />
        }
      />
```

- [ ] **Step 13: Verify typecheck + the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add src/shared/notifications/discovered.ts src/shared/types.ts src/main/events/bus.ts src/main/protocol/session.ts src/main/notifications.ts src/renderer/panels/settings/app/Notifications.tsx tests/unit/shared/notifications/discovered.test.ts tests/integration/inbound/contact-discovered.test.ts
git commit -m "feat(notifications): native alert + setting for newly discovered contacts"
```

---

## Task 6: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Lint, typecheck, and full test suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all PASS. If Biome reports formatting, run `pnpm format` and re-run; commit any formatting changes with `chore: biome format`.

- [ ] **Step 2: Manual smoke (renderer UI bits the tests don't cover)**

With a radio (or replay) connected:
1. Settings → Notifications shows a **"Discovered contacts"** toggle, default **on**; toggling and Save round-trips (no "unsaved" stuck state).
2. Hearing a brand-new node fires one native "New contact discovered" notification (unfocus the window first, since suppress-while-focused is on by default); clicking it focuses the contact.
3. Filling the radio store and adding another contact shows the **"Contact list full — remove a contact or enable overwrite-oldest."** toast, and the contact does **not** flip to on-radio.
4. A radio-side eviction (overwrite-oldest) shows a **"Contact removed by radio: <name>"** toast, and the contact leaves the on-radio list. The main-process log contains a `contact evicted by radio:` line.

- [ ] **Step 3: Final state check**

Run: `git status` and `git log --oneline -6`
Expected: clean tree; one commit per task.

---

## Self-Review Notes

- **Spec coverage:** Item 1 → Tasks 1–2 (+3 for clean surfacing); Item 2 → already wired, confirmed + `log.info` added in Task 4; Item 3 (toast) → Task 4; Item 4 (discovered notification + setting + default-on) → Task 5; tslog eviction logging → Task 4 Step 7. All covered.
- **Type consistency:** `AckResult` (Task 1) is consumed in Task 2; `contactEvicted(name: string)` / `WsMessage` payload `{ name }` match across bus/server/wsHandlers (Task 4); `contactDiscovered` payload `{ key, name, kind: ContactKind }` matches between `bus.ts`, `session.ts` emit, and the `notifications.ts` handler (Task 5); `discoveredContact` field name is identical in the type, default, predicate, and UI.
- **Refinement vs spec:** the discovery notification is main-process-only (no `WsMessage`/`server.ts` change) since native notifications fire in main — narrower than a literal reading of the spec, intentional and noted.
