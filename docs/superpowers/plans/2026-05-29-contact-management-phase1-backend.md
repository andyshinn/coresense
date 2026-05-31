# Contact Management — Phase 1 (Backend Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Verification model (project reality):** `main` has **no test runner** (vitest is being added on a separate branch). Per the user's decision, every task is verified with **`pnpm typecheck` && `pnpm lint`** and committed; real-device manual verification happens at the phase boundary (end of this plan). Do **not** add a test runner or write `*.test.ts` files in this branch. Use **pnpm only** (never npm/yarn).

**Goal:** Add the backend foundation for Contact Management: an app-side SQLite "discovered contacts" pool (every heard advert, with app-tracked first-heard), reconciled against the radio's on-radio store, plus protocol + IPC for add/remove-from-radio, favourite (device flag bit 0), capacity, and eviction-push handling.

**Architecture:** Today every `PUSH_NEW_ADVERT` is upserted into the in-memory `stateHolder()` contact list, which drives the sidebar. We split that: `stateHolder().getContacts()` becomes the **on-radio set** (authoritative from `GET_CONTACTS` sync), so the existing `contacts` WS feed and sidebar become on-radio-only with no UI change. A new SQLite `discovered_contacts` store holds the **full pool**; a new `discovered` WS feed broadcasts it to the (Phase 2) Manager. New session methods issue `ADD_UPDATE_CONTACT` (9) / `REMOVE_CONTACT` (15) and reconcile via debounced re-sync.

**Tech Stack:** Electron main (Node), `node:sqlite` (`DatabaseSync`), Hono HTTP API + WebSocket broadcast over a Node `EventEmitter` bus, React + Zustand renderer. TypeScript throughout. Firmware truth: `/Users/andy/GitHub/meshcore-dev/MeshCore/examples/companion_radio`.

**Key firmware facts baked into this plan:**
- `PUSH_CODE_NEW_ADVERT` (0x8a) carries the full contact record for *every* heard advert, even nodes the radio did not store. Opcode alone can't tell us if it was stored → reconcile against `GET_CONTACTS`.
- `CMD_REMOVE_CONTACT` = dec 15 = **0x0f**, payload `[0x0f][32B pubkey]`, replies RESP_OK.
- `CMD_ADD_UPDATE_CONTACT` = 0x09 inserts new or updates; favourite = contact **flags bit 0** (protects from overwrite-oldest eviction).
- Firmware-initiated eviction pushes `PUSH_CODE_CONTACT_DELETED` (**0x8f**, `[0x8f][32B pubkey]`); store-full pushes `PUSH_CODE_CONTACTS_FULL` (**0x90**).
- Capacity = `DEVICE_INFO` byte 2 × 2 (already decoded as `maxContacts` in `parseDeviceInfo`). No first-heard on device → track app-side.
- Auto-add config (`GET/SET_AUTOADD_CONFIG`) is **already fully wired** (encode/decode/holder/route) — Phase 1 only *reads* it for reconciliation.

---

## File Structure

**Create:**
- `src/main/storage/discoveredContacts.ts` — SQLite store for the discovered pool (Row + mapper + `discoveredStore` object).
- `src/shared/contacts/discovered.ts` — `DiscoveredContact` wire type + `contactMatchesAnyBlockRule` helper (shared main/renderer).

**Modify:**
- `src/main/protocol/codes.ts` — add `CMD.REMOVE_CONTACT = 0x0f`, `PUSH.CONTACTS_FULL = 0x90`.
- `src/main/protocol/encode.ts` — add `buildRemoveContact`.
- `src/main/protocol/decode.ts` — add `parseContactDeleted`.
- `src/shared/types.ts` — `Contact.favourite?`, `WsMessage` `discovered` arm, `StateSnapshot.discoveredContacts`.
- `src/main/storage/db.ts` — add `discovered_contacts` table DDL.
- `src/main/events/bus.ts` — add `emit.discovered` + `BusEvents.discovered`.
- `src/main/server.ts` — forward `discovered` bus event to WS clients + seed on connect.
- `src/main/protocol/session.ts` — split ingest into on-radio vs discovered, sync reconciliation, new ops (`addContactToRadio`/`removeContactFromRadio`/`setContactFavourite`), handle 0x8f/0x90, debounced re-sync.
- `src/main/api/routes.ts` — discovered list + add/remove/favourite/clear endpoints + snapshot field.
- `src/renderer/lib/api.ts` — `addToRadio`/`removeFromRadio`/`setFavourite`/`clearDiscovered`/`fetchDiscovered`.
- `src/renderer/lib/store.ts` — `discovered` state + `applyDiscovered`.
- `src/renderer/app/wsHandlers.ts` — `discovered` case.

---

## Shared shapes (referenced across tasks — names are normative)

`DiscoveredContact` (wire shape, `src/shared/contacts/discovered.ts`):
```ts
export interface DiscoveredContact {
  key: string;            // `c:${publicKeyHex}`
  publicKeyHex: string;
  name: string;
  kind: ContactKind;      // 'chat' | 'repeater' | 'room' | 'sensor'
  hops?: number;
  outPathHex?: string;
  outPathHashSize?: PathHashSize;
  gpsLat?: number;
  gpsLon?: number;
  lastAdvertMs?: number;
  firstHeardMs: number;
  onRadio: boolean;
  favourite: boolean;
  blocked: boolean;
}
```

SQLite row (`discovered_contacts` table) — snake_case columns:
`pubkey TEXT PRIMARY KEY, name TEXT, type INTEGER, flags INTEGER, out_path_len INTEGER, out_path_hex TEXT, last_advert_unix INTEGER, gps_lat REAL, gps_lon REAL, lastmod INTEGER, first_heard_ms INTEGER, on_radio INTEGER, favourite INTEGER`.

