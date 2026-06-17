# MeshCore-ts Full Session/Transport Swap Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace coresense's hand-rolled `ProtocolSession` + protocol modules with the linked `@andyshinn/meshcore-ts` `MeshCoreSession`, via a write-through adapter that keeps coresense's persistence (`StateHolder`, sqlite `messagesStore`/`discoveredStore`) and the existing main→renderer WebSocket contract.

**Architecture:** A new `SessionAdapter` constructs a `MeshCoreSession` over coresense's BLE transport (bridged through the lib's `createBleTransport`), subscribes to `session.events`, writes each event through to coresense's persistent stores, and re-emits the existing `emit.*` bus events so the renderer is unchanged. The adapter also exposes the ~25 command methods `api/routes.ts` calls, delegating to `session.*`. The old `src/main/protocol/*` implementation and its internal unit tests are deleted; integration/e2e flow tests are re-harnessed to inject frames through a `LoopbackTransport`. Single coordinated swap on `main`; intermediate commits may be red — the branch is verified green at the end by the kept flow tests + hardware.

**Tech Stack:** TypeScript, Electron (main), `@andyshinn/meshcore-ts` (linked), `@stoprocent/noble`, React/Zustand (renderer, unchanged), Vitest, Biome, pnpm.

**Prerequisites (already done):** Plan 1 merged (package linked, `decodeDeviceInfo` adopted, `DeviceInfo` extended). meshcore-ts `dist` includes `contactObserved(record, source)` and `messageUpserted(message)` events (verified in `node_modules/@andyshinn/meshcore-ts/dist/index.d.ts`). The renderer keeps `@michaelhart/meshcore-decoder` (out of scope; meshcore-ts is Node-only).

---

## Reference: what the lib provides vs. what coresense keeps

**Lib (`@andyshinn/meshcore-ts`) — the protocol engine, in-memory only:**
- `new MeshCoreSession({ transport, appName?, appVersion? })`; `start()` wires `transport.onData`/`onStateChange` and kicks the handshake on `'connected'`; `stop()`.
- `session.events` (a `MeshCoreEvents`): emits `transportState`, `owner`, `deviceInfo`, `deviceCapabilities`, `deviceIdentity`, `radioSettings`, `gpsConfig`, `telemetryPolicy`, `autoAddConfig`, `channels`, `channelPresence`, `contacts`, `discovered`, `contactDiscovered`, `contactEvicted`, `contactObserved` (new), `messages`, `messageUpserted` (new), `messageState`, `messagePathHeard`, `syncProgress`, `pathLearned`, `repeaterStatus`, `repeaterTelemetry`, `rawPacket`.
- Command methods (delegated to): `sendChannelText`, `sendDmTextWithRetry`, `sendStatusReq`, `sendTelemetryReq`, `addContactToRadio`, `removeContactFromRadio`, `setContactFavourite`, `setContactPath`, `resetContactPath`, `setContactPreferDirect`, `setPathHashMode`, `setRadioParams`, `setAdvertName`, `setAdvertLatLon`, `setOtherParams`, `setGpsConfig`, `setAutoAddConfig`, `requestAutoAddConfig`, `requestDeviceInfo`, `requestBattAndStorage`, `requestCustomVars`, `reboot`, `sendSelfAdvert`, `setChannel`, `markChannelPresent`, `markChannelAbsent`, `pickFreeSlot`, `deriveSecret`, `getDevicePresence`, `getSyncProgress`, `repeaterLogin`, `repeaterLogout`, `repeaterRequestAcl`, `repeaterRequestNeighbours`, `repeaterRequestOwnerInfo`, `repeaterSendCli`, `repeaterTracePath`, `repeaterGetLocalStats`.
- Types: `ContactRecord`, `ContactSource`, `Contact`, `Message`, `MessagePath`, `Owner`, `RadioSettings`, `DeviceInfo`, `DeviceIdentity`, `GpsConfig`, `AclEntry`, `LoginSuccess`, `OwnerInfo`, `NeighboursPage`, `TraceData`, `LocalStats`, `Transport`, `LoopbackTransport`, `TransportState`.

**coresense — keeps (persistence + renderer-facing):** `StateHolder` (`state/holder.ts`), sqlite `messagesStore` (`storage/messages.ts`), sqlite `discoveredStore` (`storage/discoveredContacts.ts`), `events/bus.ts` (`emit.*`), `server.ts` broadcast, `api/routes.ts`, `transport/manager.ts`/`ble.ts` noble lifecycle, `transport/companionFrame.ts` (inspector tap).

---

## File Structure