---

## Task 1: Protocol codes for remove + contacts-full

**Files:**
- Modify: `src/main/protocol/codes.ts` (CMD object near line 28; PUSH object near line 172)

- [ ] **Step 1: Add the `REMOVE_CONTACT` command code**

In `src/main/protocol/codes.ts`, inside the `CMD` object, add after `RESET_PATH: 0x0d,` (line 28):

```ts
  // CMD_REMOVE_CONTACT: [0x0f][32B pubkey]. Deletes the contact from the
  //   radio's on-device store (firmware companion_radio CMD_REMOVE_CONTACT=15).
  //   Replies RESP_OK, or RESP_ERR (ERR_CODE_NOT_FOUND) if absent.
  REMOVE_CONTACT: 0x0f,
```

- [ ] **Step 2: Add the `CONTACTS_FULL` push code**

In the same file, inside the `PUSH` object, add after `CONTACT_DELETED: 0x8f,` (line 172):

```ts
  // PUSH_CODE_CONTACTS_FULL: emitted when the contact store is full and a new
  //   advert could not be auto-added (overwrite-oldest off / all favourites).
  CONTACTS_FULL: 0x90,
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass (no output errors; biome "No fixes applied").

```bash
git add src/main/protocol/codes.ts
git commit -m "feat(protocol): add REMOVE_CONTACT cmd + CONTACTS_FULL push codes"
```

---

## Task 2: Encoder for REMOVE_CONTACT

**Files:**
- Modify: `src/main/protocol/encode.ts` (add after `buildResetPath`, ~line 287)

- [ ] **Step 1: Add `buildRemoveContact`**

Mirror `buildResetPath` exactly (same 1+32 layout). Add after `buildResetPath`:

```ts
// CMD_REMOVE_CONTACT: [0x0f][32B pubkey]. Deletes the contact from the radio's
// on-device store. Replies RESP_OK / RESP_ERR.
export function buildRemoveContact(destPublicKeyHex: string): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`remove contact needs full 32B public key, got ${pubkey.length}`);
  }
  const out = Buffer.alloc(1 + 32);
  out[0] = CMD.REMOVE_CONTACT;
  pubkey.copy(out, 1, 0, 32);
  return out;
}
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/main/protocol/encode.ts
git commit -m "feat(protocol): add buildRemoveContact encoder"
```

---

## Task 3: Decoder for PUSH_CONTACT_DELETED

**Files:**
- Modify: `src/main/protocol/decode.ts` (add near the other small parsers, after `parseEndOfContacts`, ~line 343)

- [ ] **Step 1: Add `parseContactDeleted`**

```ts
// PUSH_CODE_CONTACT_DELETED [0x8f][32B pubkey] — firmware evicted a contact
// (overwrite-oldest). Returns the lowercase hex public key, or null if short.
export function parseContactDeleted(frame: Buffer): string | null {
  if (frame.length < 1 + 32) return null;
  return frame.subarray(1, 33).toString('hex');
}
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/main/protocol/decode.ts
git commit -m "feat(protocol): add parseContactDeleted for 0x8f push"
```

---

## Task 4: Shared types — favourite, DiscoveredContact wire type, WsMessage, snapshot

**Files:**
- Create: `src/shared/contacts/discovered.ts`
- Modify: `src/shared/types.ts` (Contact interface ~lines 86-119; `WsMessage` union ~line 920; `StateSnapshot` definition)

- [ ] **Step 1: Add `favourite` to the `Contact` interface**

In `src/shared/types.ts`, in the `Contact` interface, add after `pinned?: boolean;`:

```ts
  /** Radio-level favourite — maps to the firmware contact flag bit 0, which
   *  protects the contact from overwrite-oldest eviction. Distinct from
   *  `pinned` (app-only pin-to-top in the nav). */
  favourite?: boolean;
```

- [ ] **Step 2: Create the `DiscoveredContact` wire type + block-match helper**

Create `src/shared/contacts/discovered.ts`:

```ts
import type { BlockRule, ContactKind, PathHashSize } from '../types';

/** A node we've heard an advert from. Superset of the on-radio contact list:
 *  `onRadio` marks whether it is currently committed to the radio's store. */
export interface DiscoveredContact {
  key: string; // `c:${publicKeyHex}`
  publicKeyHex: string;
  name: string;
  kind: ContactKind;
  hops?: number;
  outPathHex?: string;
  outPathHashSize?: PathHashSize;
  gpsLat?: number;
  gpsLon?: number;
  /** Last advert time (their clock), ms. */
  lastAdvertMs?: number;
  /** First time WE heard this pubkey (our clock), ms. Tracked app-side. */
  firstHeardMs: number;
  onRadio: boolean;
  favourite: boolean;
  blocked: boolean;
}

/** Evaluate a contact's pubkey/name against the enabled block rules. Mirrors
 *  the message matcher's rule semantics (see shared/blocking/match.ts) but for
 *  a contact identity rather than a message. */
export function contactMatchesAnyBlockRule(
  publicKeyHex: string,
  name: string,
  rules: BlockRule[],
): boolean {
  const pk = publicKeyHex.toLowerCase();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    switch (rule.type) {
      case 'pubkey':
        if (pk === rule.pattern.toLowerCase()) return true;
        break;
      case 'pubkeyPrefix':
        if (pk.startsWith(rule.pattern.toLowerCase())) return true;
        break;
      case 'name':
        if (name === rule.pattern) return true;
        break;
      case 'nameRegex':
        try {
          if (new RegExp(rule.pattern, 'i').test(name)) return true;
        } catch {
          // invalid regex → treat as non-matching (mirrors matcher behavior)
        }
        break;
    }
  }
  return false;
}
```

- [ ] **Step 3: Add the `discovered` WsMessage arm**

In `src/shared/types.ts`, add an import-free reference (the type is defined in the new module). Add to the `WsMessage` union after the `contacts` arm (~line 920):

```ts
  | { type: 'discovered'; payload: DiscoveredContact[] }
```

Add the import at the top of `src/shared/types.ts` (with the other type imports, or inline). Because `types.ts` is the base module, import from the new file at the top:

```ts
import type { DiscoveredContact } from './contacts/discovered';
```

(If `types.ts` has no existing imports, add this as the first line. `discovered.ts` imports *type-only* from `types.ts`, so the cycle is erased at compile time and is safe.)

- [ ] **Step 4: Add `discoveredContacts` to `StateSnapshot`**

Find the `StateSnapshot` interface in `src/shared/types.ts` (it has `contacts: Contact[]` and `blockRules: BlockRule[]`). Add:

```ts
  discoveredContacts: DiscoveredContact[];
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass. (Typecheck will fail in `routes.ts` later when `StateSnapshot` is constructed without the new field — that's wired in Task 11. If typecheck flags the snapshot construction now, leave it; it is fixed in Task 11. To keep this task green, also do Step 6.)

- [ ] **Step 6: Satisfy the snapshot field at its single construction site now**

In `src/main/api/routes.ts`, find the `GET /api/state/snapshot` handler (~line 82-104) where the snapshot object is built with `contacts: holder.getContacts(),`. Add immediately after it:

```ts
      discoveredContacts: discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()),
```

Add the import at the top of `routes.ts` (with the other main imports):

```ts
import { discoveredStore } from '../storage/discoveredContacts';
```

(This references Task 6's module; if implementing strictly in order, this step's typecheck will fail until Task 6 lands. Acceptable: complete Task 6 before re-running verification, or implement Tasks 4 and 6 together. The subagent executing Task 4 should implement Task 6's module too if needed to keep the tree green — see Task 6.)

Run: `pnpm typecheck && pnpm lint`
Expected: both pass once Task 6 module exists.

```bash
git add src/shared/types.ts src/shared/contacts/discovered.ts src/main/api/routes.ts
git commit -m "feat(types): add favourite, DiscoveredContact wire type, discovered WsMessage + snapshot field"
```

> **Note to executor:** Tasks 4 and 6 are mutually dependent for a green typecheck (the snapshot construction references `discoveredStore`). Implement Task 6's `discoveredContacts.ts` module in the same working session as Task 4 Step 6, then verify both together. The commits can still be separate.

---

## Task 5: SQLite table for the discovered pool

**Files:**
- Modify: `src/main/storage/db.ts` (inside the `db.exec(\`...\`)` DDL block in `openDb()`)

- [ ] **Step 1: Add the `discovered_contacts` DDL**

In `src/main/storage/db.ts`, inside the existing `db.exec(\`...\`)` template in `openDb()`, append before the closing backtick (after the `conversations_fts` block):

```sql
    -- Discovered-contacts pool: every node we've heard an advert from, whether
    -- or not it is committed to the radio's on-device store. `on_radio` mirrors
    -- membership in the radio's GET_CONTACTS result; `first_heard_ms` is our
    -- clock (the firmware tracks no first-heard). Keyed by full hex pubkey.
    CREATE TABLE IF NOT EXISTS discovered_contacts (
      pubkey          TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      type            INTEGER NOT NULL,     -- ADV_TYPE (1 chat,2 repeater,3 room,4 sensor)
      flags           INTEGER NOT NULL,     -- raw contact flags (bit 0 = favourite)
      out_path_len    INTEGER NOT NULL,
      out_path_hex    TEXT NOT NULL,
      last_advert_unix INTEGER NOT NULL,
      gps_lat         REAL NOT NULL,
      gps_lon         REAL NOT NULL,
      lastmod         INTEGER NOT NULL,
      first_heard_ms  INTEGER NOT NULL,
      on_radio        INTEGER NOT NULL DEFAULT 0,
      favourite       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS discovered_by_last_advert ON discovered_contacts (last_advert_unix DESC);
    CREATE INDEX IF NOT EXISTS discovered_by_on_radio    ON discovered_contacts (on_radio);
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/main/storage/db.ts
git commit -m "feat(storage): add discovered_contacts table"
```

---

## Task 6: discoveredStore module

**Files:**
- Create: `src/main/storage/discoveredContacts.ts`

- [ ] **Step 1: Write the store module**

Create `src/main/storage/discoveredContacts.ts`. It mirrors the `messagesStore` template (private `Row` + `rowTo*` mapper + exported plain object; `openDb()` per call; upsert via `ON CONFLICT`). It maps to `DiscoveredContact` using the radio's `pathHashMode` (for `hops`) and the block rules (for `blocked`).

```ts
import type { BlockRule, ContactKind, PathHashSize } from '../../shared/types';
import { contactMatchesAnyBlockRule, type DiscoveredContact } from '../../shared/contacts/discovered';
import type { ContactRecord } from '../protocol/decode';
import { openDb } from './db';

interface Row {
  pubkey: string;
  name: string;
  type: number;
  flags: number;
  out_path_len: number;
  out_path_hex: string;
  last_advert_unix: number;
  gps_lat: number;
  gps_lon: number;
  lastmod: number;
  first_heard_ms: number;
  on_radio: number;
  favourite: number;
}

function advTypeToKind(type: number): ContactKind {
  switch (type) {
    case 2:
      return 'repeater';
    case 3:
      return 'room';
    case 4:
      return 'sensor';
    default:
      return 'chat';
  }
}

function rowToDiscovered(
  row: Row,
  hashSize: PathHashSize,
  blockRules: BlockRule[],
): DiscoveredContact {
  const hasFix = row.gps_lat !== 0 || row.gps_lon !== 0;
  const hasPath = row.out_path_len !== 0xff && row.out_path_len > 0;
  return {
    key: `c:${row.pubkey}`,
    publicKeyHex: row.pubkey,
    name: row.name || row.pubkey.slice(0, 12),
    kind: advTypeToKind(row.type),
    hops: row.out_path_len === 0xff ? undefined : Math.floor(row.out_path_len / hashSize),
    outPathHex: hasPath ? row.out_path_hex : undefined,
    outPathHashSize: hasPath ? hashSize : undefined,
    gpsLat: hasFix ? row.gps_lat : undefined,
    gpsLon: hasFix ? row.gps_lon : undefined,
    lastAdvertMs: row.last_advert_unix > 0 ? row.last_advert_unix * 1000 : undefined,
    firstHeardMs: row.first_heard_ms,
    onRadio: row.on_radio !== 0,
    favourite: row.favourite !== 0,
    blocked: contactMatchesAnyBlockRule(row.pubkey, row.name, blockRules),
  };
}

export const discoveredStore = {
  /** Upsert from a decoded advert/contact frame. Stamps first_heard_ms on the
   *  first sighting of a pubkey; preserves it (and the existing favourite flag)
   *  on later adverts. `onRadio` is set by the caller per context. */
  upsert(record: ContactRecord, opts: { onRadio: boolean; nowMs: number }): void {
    const db = openDb();
    db.prepare(
      `INSERT INTO discovered_contacts
         (pubkey, name, type, flags, out_path_len, out_path_hex, last_advert_unix,
          gps_lat, gps_lon, lastmod, first_heard_ms, on_radio, favourite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pubkey) DO UPDATE SET
         name=excluded.name, type=excluded.type, flags=excluded.flags,
         out_path_len=excluded.out_path_len, out_path_hex=excluded.out_path_hex,
         last_advert_unix=excluded.last_advert_unix, gps_lat=excluded.gps_lat,
         gps_lon=excluded.gps_lon, lastmod=excluded.lastmod,
         on_radio=excluded.on_radio`,
    ).run(
      record.publicKeyHex,
      record.name,
      record.type,
      record.flags,
      record.outPathLen,
      record.outPathHex,
      record.lastAdvertUnix,
      record.gpsLat,
      record.gpsLon,
      record.lastmod,
      opts.nowMs,
      opts.onRadio ? 1 : 0,
      record.flags & 0x01 ? 1 : 0,
    );
  },

  list(hashSize: PathHashSize, blockRules: BlockRule[]): DiscoveredContact[] {
    const db = openDb();
    const rows = db
      .prepare(`SELECT * FROM discovered_contacts ORDER BY last_advert_unix DESC`)
      .all() as unknown as Row[];
    return rows.map((r) => rowToDiscovered(r, hashSize, blockRules));
  },

  get(pubkey: string): Row | null {
    const db = openDb();
    const row = db
      .prepare(`SELECT * FROM discovered_contacts WHERE pubkey = ?`)
      .get(pubkey) as Row | undefined;
    return row ?? null;
  },

  setOnRadio(pubkey: string, onRadio: boolean): void {
    const db = openDb();
    db.prepare(`UPDATE discovered_contacts SET on_radio = ? WHERE pubkey = ?`).run(
      onRadio ? 1 : 0,
      pubkey,
    );
  },

  /** Mark on_radio for exactly the given set (used after a full GET_CONTACTS
   *  sync): rows in the set → 1, everything else → 0. */
  reconcileOnRadio(onRadioPubkeys: string[]): void {
    const db = openDb();
    db.exec('UPDATE discovered_contacts SET on_radio = 0');
    const stmt = db.prepare('UPDATE discovered_contacts SET on_radio = 1 WHERE pubkey = ?');
    for (const pk of onRadioPubkeys) stmt.run(pk);
  },

  setFavourite(pubkey: string, favourite: boolean): void {
    const db = openDb();
    db.prepare(
      `UPDATE discovered_contacts
         SET favourite = ?, flags = (flags & ~1) | ? WHERE pubkey = ?`,
    ).run(favourite ? 1 : 0, favourite ? 1 : 0, pubkey);
  },

  remove(pubkey: string): void {
    const db = openDb();
    db.prepare(`DELETE FROM discovered_contacts WHERE pubkey = ?`).run(pubkey);
  },

  /** Drop discovered-only rows, keeping anything currently on the radio. */
  clearDiscoveredOnly(): void {
    const db = openDb();
    db.exec(`DELETE FROM discovered_contacts WHERE on_radio = 0`);
  },
};
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass (with Task 4/5 in place).

```bash
git add src/main/storage/discoveredContacts.ts
git commit -m "feat(storage): add discoveredStore (pool CRUD + on-radio/favourite reconcile)"
```

---

## Task 7: Bus event + WS broadcast for the discovered feed

**Files:**
- Modify: `src/main/events/bus.ts` (`emit` object ~line 47; `BusEvents` type ~line 81)
- Modify: `src/main/server.ts` (the `onContacts`/`bus.on('contacts')`/`bus.off` trio ~lines 189/234/267; new-connection seed ~lines 146-171)

- [ ] **Step 1: Add the emit helper + bus event type**

In `src/main/events/bus.ts`, add to the `emit` object after the `contacts` helper (line 47):

```ts
  discovered: (rows: DiscoveredContact[]) => bus.emit('discovered', rows),
```

Add to the `BusEvents` type after the `contacts` entry (line 81):

```ts
  discovered: (rows: DiscoveredContact[]) => void;
```

Add the import at the top of `bus.ts`:

```ts
import type { DiscoveredContact } from '../../shared/contacts/discovered';
```

- [ ] **Step 2: Forward the bus event to WS clients**

In `src/main/server.ts`, next to `const onContacts = ...` (line 189), add:

```ts
  const onDiscovered = (rows: DiscoveredContact[]) => broadcast({ type: 'discovered', payload: rows });
```

Next to `bus.on('contacts', onContacts);` (line 234) add:

```ts
  bus.on('discovered', onDiscovered);
```

Next to `bus.off('contacts', onContacts);` (line 267) add:

```ts
  bus.off('discovered', onDiscovered);
```

Add the import at the top of `server.ts`:

```ts
import type { DiscoveredContact } from '../shared/contacts/discovered';
import { discoveredStore } from './storage/discoveredContacts';
import { stateHolder } from './state/holder';
```

(If `stateHolder` is already imported, don't duplicate.)

- [ ] **Step 3: Seed the discovered feed on new WS connection**

In `src/main/server.ts`, in the new-connection seed block (~lines 146-171, where `transportState`/`bridgeStatus`/`log:snapshot` are sent), add a seed send for discovered:

```ts
    const holder = stateHolder();
    c.send(
      JSON.stringify({
        type: 'discovered',
        payload: discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()),
      }),
    );
```

(Match the exact `c.send(JSON.stringify({ type, payload }))` shape already used for the other seeded messages in that block. `c` is the per-connection `WebSocket`; use whatever local name the surrounding seed code uses.)

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/main/events/bus.ts src/main/server.ts
git commit -m "feat(server): broadcast + seed the discovered-contacts feed"
```

---

## Task 8: Session — split ingest into on-radio vs discovered + emit discovered

**Files:**
- Modify: `src/main/protocol/session.ts` (`ingestContact` ~lines 1606-1664; dispatch `RESP.CONTACT`/`PUSH.NEW_ADVERT`/`END_OF_CONTACTS` ~lines 1330-1370; add a sync-seen field near line 195)

**Context:** `ingestContact(record)` currently upserts into `holder` and emits `emit.contacts`. We keep that for **on-radio** contacts but additionally write to `discoveredStore`, and we change `PUSH.NEW_ADVERT` so a not-yet-on-radio advert does NOT enter `holder.getContacts()` (so the sidebar stays on-radio-only).

- [ ] **Step 1: Add a helper to emit the discovered feed**

In `session.ts`, add a private method to the session class (near `ingestContact`):

```ts
  /** Push the full discovered pool to the renderer. */
  private emitDiscovered(): void {
    const holder = stateHolder();
    emit.discovered(
      discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()),
    );
  }
```

Add imports at the top of `session.ts`:

```ts
import { discoveredStore } from '../storage/discoveredContacts';
import { parseContactDeleted } from './decode';
import { buildRemoveContact } from './encode';
```

(Merge `parseContactDeleted` into the existing `./decode` import group and `buildRemoveContact` into the existing `./encode` import group rather than adding duplicate import lines.)

- [ ] **Step 2: Refactor `ingestContact` to also write the discovered store**

Change the signature and body of `ingestContact` so it records the discovered row and only mutates `holder` contacts when the contact is on-radio. Replace the existing `ingestContact` method with:

```ts
  /** Upsert a contact heard from RESP_CONTACT (sync, on-radio) or
   *  PUSH_NEW_ADVERT (live advert — on-radio only if already in the store).
   *  Always records into the discovered pool with an app-tracked first-heard. */
  private ingestContact(record: ContactRecord, source: 'sync' | 'advert'): void {
    const holder = stateHolder();
    const fullKey = `c:${record.publicKeyHex}`;
    const alreadyOnRadio = holder.getContacts().some((c) => c.key === fullKey);
    // sync frames are authoritative on-radio; adverts are on-radio only if we
    // already track this contact in the radio set.
    const onRadio = source === 'sync' ? true : alreadyOnRadio;

    discoveredStore.upsert(record, { onRadio, nowMs: Date.now() });

    if (onRadio) {
      this.upsertOnRadioContact(record);
    }
    this.emitDiscovered();

    // Live advert for a not-on-radio node whose kind the firmware auto-adds:
    // the radio may have just stored it. Pull a fresh contact list to find out.
    if (source === 'advert' && !onRadio && this.shouldAutoAdd(record.type)) {
      this.scheduleContactsResync();
    }
  }
```

- [ ] **Step 3: Extract the existing holder-upsert logic into `upsertOnRadioContact`**

Move the body that builds the `Contact` and calls `holder.upsertContact` + placeholder reconcile + `emit.contacts` (the current tail of `ingestContact`) into a new method, preserving every field exactly as today, but also setting `favourite` from the device flag:

```ts
  private upsertOnRadioContact(record: ContactRecord): void {
    const holder = stateHolder();
    const fullKey = `c:${record.publicKeyHex}`;
    const prefix6 = record.publicKeyHex.slice(0, 12);
    const existing = holder.getContacts().find((c) => c.key === fullKey);
    const hashSize = holder.getRadioSettings().pathHashMode;
    const advertOutPathHex = record.outPathLen === 0xff ? '' : record.outPathHex;
    const newOutPathHex =
      advertOutPathHex.length === 0 && existing?.pathManual === true
        ? (existing.outPathHex ?? '')
        : advertOutPathHex;
    const pathChanged = (existing?.outPathHex ?? '') !== newOutPathHex;

    const contact: Contact = {
      key: fullKey,
      publicKeyHex: record.publicKeyHex,
      name: record.name || record.publicKeyHex.slice(0, 12),
      kind: advTypeToKind(record.type),
      lastSeenMs: record.lastAdvertUnix > 0 ? record.lastAdvertUnix * 1000 : existing?.lastSeenMs,
      hops: record.outPathLen === 0xff ? undefined : Math.floor(record.outPathLen / hashSize),
      pinned: existing?.pinned,
      muted: existing?.muted,
      favourite: (record.flags & 0x01) !== 0,
      outPathHex: newOutPathHex || undefined,
      outPathHashSize: newOutPathHex ? hashSize : existing?.outPathHashSize,
      preferDirect: existing?.preferDirect,
      pathManual: pathChanged ? false : existing?.pathManual,
      pathLearnedAt: pathChanged && newOutPathHex ? Date.now() : existing?.pathLearnedAt,
      gpsLat: record.gpsLat !== 0 || record.gpsLon !== 0 ? record.gpsLat : existing?.gpsLat,
      gpsLon: record.gpsLat !== 0 || record.gpsLon !== 0 ? record.gpsLon : existing?.gpsLon,
    };
    holder.upsertContact(contact);

    const placeholderKey = `c:${prefix6}`;
    if (placeholderKey !== fullKey && holder.getContacts().some((c) => c.key === placeholderKey)) {
      holder.removeContact(placeholderKey);
      log.debug(`reconciled placeholder ${placeholderKey} → ${fullKey}`);
    }

    emit.contacts(holder.getContacts());
  }
```

- [ ] **Step 4: Add `shouldAutoAdd` + sync-seen accumulation**

Add a class field near the other contacts-sync fields (~line 195):

```ts
  /** Pubkeys seen during the in-flight GET_CONTACTS iteration. Reset on
   *  CONTACTS_START; consumed in END_OF_CONTACTS to reconcile on-radio flags. */
  private contactsSyncSeen: string[] = [];
```

Add the auto-add check method (reads the already-wired auto-add config from the holder):

```ts
  /** Whether the firmware would auto-store an advert of this ADV_TYPE, given
   *  the current auto-add config. Used to decide whether to re-sync after a
   *  not-on-radio advert. */
  private shouldAutoAdd(advType: number): boolean {
    const cfg = stateHolder().getAutoAddConfig();
    if (cfg.mode === 'all') return true;
    switch (advType) {
      case ADV_TYPE.REPEATER:
        return cfg.repeater;
      case ADV_TYPE.ROOM:
        return cfg.room;
      case ADV_TYPE.SENSOR:
        return cfg.sensor;
      default:
        return cfg.chat;
    }
  }
```

> Confirm the `AutoAddConfig` field names (`mode`, `chat`, `repeater`, `room`, `sensor`) against `src/shared/types.ts` lines 555-580 and `stateHolder().getAutoAddConfig()` (holder ~line 173). Adjust the property reads to the actual shape if they differ.

- [ ] **Step 5: Wire the dispatch sites to the new signature + sync reconciliation**

In the `onPacket` dispatch chain:

- `RESP.CONTACTS_START` branch — reset the seen list. Add inside that branch (where `contactsIterTotal`/`contactsIterCount` are reset):

```ts
        this.contactsSyncSeen = [];
```

- `RESP.CONTACT` branch — change `this.ingestContact(record);` to:

```ts
        this.contactsSyncSeen.push(record.publicKeyHex);
        this.ingestContact(record, 'sync');
```

- `RESP.END_OF_CONTACTS` branch — reconcile on-radio membership and drop holder contacts that left the radio. Add before the counters are cleared:

```ts
      const seen = this.contactsSyncSeen;
      discoveredStore.reconcileOnRadio(seen);
      const holder = stateHolder();
      const seenSet = new Set(seen.map((pk) => `c:${pk}`));
      for (const c of holder.getContacts()) {
        // Drop on-radio contacts the sync didn't return, except synthetic DM
        // placeholders (`c:<12-hex>`), which are reconciled separately.
        if (!seenSet.has(c.key) && c.publicKeyHex.length >= 64) {
          holder.removeContact(c.key);
        }
      }
      this.contactsSyncSeen = [];
      emit.contacts(holder.getContacts());
      this.emitDiscovered();
```

- `PUSH.NEW_ADVERT` branch — change `this.ingestContact(record);` to:

```ts
        this.ingestContact(record, 'advert');
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass. (`scheduleContactsResync` is added in Task 9; to keep this task green, add the stub from Task 9 Step 1 now, then flesh it out in Task 9. The executor should implement Task 9 Step 1's method in the same session.)

```bash
git add src/main/protocol/session.ts
git commit -m "feat(session): split ingest into on-radio vs discovered pool"
```

---

## Task 9: Session — debounced re-sync + eviction/full push handling

**Files:**
- Modify: `src/main/protocol/session.ts`

- [ ] **Step 1: Add a debounced contacts re-sync**

Add a class field and method:

```ts
  private resyncTimer: NodeJS.Timeout | null = null;

  /** Debounced full GET_CONTACTS re-sync. Coalesces bursts of adverts into one
   *  refresh so we pick up firmware auto-adds without hammering the link. */
  private scheduleContactsResync(): void {
    if (this.resyncTimer) return;
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      void this.writeFrame(buildGetContacts()).catch((err) => {
        log.warn(`contacts re-sync failed: ${(err as Error).message}`);
      });
    }, 1500);
  }