- **Create** `src/main/protocol/sessionAdapter.ts` — the `SessionAdapter` class: owns the `MeshCoreSession`, event→persistence wiring, command delegation. Replaces `session.ts`.
- **Create** `src/main/state/contactSync.ts` — extracted contact/discovered persistence (`ingestObservedContact`, `mergeAppOnlyFields`, `emitDiscovered`), called by the adapter. Reuses coresense's `discoveredStore`.
- **Create** `tests/support/session-harness.ts` — `makeTestSession()` returns `{ adapter, transport }` wired to a lib `LoopbackTransport`, replacing `emit.packet(companionPacket(...))`.
- **Modify** `src/main/transport/ble.ts` — expose `write`/`subscribe`/`watchState` hooks + `createBleTransport`; keep the `parseCompanionFrame`→`emit.packet` inspector tap; drop the `meshObservations`/`pendingChannelSends` correlation block.
- **Modify** `src/main/protocol/index.ts` — `protocolSession()` returns the `SessionAdapter` (same accessor name; `api/routes.ts`/`index.ts` unchanged).
- **Modify** `src/main/state/holder.ts` — add `recordLibMessage(message)` (raw persist + block-count, no re-merge).
- **Modify** `src/main/storage/discoveredContacts.ts` — repoint `ContactRecord` import to `@andyshinn/meshcore-ts`.
- **Modify** `src/main/api/routes.ts`, `src/main/bridge/drain.ts` — repoint type imports to `@andyshinn/meshcore-ts`.
- **Delete** `src/main/protocol/{session.ts, buffer.ts, codes.ts, encode.ts, registry.ts, feature.ts, meshPacket.ts, meshObservations.ts, pendingChannelSends.ts, repeater.ts}` and `src/main/protocol/features/*`.
- **Delete** `tests/unit/main/protocol/**` (internal protocol tests — now the library's responsibility).
- **Re-harness** `tests/integration/**` and `tests/e2e/**` to inject via `LoopbackTransport`.

---

## Phase A — Transport bridge

### Task A1: Expose BLE hooks and bridge through `createBleTransport`

**Files:**
- Modify: `src/main/transport/ble.ts`

- [ ] **Step 1: Add the lib transport import and a hook-exposing accessor**

At the top of `src/main/transport/ble.ts`, add:
```ts
import { createBleTransport } from '@andyshinn/meshcore-ts/transports';
import type { Transport, TransportState as LibTransportState } from '@andyshinn/meshcore-ts';
```

- [ ] **Step 2: Keep the inspector tap, drop the correlation block**

In `BleTransport.onData` (currently lines ~314-382), KEEP the `parseCompanionFrame(data)` call and BOTH `emit.packet({...})` branches (companion + mesh) so the packet inspector is unchanged. DELETE the `if (parsed.source === 'log_rx') { ... recordMeshObservation(...) ... attributeOutgoingChannelRelay(...) }` block (lines ~336-357) — the library does channel-send relay attribution internally. Remove the now-unused imports:
```ts
// delete these three imports:
// import { record as recordMeshObservation } from '../protocol/meshObservations';
// import { PAYLOAD_TYPE, parseMeshPacket } from '../protocol/meshPacket';
// import { attributeObservation as attributeOutgoingChannelRelay } from '../protocol/pendingChannelSends';
// import { createHash } from 'node:crypto';  // only used by the deleted block
```

- [ ] **Step 3: Expose a `libTransport()` that bridges noble I/O into the lib's Transport**

Add a field and a getter on `BleTransport`. The session writes via `write`, receives every TX notification via `subscribe`, and follows connect/disconnect via `watchState`. coresense already emits its own `emit.transportState` for the UI in `connect()`/`onPeripheralDisconnect()`; `watchState` is the **session's** view.

Add inside the class:
```ts
  private libStateCb: ((s: LibTransportState) => void) | null = null;
  private libDataCb: ((bytes: Uint8Array) => void) | null = null;

  /** The lib Transport the MeshCoreSession consumes. Bridges noble I/O:
   *  write→rxChar, TX notifications→onBytes, connect/disconnect→state. */
  readonly libTransport: Transport = createBleTransport({
    write: (bytes) => this.sendBytes(Buffer.from(bytes)),
    subscribe: (onBytes) => {
      this.libDataCb = onBytes;
    },
    watchState: (onState) => {
      this.libStateCb = onState;
    },
  });
```

- [ ] **Step 4: Feed inbound bytes + state to the session**

In `onData` (after the existing `parseCompanionFrame`/`emit.packet` tap), forward the raw frame to the session:
```ts
    this.libDataCb?.(Uint8Array.from(data));
```
In `connect()`, right after `emit.transportState('connected', deviceId)`, add:
```ts
    this.libStateCb?.('connected');
```
In `onPeripheralDisconnect()` and `disconnect()`, right after the existing `emit.transportState('idle', ...)`, add:
```ts
    this.libStateCb?.('idle');
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (ble.ts no longer references the deleted-block imports; `libTransport` is typed).

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/ble.ts
git commit -m "feat(transport): bridge noble I/O into meshcore-ts createBleTransport"
```

---

## Phase B — SessionAdapter skeleton + lifecycle

### Task B1: Create the adapter with lifecycle and transport wiring

**Files:**
- Create: `src/main/protocol/sessionAdapter.ts`

- [ ] **Step 1: Write the adapter skeleton**

Create `src/main/protocol/sessionAdapter.ts`:
```ts
import type { Buffer } from 'node:buffer';
import { MeshCoreSession, type Transport } from '@andyshinn/meshcore-ts';
import { transportManager } from '../transport/manager';
import { wireSessionEvents } from './adapterEvents';

const APP_NAME = 'coresense';
const APP_VERSION = 1;

/** Owns a MeshCoreSession and bridges its events into coresense's persistence
 *  + bus, and its command methods to the API layer. Replaces ProtocolSession. */
export class SessionAdapter {
  readonly session: MeshCoreSession;
  private started = false;

  constructor(transport: Transport) {
    this.session = new MeshCoreSession({ transport, appName: APP_NAME, appVersion: APP_VERSION });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    wireSessionEvents(this.session);
    this.session.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.session.stop();
  }
}
```

- [ ] **Step 2: Create a stub `adapterEvents.ts` (filled in Phase C)**

Create `src/main/protocol/adapterEvents.ts`:
```ts
import type { MeshCoreSession } from '@andyshinn/meshcore-ts';

/** Subscribe to every session event and write through to coresense's stores
 *  + bus. Filled out per event group in Phase C. */
export function wireSessionEvents(_session: MeshCoreSession): void {
  // Phase C wires the handlers here.
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` (PASS)
```bash
git add src/main/protocol/sessionAdapter.ts src/main/protocol/adapterEvents.ts
git commit -m "feat(adapter): SessionAdapter skeleton over MeshCoreSession"
```

---

## Phase C — Read-path: event → persistence + bus

All handlers live in `src/main/protocol/adapterEvents.ts`. Each task writes an integration test (via `makeTestSession`, Task G1) first; here the tests are listed with the handler. **Do Task G1 (test harness) before C's test steps** — implement G1 first, then return to Phase C, or write C's handlers and G1 together. The plan orders G1 in Phase G but it is a dependency for testing C; build `tests/support/session-harness.ts` (Task G1) before running C's tests.

### Task C1: Scalar + channel state handlers

**Files:**
- Modify: `src/main/protocol/adapterEvents.ts`
- Test: `tests/integration/inbound/device-info.test.ts` (re-harnessed in G2; assert deviceInfo flows)

- [ ] **Step 1: Implement the scalar handlers**

Replace `adapterEvents.ts` body with the scalar + channel wiring. Each scalar event writes the holder and re-emits the existing bus event (identical payloads to today):
```ts
import type { MeshCoreSession } from '@andyshinn/meshcore-ts';
import { emit } from '../events/bus';
import { stateHolder } from '../state/holder';

export function wireSessionEvents(session: MeshCoreSession): void {
  const ev = session.events;
  const holder = stateHolder();

  ev.on('transportState', (s) => emit.transportState(s));
  ev.on('owner', (o) => { holder.setOwner(o); emit.owner(o); });
  ev.on('deviceInfo', (info) => { holder.setDeviceInfo(info); emit.deviceInfo(info); });
  ev.on('deviceCapabilities', (caps) => { holder.setDeviceCapabilities(caps); emit.deviceCapabilities(caps); });
  ev.on('deviceIdentity', (id) => { holder.setDeviceIdentity(id); emit.deviceIdentity(id); });
  ev.on('radioSettings', (r) => { holder.setRadioSettings(r); emit.radioSettings(r); });
  ev.on('gpsConfig', (g) => { holder.setGpsConfig(g); emit.gpsConfig(g); });
  ev.on('telemetryPolicy', (t) => { holder.setTelemetryPolicy(t); emit.telemetryPolicy(t); });
  ev.on('autoAddConfig', (a) => { holder.setAutoAddConfig(a); emit.autoAddConfig(a); });
  ev.on('channels', (chs) => { holder.setChannels(chs); emit.channels(holder.getChannels()); });
  ev.on('channelPresence', (keys) => emit.channelPresence(keys));
  ev.on('syncProgress', (p) => emit.syncProgress(p));
  ev.on('pathLearned', (e) => emit.pathLearned(e));
  ev.on('repeaterStatus', (s) => emit.repeaterStatus(s));
  ev.on('repeaterTelemetry', (s) => emit.repeaterTelemetry(s));

  wireContacts(session);   // Task C2
  wireMessages(session);   // Task C3
}
```
Note: the lib's `DeviceInfo`/`Owner`/`RadioSettings`/etc. are structurally identical to coresense's shared types (Plan 1 already aligned `DeviceInfo`), so `holder.setX(libValue)` typechecks. If TS complains about a field coresense added (e.g. none currently), map explicitly.

- [ ] **Step 2: Run the re-harnessed device-info test (after G1/G2)**

Run: `pnpm test:integration -- device-info`
Expected: PASS — injecting a DEVICE_INFO frame through the transport folds it into `holder` and emits `deviceInfo`.

- [ ] **Step 3: Commit**

```bash
git add src/main/protocol/adapterEvents.ts
git commit -m "feat(adapter): scalar + channel state event handlers"
```

### Task C2: Contacts + discovered handlers

**Files:**
- Create: `src/main/state/contactSync.ts`
- Modify: `src/main/protocol/adapterEvents.ts`
- Test: `tests/integration/inbound/contact-discovered.test.ts`, `contact-evicted.test.ts` (re-harnessed)

- [ ] **Step 1: Create the contact-sync helpers (reuse coresense's discoveredStore)**

Create `src/main/state/contactSync.ts`:
```ts
import { advTypeToKind } from '../../shared/contacts/kind';
import type { Contact } from '../../shared/types';
import type { ContactRecord, ContactSource } from '@andyshinn/meshcore-ts';
import { emit } from '../events/bus';
import { stateHolder } from './holder';
import { discoveredStore } from '../storage/discoveredContacts';

/** Feed a raw observed contact record into the sqlite discovered pool and emit
 *  the refreshed discovered list. Mirrors the old features/contacts ingestContact
 *  discovery path. `source` is 'sync' (on-radio handshake) or 'advert' (heard live). */
export function ingestObservedContact(record: ContactRecord, source: ContactSource): void {
  const holder = stateHolder();
  const onRadio = source === 'sync' ? true : discoveredStore.get(record.publicKeyHex)?.on_radio !== 0;
  const isNewDiscovery = source === 'advert' && discoveredStore.get(record.publicKeyHex) === null;

  discoveredStore.upsert(record, { onRadio, nowMs: Date.now(), heardLive: source === 'advert' });
  emit.discovered(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));

  if (isNewDiscovery) {
    emit.contactDiscovered({
      key: `c:${record.publicKeyHex}`,
      name: record.name || record.publicKeyHex.slice(0, 12),
      kind: advTypeToKind(record.type),
    });
  }
}

/** Merge coresense-only fields (pinned/muted) from current holder contacts into
 *  the lib's authoritative contact list, persist, and emit. The lib owns
 *  favourite/outPath/preferDirect/pathManual/pathLearnedAt. */
export function applyLibContacts(libContacts: Contact[]): void {
  const holder = stateHolder();
  const prev = new Map(holder.getContacts().map((c) => [c.key, c]));
  const merged = libContacts.map((c) => {
    const old = prev.get(c.key);
    return old ? { ...c, pinned: old.pinned, muted: old.muted } : c;
  });
  holder.setContacts(merged);
  emit.contacts(merged);
}
```
(Confirm the import path of `advTypeToKind` — it is in `src/shared/contacts/kind.ts`; adjust if the repo places it elsewhere. `discoveredStore.get(...)` returns the sqlite `Row` with `on_radio`.)

- [ ] **Step 2: Wire the contact events in adapterEvents.ts**

Add a `wireContacts` function:
```ts
import { applyLibContacts, ingestObservedContact } from '../state/contactSync';
import { discoveredStore } from '../storage/discoveredContacts';

function wireContacts(session: MeshCoreSession): void {
  const ev = session.events;
  ev.on('contactObserved', (record, source) => ingestObservedContact(record, source));
  ev.on('contacts', (contacts) => applyLibContacts(contacts));
  ev.on('discovered', () => {
    // The lib also emits cooked 'discovered'; coresense's sqlite pool is the
    // authority (fed by contactObserved), so re-emit from the store for blocking.
    const holder = stateHolder();
    emit.discovered(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));
  });
  ev.on('contactDiscovered', (c) => emit.contactDiscovered(c));
  ev.on('contactEvicted', (name) => emit.contactEvicted(name));
}
```
Note: `contactDiscovered` is emitted both by `ingestObservedContact` (for genuinely-new discoveries, with blocking-aware naming) and re-emitted from the lib event; dedupe by NOT re-emitting in the `ev.on('contactDiscovered')` handler if `ingestObservedContact` already covers it — keep only the `ingestObservedContact` path and drop the `ev.on('contactDiscovered')` line. (The lib's `contactDiscovered` fires for the same observations `contactObserved` does.) Final: remove the `ev.on('contactDiscovered', ...)` re-emit; rely on `ingestObservedContact`.

- [ ] **Step 3: Re-harnessed contact tests pass**

Run: `pnpm test:integration -- contact-discovered contact-evicted contacts-iterator contacts-full`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/state/contactSync.ts src/main/protocol/adapterEvents.ts
git commit -m "feat(adapter): contacts + discovered write-through via contactObserved"
```

### Task C3: Message handlers

**Files:**
- Modify: `src/main/state/holder.ts` (add `recordLibMessage`)
- Modify: `src/main/protocol/adapterEvents.ts`
- Test: `tests/integration/inbound/channel-message.test.ts`, `dm-send-ack.test.ts` (re-harnessed)

- [ ] **Step 1: Add `recordLibMessage` to StateHolder**

The lib already merged paths + bumped `timesHeard`, so persist raw (no re-merge). Add to `StateHolder` (near `upsertMessage`):
```ts
  /** Persist a message the library already merged (idempotent by id). Bumps a
   *  block-rule match counter on genuinely-new ids, but does NOT re-run the
   *  path/timesHeard merge that upsertMessage does (the lib owns that). */
  recordLibMessage(message: Message): void {
    const isNew = !messagesStore.findById(message.id);
    if (isNew) {
      const rules = blockingStore().list();
      if (rules.length > 0) {
        const { blocked, ruleId } = isMessageBlocked(message, this.buildBlockHints(message), rules, blockingStore().regexCacheRef());
        if (blocked && ruleId) blockingStore().bumpMatchCount(ruleId);
      }
    }
    messagesStore.insert(message);
  }
```

- [ ] **Step 2: Wire the message events in adapterEvents.ts**

```ts
function wireMessages(session: MeshCoreSession): void {
  const ev = session.events;
  const holder = stateHolder();
  ev.on('messageUpserted', (m) => {
    holder.recordLibMessage(m);
    emit.messages(m.key, holder.getMessagesForKey(m.key));
  });
  ev.on('messageState', (id, state) => { holder.setMessageState(id, state); emit.messageState(id, state); });
  ev.on('messagePathHeard', ({ id, path }) => {
    const state = holder.appendMessagePath(id, path);
    if (state) emit.messagePathHeard({ id, path, state });
  });
}
```
Note: the lib also emits the full-list `messages` event; coresense relies on `messageUpserted` for persistence (surgical) and emits the holder-annotated full list. Do NOT also subscribe to the lib's `messages` event (would double-emit) — `messageUpserted` covers it.

- [ ] **Step 3: Re-harnessed message tests pass**

Run: `pnpm test:integration -- channel-message dm-send-ack drain`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/state/holder.ts src/main/protocol/adapterEvents.ts
git commit -m "feat(adapter): message write-through via messageUpserted (no re-merge)"
```

---

## Phase D — Command delegation

### Task D1: Expose command methods on the adapter

**Files:**
- Modify: `src/main/protocol/sessionAdapter.ts`

- [ ] **Step 1: Delegate each command method `api/routes.ts` calls**

Add these pass-throughs to `SessionAdapter` (signatures match both the old `ProtocolSession` and the lib `session`). Where the old method had a coresense-specific signature, match the old one and adapt to the lib call:
```ts
  // messaging
  sendChannelText(key: string, text: string) { return this.session.sendChannelText(key, text); }
  sendDmTextWithRetry(key: string, text: string, id: string) { return this.session.sendDmTextWithRetry(key, text, id); }
  sendStatusReq(key: string) { return this.session.sendStatusReq(key); }
  sendTelemetryReq(key: string) { return this.session.sendTelemetryReq(key); }
  // contacts
  addContactToRadio(pk: string) { return this.session.addContactToRadio(pk); }
  removeContactFromRadio(pk: string) { return this.session.removeContactFromRadio(pk); }
  setContactFavourite(pk: string, fav: boolean) { return this.session.setContactFavourite(pk, fav); }
  setContactPath(key: string, outPathHex: string, opts: { manual: boolean; preferDirect?: boolean }) { return this.session.setContactPath(key, outPathHex, opts); }
  resetContactPath(key: string) { return this.session.resetContactPath(key); }
  setContactPreferDirect(key: string, preferDirect: boolean) { return this.session.setContactPreferDirect(key, preferDirect); }
  // radio / device
  setPathHashMode(size: 1 | 2 | 3) { return this.session.setPathHashMode(size); }
  setRadioParams(opts: Parameters<MeshCoreSession['setRadioParams']>[0]) { return this.session.setRadioParams(opts); }
  setAdvertName(name: string) { return this.session.setAdvertName(name); }
  setAdvertLatLon(lat: number, lon: number, alt?: number) { return this.session.setAdvertLatLon(lat, lon, alt); }
  setOtherParams(policy: Parameters<MeshCoreSession['setOtherParams']>[0], sharePos: boolean) { return this.session.setOtherParams(policy, sharePos); }
  setAutoAddConfig(flags: Parameters<MeshCoreSession['setAutoAddConfig']>[0]) { return this.session.setAutoAddConfig(flags); }
  requestAutoAddConfig() { return this.session.requestAutoAddConfig(); }
  setGpsConfig(cfg: { enabled: boolean; intervalSec: number }) { return this.session.setGpsConfig(cfg); }
  reboot() { return this.session.reboot(); }
  sendSelfAdvert(flood?: boolean) { return this.session.sendSelfAdvert(flood); }
  requestDeviceInfo() { return this.session.requestDeviceInfo(); }
  requestBattAndStorage() { return this.session.requestBattAndStorage(); }
  requestCustomVars(key?: string) { return this.session.requestCustomVars(key); }
  // channels
  setChannel(idx: number, name: string, secretHex: string) { return this.session.setChannel(idx, name, secretHex); }
  markChannelPresent(channel: Parameters<MeshCoreSession['markChannelPresent']>[0]) { return this.session.markChannelPresent(channel); }
  markChannelAbsent(idx: number) { return this.session.markChannelAbsent(idx); }
  pickFreeSlot() { return this.session.pickFreeSlot(); }
  deriveSecret(name: string) { return this.session.deriveSecret(name); }
  getDevicePresence() { return this.session.getDevicePresence(); }
  getSyncProgress() { return this.session.getSyncProgress(); }
  // repeater admin
  repeaterLogin(key: string, password: string) { return this.session.repeaterLogin(key, password); }
  repeaterLogout(key: string) { return this.session.repeaterLogout(key); }
  repeaterRequestAcl(key: string) { return this.session.repeaterRequestAcl(key); }
  repeaterRequestNeighbours(key: string, opts: Parameters<MeshCoreSession['repeaterRequestNeighbours']>[1]) { return this.session.repeaterRequestNeighbours(key, opts); }
  repeaterRequestOwnerInfo(key: string) { return this.session.repeaterRequestOwnerInfo(key); }
  repeaterSendCli(key: string, command: string) { return this.session.repeaterSendCli(key, command); }
  repeaterTracePath(opts: Parameters<MeshCoreSession['repeaterTracePath']>[0]) { return this.session.repeaterTracePath(opts); }
  repeaterGetLocalStats(subtype: Parameters<MeshCoreSession['repeaterGetLocalStats']>[0]) { return this.session.repeaterGetLocalStats(subtype); }
```

- [ ] **Step 2: Typecheck against api/routes.ts call sites**

Run: `pnpm typecheck`
Expected: PASS. If `api/routes.ts` calls a method with a different arg shape than the lib (e.g. `repeaterLogin` return type, or `repeaterRequestNeighbours` opts), adjust the route's usage of the result — the lib's `repeaterLogin` returns `LoginSuccess & { mode, effective }` (same shape the old one returned). Repoint any `import type { AclEntry, LoginSuccess, ... } from './protocol/repeater'` in `api/routes.ts` to `from '@andyshinn/meshcore-ts'`.

- [ ] **Step 3: Commit**

```bash
git add src/main/protocol/sessionAdapter.ts src/main/api/routes.ts
git commit -m "feat(adapter): delegate command surface to MeshCoreSession"
```

---

## Phase E — Wire the adapter in; repoint imports

### Task E1: `protocolSession()` returns the adapter

**Files:**
- Modify: `src/main/protocol/index.ts`
- Modify: `src/main/storage/discoveredContacts.ts`, `src/main/bridge/drain.ts`

- [ ] **Step 1: Build the adapter with the production transport**

Replace `src/main/protocol/index.ts`:
```ts
import { transportManager } from '../transport/manager';
import { SessionAdapter } from './sessionAdapter';

let _session: SessionAdapter | null = null;

export function protocolSession(): SessionAdapter {
  if (!_session) {
    const transport = transportManager.getLibTransport();
    _session = new SessionAdapter(transport);
  }
  return _session;
}

export { SessionAdapter } from './sessionAdapter';
```
Add `getLibTransport()` to `transportManager` (`src/main/transport/manager.ts`) returning the active `BleTransport`'s `libTransport`. If no transport is installed yet (tests), this is only used by `protocolSession()`; tests use `makeTestSession()` instead and never call `protocolSession()`.

- [ ] **Step 2: Repoint `ContactRecord` import**

In `src/main/storage/discoveredContacts.ts`, change `import type { ContactRecord } from '../protocol/features/contacts';` to `import type { ContactRecord } from '@andyshinn/meshcore-ts';`. Do the same for `src/main/bridge/drain.ts` (repoint any `from '../protocol/...'` type imports to `@andyshinn/meshcore-ts`; check what it imports and map: `ContactRecord`, message/drain types).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: errors ONLY from files still importing the about-to-be-deleted `protocol/*` impl (handled in Phase F). The adapter + index + storage typecheck.

- [ ] **Step 4: Commit**

```bash
git add src/main/protocol/index.ts src/main/transport/manager.ts src/main/storage/discoveredContacts.ts src/main/bridge/drain.ts
git commit -m "feat(adapter): protocolSession() returns SessionAdapter; repoint ContactRecord"
```

---

## Phase F — Delete the old protocol implementation

### Task F1: Delete impl modules + internal unit tests

**Files:**
- Delete: `src/main/protocol/session.ts`, `buffer.ts`, `codes.ts`, `encode.ts`, `registry.ts`, `feature.ts`, `meshPacket.ts`, `meshObservations.ts`, `pendingChannelSends.ts`, `repeater.ts`, and `src/main/protocol/features/`.
- Delete: `tests/unit/main/protocol/` (entire directory).

- [ ] **Step 1: Delete the directories/files**

```bash
git rm -r src/main/protocol/features
git rm src/main/protocol/session.ts src/main/protocol/buffer.ts src/main/protocol/codes.ts \
       src/main/protocol/encode.ts src/main/protocol/registry.ts src/main/protocol/feature.ts \
       src/main/protocol/meshPacket.ts src/main/protocol/meshObservations.ts \
       src/main/protocol/pendingChannelSends.ts src/main/protocol/repeater.ts
git rm -r tests/unit/main/protocol
```

- [ ] **Step 2: Resolve remaining references**

Run: `pnpm typecheck`
Fix any remaining `from '.../protocol/...'` imports outside the adapter by repointing types to `@andyshinn/meshcore-ts` (e.g. a stray `STATS_TYPE`, `ERR_CODE`, `AclEntry` import in `api/routes.ts` or `bridge/`). The package re-exports `ADV_TYPE`, `ERR_CODE`, `RESP`, `STATS_TYPE`, etc. Grep to confirm zero references remain:
```bash
grep -rnE "from '.*protocol/(session|codes|encode|buffer|registry|feature|meshPacket|meshObservations|pendingChannelSends|repeater|features/)" src tests
```
Expected: no output.

- [ ] **Step 3: Typecheck passes**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(protocol): delete hand-rolled protocol impl + internal tests (now in meshcore-ts)"
```

---

## Phase G — Re-harness flow tests

### Task G1: `makeTestSession()` helper

**Files:**
- Create: `tests/support/session-harness.ts`

- [ ] **Step 1: Write the harness**

```ts
import { Buffer } from 'node:buffer';
import { LoopbackTransport } from '@andyshinn/meshcore-ts';
import { SessionAdapter } from '../../src/main/protocol/sessionAdapter';

export interface TestSession {
  adapter: SessionAdapter;
  transport: LoopbackTransport;
  /** Deliver one inbound companion frame (hex or Buffer) to the session. */
  receive(frame: Buffer | string): void;
}

/** Construct a SessionAdapter over a LoopbackTransport, started but NOT connected
 *  (so the handshake doesn't fire). Inject frames with `receive()`; assert on the
 *  emit.* bus + holder + transport.sent. */
export function makeTestSession(): TestSession {
  const transport = new LoopbackTransport();
  const adapter = new SessionAdapter(transport);
  adapter.start();
  return {
    adapter,
    transport,
    receive(frame) {
      const hex = typeof frame === 'string' ? frame : frame.toString('hex');
      transport.receiveHex(hex);
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/support/session-harness.ts
git commit -m "test: add makeTestSession harness over LoopbackTransport"
```

### Task G2: Convert inbound integration tests

**Files:**
- Modify: every file under `tests/integration/inbound/` (and `outbound/` for send-path).

- [ ] **Step 1: Convert each test's injection mechanism**

For each inbound test, replace the old pattern:
```ts
const session = protocolSession();
session.start();
// ...
emit.packet(companionPacket(frameBuf('deviceInfo')));
await Promise.resolve();
```
with:
```ts
const { receive } = makeTestSession();
// ...
receive(frameBuf('deviceInfo'));
await Promise.resolve();
```
Update imports: drop `protocolSession` + `companionPacket`; add `makeTestSession` from `../../support/session-harness`. Keep `frameBuf`/`frameHex`. Keep the existing `bus.on('deviceInfo', ...)` assertions — the adapter re-emits the same bus events. For outbound tests, assert on `transport.sent` (the `LoopbackTransport.sent` array; use `lastSentHex()`) instead of the old `FakeTransport.sent`.

- [ ] **Step 2: Run the integration suite**

Run: `pnpm test:integration`
Expected: PASS. Fix per-test: some tests assert handshake-driven behavior (contacts-iterator) — for those, drive the contact stream frames directly via `receive(...)` in the order the radio would send them (CONTACTS_START → CONTACT × N → END_OF_CONTACTS), since the handshake isn't auto-firing.

- [ ] **Step 3: Commit**

```bash
git add tests/integration
git commit -m "test: re-harness integration tests onto makeTestSession/LoopbackTransport"
```

### Task G3: Convert e2e replay tests

**Files:**
- Modify: `tests/e2e/connect-replay.spec.ts`, `tests/e2e/send-message.spec.ts`, and the replay transport (`src/main/transport/replay.ts` / `select.ts`).

- [ ] **Step 1: Point the replay transport at the adapter**

The e2e replay transport feeds recorded frames. Ensure it delivers them via the same `libTransport` path the production transport uses (so `MeshCoreSession.ingest` sees them). If `replay.ts` currently emits `emit.packet`, change it to also expose a `libTransport` (mirror Task A1) and deliver frames through `onData`. Keep the `transportState` push so the adapter's session runs its handshake against the replayed frames.

- [ ] **Step 2: Run e2e**

Run: `pnpm test:e2e`
Expected: PASS — `connect-replay.spec.ts` still asserts `owner-name` renders `egrme.sh Hand`; `send-message.spec.ts` still sends.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e src/main/transport
git commit -m "test(e2e): replay frames through the adapter's lib transport"
```

---

## Phase H — Verification

### Task H1: Full suite + lint + typecheck

- [ ] **Step 1: Typecheck** — `pnpm typecheck` (PASS)
- [ ] **Step 2: Lint** — `pnpm lint src tests` (PASS)
- [ ] **Step 3: Full tests** — `pnpm test` (PASS) and `pnpm test:e2e` (PASS)
- [ ] **Step 4: Commit any lint/format fixups**

```bash
git add -A && git commit -m "chore: lint/format after meshcore-ts swap" || echo "nothing to commit"
```

### Task H2: Hardware smoke

- [ ] Run `pnpm start`, connect to the Heltec, and confirm: owner name + Device group (model/firmware/build), contacts sync, battery/storage gauges, send a channel message + a DM (both reach the device and update state), the packet inspector still shows mesh + BLE frames, repeater login/status if available, and a disconnect/reconnect recovers. Compare against `npm run example examples/ble-get-device-info.ts`.

---

## Self-Review

- **Spec coverage:** Implements spec §3 (adapter behind WS contract), §4.1 (sessionAdapter + transport bridge + inspector tap kept), §4.2 (ble.ts hooks), §4.3 (StateHolder mapping; `recordLibMessage` for messages; `pinned`/`muted` merge), §5 (event→bus mapping — every `emit.*` covered; `contactsSync`/`error` note below), §6 (command delegation), §7 (deps — package already linked; meshcore-decoder kept), §8 (deletions), §9 (delete internal tests, re-harness flow tests), §13 (hardware smoke).
- **Gaps to confirm during execution:**
  - `emit.contactsSync` (handshake progress) — the lib drives `syncProgress` itself; coresense's `contactsSync` bus event was internal to the old handshake. Confirm nothing in the renderer/bridge subscribes to `contactsSync`; if it does, derive it from `syncProgress` in C1. (grep `contactsSync` before deleting.)
  - `emit.error` — the lib has no `error` event; command methods reject. Confirm `api/routes.ts` already surfaces command rejections to the client (it does, per route handlers); no `emit.error` needed for command failures. Transport errors still flow via `emit.transportState`.
  - `getContactByKey`, `getTuningParams`/`setTuningParams`, `exportContact`/`importContact`/`shareContact`, `signData`, `exportPrivateKey`/`importPrivateKey`, `setDevicePin`, `factoryReset`, `getDeviceTime`/`setDeviceTime`/`syncDeviceTime`, `sendPathDiscoveryReq`/`getAdvertPath`, flood-scope methods, `sendRawData`/`sendControlData`/`sendChannelData`/`sendRawPacket` — add adapter delegations for any of these that `api/routes.ts` (or `bridge/`) calls. Grep `protocolSession()\.` across `src/main` (done: the 25 in Phase D) and add any missed ones in Task D1.
- **Placeholder scan:** New code is complete; mechanical tasks (deletion/repoint/re-harness) give exact files, exact old→new patterns, and verification greps — not vague directives.
- **Type consistency:** `SessionAdapter` exposes `protocolSession()`-compatible methods; `wireSessionEvents`/`wireContacts`/`wireMessages` consistent; `recordLibMessage`/`ingestObservedContact`/`applyLibContacts` names used consistently across tasks; `libTransport`/`getLibTransport` paired.

## Risks

1. **Test re-harness volume** (Phase G) is the bulk of the work — ~27 integration tests. Convert mechanically; some handshake-dependent tests need frame ordering.
2. **Reproducibility** — still a `link:` dep; CI/clone needs meshcore-ts published (carry-over from Plan 1).
3. **Message timesHeard** — coresense recomputes its own count via `appendMessagePath`; the lib's count may differ slightly. Acceptable; verify the channel-message relay test.