```

(`buildGetContacts` is already imported in `session.ts`.)

- [ ] **Step 2: Handle `PUSH.CONTACT_DELETED` (firmware eviction)**

In the `onPacket` dispatch chain, add a branch (after the `PUSH.NEW_ADVERT` branch):

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

- [ ] **Step 3: Handle `PUSH.CONTACTS_FULL`**

Add a branch:

```ts
    if (code === PUSH.CONTACTS_FULL) {
      log.warn('radio contact store is full');
      emit.error('Radio contact store is full — remove or favourite contacts to make room.');
      return;
    }
```

> Confirm `emit.error` exists and takes a `string` (see `bus.ts`). If its signature differs (e.g. `{ message }`), match it. If there is no suitable channel, fall back to `log.warn` only and drop the `emit.error` line.

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/main/protocol/session.ts
git commit -m "feat(session): debounced re-sync + 0x8f/0x90 push handling"
```

---

## Task 10: Session — add/remove-from-radio + favourite operations

**Files:**
- Modify: `src/main/protocol/session.ts`

- [ ] **Step 1: Add `addContactToRadio`**

```ts
  /** Commit a discovered contact to the radio's store (CMD_ADD_UPDATE_CONTACT).
   *  Optimistically marks it on-radio and schedules a re-sync to confirm. */
  async addContactToRadio(publicKeyHex: string): Promise<void> {
    const row = discoveredStore.get(publicKeyHex);
    if (!row) throw new Error(`unknown discovered contact ${publicKeyHex}`);
    const hasFix = row.gps_lat !== 0 || row.gps_lon !== 0;
    const frame = buildAddUpdateContact({
      publicKeyHex,
      advType: row.type,
      flags: row.flags,
      outPathHex: row.out_path_len === 0xff ? '' : row.out_path_hex,
      name: row.name,
      // GPS + last-advert tail is all-or-nothing (firmware #427).
      ...(hasFix
        ? { gpsLat: row.gps_lat, gpsLon: row.gps_lon, lastAdvertUnix: row.last_advert_unix }
        : {}),
    });
    await this.writeFrame(frame);
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

(`buildAddUpdateContact` is already imported.)

- [ ] **Step 2: Add `removeContactFromRadio`**

```ts
  /** Delete a contact from the radio's store (CMD_REMOVE_CONTACT). Keeps it in
   *  the discovered pool, flagged off-radio. */
  async removeContactFromRadio(publicKeyHex: string): Promise<void> {
    await this.writeFrame(buildRemoveContact(publicKeyHex));
    discoveredStore.setOnRadio(publicKeyHex, false);
    const holder = stateHolder();
    holder.removeContact(`c:${publicKeyHex}`);
    emit.contacts(holder.getContacts());
    this.emitDiscovered();
  }
```

- [ ] **Step 3: Add `setContactFavourite`**

```ts
  /** Toggle the favourite flag (contact flags bit 0). For on-radio contacts,
   *  round-trips CMD_ADD_UPDATE_CONTACT so the firmware persists the flag
   *  (protects from overwrite-oldest). Discovered-only contacts update locally. */
  async setContactFavourite(publicKeyHex: string, favourite: boolean): Promise<void> {
    const row = discoveredStore.get(publicKeyHex);
    if (!row) throw new Error(`unknown discovered contact ${publicKeyHex}`);
    if (row.on_radio !== 0) {
      const flags = favourite ? row.flags | 0x01 : row.flags & ~0x01;
      const hasFix = row.gps_lat !== 0 || row.gps_lon !== 0;
      const frame = buildAddUpdateContact({
        publicKeyHex,
        advType: row.type,
        flags,
        outPathHex: row.out_path_len === 0xff ? '' : row.out_path_hex,
        name: row.name,
        ...(hasFix
          ? { gpsLat: row.gps_lat, gpsLon: row.gps_lon, lastAdvertUnix: row.last_advert_unix }
          : {}),
      });
      await this.writeFrame(frame);
    }
    discoveredStore.setFavourite(publicKeyHex, favourite);
    // Mirror onto the on-radio Contact record if present.
    const holder = stateHolder();
    const existing = holder.getContacts().find((c) => c.key === `c:${publicKeyHex}`);
    if (existing) {
      holder.upsertContact({ ...existing, favourite });
      emit.contacts(holder.getContacts());
    }
    this.emitDiscovered();
  }
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/main/protocol/session.ts
git commit -m "feat(session): add/remove-from-radio + favourite operations"
```

---

## Task 11: API routes for the discovered pool + operations

**Files:**
- Modify: `src/main/api/routes.ts` (after the existing contacts endpoints ~line 519)

- [ ] **Step 1: Add the discovered endpoints**

After the `DELETE /api/contacts/:key` handler (line 519), add:

```ts
  // ---- Discovered-contacts pool ---------------------------------------
  api.get('/api/discovered-contacts', (c) => {
    const holder = stateHolder();
    return c.json(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));
  });

  // Commit a discovered contact to the radio's store.
  api.post('/api/contacts/:key/add-to-radio', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const pubkey = key.startsWith('c:') ? key.slice(2) : key;
    try {
      await protocolSession().addContactToRadio(pubkey);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  // Delete a contact from the radio's store (stays in the discovered pool).
  api.post('/api/contacts/:key/remove-from-radio', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const pubkey = key.startsWith('c:') ? key.slice(2) : key;
    try {
      await protocolSession().removeContactFromRadio(pubkey);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  // Toggle the radio-level favourite flag.
  api.put('/api/contacts/:key/favourite', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const pubkey = key.startsWith('c:') ? key.slice(2) : key;
    const body = (await c.req.json().catch(() => null)) as { favourite?: boolean } | null;
    if (!body || typeof body.favourite !== 'boolean') {
      return c.json({ error: 'favourite (boolean) required' }, 400);
    }
    try {
      await protocolSession().setContactFavourite(pubkey, body.favourite);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  // Drop discovered-only rows (keeps on-radio contacts).
  api.post('/api/discovered-contacts/clear', (c) => {
    discoveredStore.clearDiscoveredOnly();
    const holder = stateHolder();
    emit.discovered(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));
    return c.json({ ok: true });
  });
```

(`discoveredStore` import was added in Task 4 Step 6; `protocolSession`, `stateHolder`, `emit` are already imported.)

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/main/api/routes.ts
git commit -m "feat(api): discovered-contacts list + add/remove/favourite/clear routes"
```

---

## Task 12: Renderer API client methods

**Files:**
- Modify: `src/renderer/lib/api.ts` (add to the `api` object after `resetContactPath` ~line 217)

- [ ] **Step 1: Add the new client calls**

```ts
  fetchDiscovered: (c: ApiClient) =>
    request<DiscoveredContact[]>(c, `/api/discovered-contacts`),
  addToRadio: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/contacts/${encodeURIComponent(key)}/add-to-radio`, {
      method: 'POST',
    }),
  removeFromRadio: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/contacts/${encodeURIComponent(key)}/remove-from-radio`, {
      method: 'POST',
    }),
  setFavourite: (c: ApiClient, key: string, favourite: boolean) =>
    request<{ ok: true }>(c, `/api/contacts/${encodeURIComponent(key)}/favourite`, {
      method: 'PUT',
      body: JSON.stringify({ favourite }),
    }),
  clearDiscovered: (c: ApiClient) =>
    request<{ ok: true }>(c, `/api/discovered-contacts/clear`, { method: 'POST' }),
```

Add the import at the top of `api.ts`:

```ts
import type { DiscoveredContact } from '../../shared/contacts/discovered';
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/renderer/lib/api.ts
git commit -m "feat(renderer): api client for discovered pool + add/remove/favourite"
```

---

## Task 13: Renderer store slice + WS handler for the discovered feed

**Files:**
- Modify: `src/renderer/lib/store.ts` (contacts slice — add `discovered` state + `applyDiscovered`)
- Modify: `src/renderer/app/wsHandlers.ts` (add `discovered` case ~line 60)

- [ ] **Step 1: Add `discovered` state + action to the store**

In `src/renderer/lib/store.ts`, in the state interface where `contacts: Contact[]` is declared, add:

```ts
  discovered: DiscoveredContact[];
```

In the store's initial state (where `contacts: []` is set), add:

```ts
  discovered: [],
```

Next to `applyContacts`, add the action:

```ts
  applyDiscovered: (rows: DiscoveredContact[]) => set({ discovered: rows }),
```

(Match the exact `set(...)` style used by `applyContacts` — e.g. `set({ contacts })`. Add `applyDiscovered: (rows: DiscoveredContact[]) => void;` to the actions type declaration alongside `applyContacts`.)

Add the import at the top of `store.ts`:

```ts
import type { DiscoveredContact } from '../../shared/contacts/discovered';
```

- [ ] **Step 2: Route the WS message**

In `src/renderer/app/wsHandlers.ts`, add a case after the `contacts` case (line 60):

```ts
      case 'discovered':
        s.applyDiscovered(msg.payload);
        break;
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass.

```bash
git add src/renderer/lib/store.ts src/renderer/app/wsHandlers.ts
git commit -m "feat(renderer): discovered store slice + WS routing"
```

---

## Phase 1 manual verification (real device — user-driven)

After all tasks land, verify against a real radio (`pnpm start`):

- [ ] On connect, the sidebar shows only contacts that are on the radio (the same set the official app shows under added contacts). No regression vs. before.
- [ ] In DevTools, the renderer store has a populated `discovered` array (`useStore.getState().discovered`) that is a superset of `contacts`, each row carrying `onRadio`, `favourite`, `firstHeardMs`.
- [ ] `POST /api/contacts/<c:pk>/add-to-radio` for a discovered-only node → it appears in the sidebar within ~2s (after the debounced re-sync) and `onRadio` flips true.
- [ ] `POST /api/contacts/<c:pk>/remove-from-radio` → it leaves the sidebar, stays in `discovered` with `onRadio:false`.
- [ ] `PUT /api/contacts/<c:pk>/favourite {favourite:true}` → `favourite` flips true; re-syncing contacts shows the flag persisted (device flag bit 0).
- [ ] Trigger an advert from a new node with auto-add off for its kind → it appears in `discovered` (`onRadio:false`) but NOT in the sidebar.
- [ ] `POST /api/discovered-contacts/clear` → discovered-only rows drop; on-radio rows remain.

---

## Self-review notes (author)

- **Spec coverage:** discovered SQLite store (T5/6), first-heard app-side (T6 upsert `first_heard_ms`), on-radio reconciliation (T8 sync-seen + `reconcileOnRadio`), `0x8a` split (T8), `0x8f`/`0x90` (T9), add/remove/favourite (T10), capacity already decoded (`maxContacts`, no new task — surfaced in Phase 2), auto-add config already wired (read in T8 `shouldAutoAdd`), block-rule reuse (T4 helper), sidebar on-radio-only (falls out of T8 — no UI change), feeds (T7/13). Export/Import explicitly deferred per spec ("lowest priority"). Distance/Heard-Via/Manager UI are Phase 2-3.
- **No placeholders:** every code step has complete code. The two cross-task dependencies (T4↔T6 snapshot; T8↔T9 `scheduleContactsResync`) are called out with explicit "implement together" notes.
- **Type consistency:** `DiscoveredContact` shape and the SQLite `Row` are fixed in the Shared shapes section and reused verbatim. `ingestContact(record, source)` and `upsertOnRadioContact(record)` signatures are consistent across T8/T10. `discoveredStore` method names (`upsert/list/get/setOnRadio/reconcileOnRadio/setFavourite/remove/clearDiscoveredOnly`) are used consistently in T6/T8/T9/T10/T11.
- **Assumptions to confirm during execution (flagged inline):** `AutoAddConfig` field names; `emit.error` signature; exact WS new-connection seed local variable name; `StateSnapshot` construction site. These are confirm-and-adjust, not redesign.
