# Design: Migrate coresense onto the `@andyshinn/meshcore-ts` package

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Author:** Andy Shinn (with Claude)

## 1. Goal

coresense currently carries its own hand-rolled MeshCore companion-protocol
implementation in `src/main/protocol/` (a `ProtocolSession`, ~32 feature
modules, opcode tables, `BufferReader/Writer`, on-air mesh-packet parsing) plus
direct `@stoprocent/noble` BLE code, and uses `@michaelhart/meshcore-decoder`
in the renderer for packet inspection and contact-share URI decoding.

The `@andyshinn/meshcore-ts` package (local sibling repo at
`/Users/andy/GitHub/andyshinn/meshcore-ts`) is the extracted, more-complete
implementation of the same protocol. This project replaces coresense's
hand-rolled protocol layer with that package via `pnpm link`, removes
`@michaelhart/meshcore-decoder` entirely, and surfaces three device-info fields
the package newly exposes — **model**, **firmware version**, **firmware build
date** — in the owner-info hover card.

### Success criteria

- coresense talks to a real device (BLE) through `MeshCoreSession`; connect,
  contact sync, channel + DM send/receive, and the packet inspector all work.
- `@michaelhart/meshcore-decoder` is gone from `package.json`.
- The owner hover card shows Model / Firmware (version + ver code) / Build date.
- `typecheck`, `biome` (scoped to `src tests`), `vitest`, and the e2e replay
  suite are green.
- Verified on hardware (Heltec / HT-n5262G).

## 2. Why this is feasible (verification already done)

`@andyshinn/meshcore-ts@0.1.0` (built `dist/` is fresh — rebuilt after the
latest commit) provides everything coresense needs:

- **`MeshCoreSession`** with a typed event bus (`session.events`) and
  synchronous state getters (`session.state.get*()`). Its `MeshCoreEventMap`
  mirrors coresense's `emit.*` bus almost 1:1.
- **`DeviceInfo`** now includes `firmwareVersion` (`"v1.15.0"`),
  `firmwareBuildDate` (`"19 Apr 2026"`), `deviceModel` (`"Heltec T096"`),
  `blePin`, `firmwareVerCode`, plus the capacity/battery/storage fields
  coresense already has.
- **`createBleTransport({ write, subscribe, watchState })`** (from
  `@andyshinn/meshcore-ts/transports`) — a hooks-based bridge that lets
  coresense keep its own noble scan/connect/reconnect lifecycle and just feed
  bytes in/out.
- **`decodeOnAirPacket(input): OnAirPacket`** — a total on-air packet decoder
  (tagged-union `OnAirPayload`) covering every payload type the inspector
  decodes (advert, txtMsg, grpTxt, req, response, anonReq, ack, path, trace,
  control discover req/resp), plus exported `ROUTE_TYPE` / `PAYLOAD_TYPE` /
  `ADV_TYPE` consts and `parseAdvert` / `verifyAdvert`.
- **`rawPacket` session event** — `{ hex, source: 'raw'|'log_rx', snr, rssi }`,
  emitted for both `PUSH_RAW_DATA (0x84)` and `PUSH_LOG_RX_DATA (0x88)`. This
  feeds the packet inspector directly, so **no custom byte-stream sniffer is
  needed**.

The package ships **zero runtime dependencies** (Node built-ins only); it does
not bundle a BLE driver, so coresense keeps `@stoprocent/noble`.

## 3. Architecture

**Pattern: an adapter behind the existing main→renderer WebSocket contract.**

coresense's main process runs the protocol; an `EventBus` feeds a Hono +
WebSocket server that broadcasts `WsMessage`s to the React/Zustand renderer (and
a TCP bridge for remote clients). We replace `ProtocolSession` with a
`MeshCoreSession` plus one thin adapter that:

1. constructs `MeshCoreSession({ transport: createBleTransport(hooks) })`;
2. translates `session.events` and `session.state.*` getters into the existing
   `emit.*` calls → unchanged `WsMessage` broadcasts;
3. routes command handlers (API routes / IPC) to `session.*` methods.

The renderer, the WebSocket/`WsMessage` contract, the TCP bridge, storage
(sqlite/settings), and the server stay essentially unchanged.

```
Device (BLE)
  │  noble (scan/connect/reconnect/write-chain stays in ble.ts)
  ▼
createBleTransport({ write, subscribe, watchState })
  ▼
MeshCoreSession  ──session.events / session.state──▶  SessionAdapter
                                                          │  maps → emit.*()
                                                          ▼
                                                       EventBus
                                                          ▼
                                              server.ts broadcast(WsMessage)
                                                          ▼
                                          renderer useWebSocket → Zustand store → UI
```

*Rejected alternative:* expose the session/lib types directly to the renderer
and drop the EventBus/`WsMessage` indirection. Less mapping code, but it breaks
the IPC/WS contract and the TCP bridge and explodes the blast radius. Not worth
it.

## 4. Components

### 4.1 `src/main/protocol/sessionAdapter.ts` (new — replaces `session.ts`)

Owns the `MeshCoreSession` instance. Responsibilities:

- **Lifecycle:** `start()` / `stop()` wrap `session.start()` / `session.stop()`
  and subscribe/unsubscribe the event listeners.
- **Event → broadcast mapping** (see §5). Subscribes to each `session.events`
  event and calls the matching `emit.*`. For snapshot completeness it may read
  `session.state.get*()` on `transportState === 'connected'`.
- **Command surface:** exposes the same method names the API/IPC layer calls
  today (`sendChannelText`, `sendDmTextWithRetry`, `setRadioParams`,
  `addContactToRadio`, `setContactFavourite`, `setChannel`, `setPathHashMode`,
  `reboot`, `requestDeviceInfo`, `requestBattAndStorage`,
  `requestAutoAddConfig`, `setAdvertName`, `setAdvertLatLon`, `setOtherParams`,
  `requestCustomVars`, `getDevicePresence`, `pickFreeSlot`,
  `markChannelPresent/Absent`, `deriveSecret`, …) as thin delegations to
  `session.*`. The current call sites are a small, enumerable set.

### 4.2 `src/main/transport/ble.ts` (refactor)

- Keep all noble logic: scan (with debounce/auto-stop), connect (GATT discovery
  with timeouts), subscribe to TX notifications, write-without-response
  serialized through the write-chain, disconnect, and exponential-backoff
  reconnect.
- Expose three hooks and wrap them with `createBleTransport`:
  - `write(bytes)` → RX characteristic write.
  - `subscribe(onBytes)` → forward TX-notification buffers.
  - `watchState(onState)` → map noble connect/disconnect to transport state.
- **Remove** the bespoke `0x84`/`0x88` frame extraction that fed
  `emit.packet()` — the inspector feed now comes from the session's `rawPacket`
  event (mapped in the adapter).
- `TransportManager` and the `ITransport` interface stay.

### 4.3 `src/shared/types.ts` (extend)

- Keep coresense's shared types as the renderer/IPC contract. The lib's
  `Contact` / `Owner` / `Channel` / `RadioSettings` are structural supersets;
  coresense's `Contact` additionally carries app-only `pinned` / `muted`. Map
  lib → shared in one boundary module inside the adapter.
- **Extend `DeviceInfo`** with `firmwareVersion: string` and
  `firmwareBuildDate: string` (`deviceModel` already exists but is currently
  unrendered). Populate from the lib's `DeviceInfo` in the mapping. `blePin` is
  optional/extra and not required by this work.

### 4.4 Renderer: packet inspector + URI + role icons

- **`src/renderer/lib/decodePacket.ts`** — rewrite `summarizePacket(hex)` onto
  `decodeOnAirPacket(hex)`. Keep the **`PacketSummary` interface stable**
  (`routeName`, `typeName`, `detail`, `isValid`, plus a decoded payload object)
  so [PacketLog.tsx](../../../src/renderer/components/PacketLog.tsx) — the only
  consumer — needs minimal change.
  - `routeName`: map `header.routeType` via exported `ROUTE_TYPE` (build a
    reverse-name map locally).
  - `typeName`: from `OnAirPacket.payloadTypeName`.
  - `isValid`: `header !== null && payload.kind !== 'raw'`.
  - `detail`: per-`payload.kind` formatting (mirrors today's `detailFor`).
  - **Accepted, inherent limitation:** the inspector's REQ line drops the
    request-type *name*. The REQ_TYPE byte lives in the **encrypted body** of an
    on-air REQ packet, so it cannot be recovered from passively-observed traffic
    (confirmed by the package author). meshcore-ts now exports
    `getRequestTypeName` / `getAnonReqTypeName` (canonical enum-key names, e.g.
    `0x05 → 'GET_ACCESS_LIST'`) for callers that already hold the byte (outbound
    binary requests, or decrypted data) — coresense should use those rather than
    a local map if it ever needs the name, but the passive inspector REQ line
    stays `src→dst`.
- **`src/renderer/lib/meshcoreUri.ts`** — decode `meshcore://<hex>` via
  `decodeOnAirPacket(hex)`; require `payload.kind === 'advert'`; build
  `MeshcoreAdvert` from the `Advert` (publicKey, name, `appData.type` → role,
  `appData.latlon`, timestamp) and `verifyAdvert()` for signature validity.
- **`src/renderer/components/MeshcoreLink.tsx`** — role→icon map keyed on
  `ADV_TYPE` / `ContactKind` (chat/repeater/room/sensor) with a default for
  unknown.

### 4.5 Feature: owner hover-card "Device" group

In [OwnerCardPopover.tsx](../../../src/renderer/shell/leftnav/OwnerCardPopover.tsx),
add a new `Group title="Device"` (matching the existing `Group`/`KV` styling)
rendering:

- **Model** — `deviceInfo.deviceModel`
- **Firmware** — `deviceInfo.firmwareVersion` + ` (ver NN)` from
  `firmwareVerCode`
- **Build** — `deviceInfo.firmwareBuildDate`

Each value renders empty-safe (show `—` when a string is blank). Placed near the
top of the popover, above or beside the existing Radio group.

## 5. Event → broadcast mapping

The adapter wires each lib event to the existing bus key. Mapping is 1:1 except
the two noted rows.

| `session.events`        | coresense `emit.*`         |
|-------------------------|----------------------------|
| `rawPacket`             | `emit.packet` (inspector feed; payload = `{ payloadHex: hex }`) |
| `transportState`        | `emit.transportState`      |
| `contacts`              | `emit.contacts`            |
| `discovered`            | `emit.discovered`          |
| `contactDiscovered`     | `emit.contactDiscovered`   |
| `contactEvicted`        | `emit.contactEvicted`      |
| `channels`              | `emit.channels`            |
| `channelPresence`       | `emit.channelPresence`     |
| `messages`              | `emit.messages`            |
| `messageState`          | `emit.messageState`        |
| `messagePathHeard`      | `emit.messagePathHeard`    |
| `owner`                 | `emit.owner`               |
| `deviceInfo`            | `emit.deviceInfo` (mapped, + new fields) |
| `deviceCapabilities`    | `emit.deviceCapabilities`  |
| `deviceIdentity`        | `emit.deviceIdentity`      |
| `radioSettings`         | `emit.radioSettings`       |
| `autoAddConfig`         | `emit.autoAddConfig`       |
| `telemetryPolicy`       | `emit.telemetryPolicy`     |
| `gpsConfig`             | `emit.gpsConfig`           |
| `syncProgress`          | `emit.syncProgress`        |
| `pathLearned`           | `emit.pathLearned`         |
| `repeaterStatus`        | `emit.repeaterStatus`      |
| `repeaterTelemetry`     | `emit.repeaterTelemetry`   |
| *(none — by design)*    | `emit.error` — synthesized by the adapter from caught command rejections / transport errors |
| *(none)*                | `emit.contactsSync` — coresense-specific resync signal; adapter emits it where it drove resync before (e.g. after add/remove contact), or it is folded into `contacts` |

During planning, confirm each `WsMessage` payload shape matches the lib event
payload; where a broadcast wants a full snapshot the lib only deltas, read
`session.state.get*()`.

## 6. Command surface mapping

Current call sites resolve to a small set; each maps to an identically-named (or
near-identical) `MeshCoreSession` method: `setChannel`, `requestCustomVars`,
`setRadioParams`, `setPathHashMode`, `setOtherParams`, `setAdvertName`,
`setAdvertLatLon`, `requestDeviceInfo`, `requestBattAndStorage`,
`requestAutoAddConfig`, `getDevicePresence`, `pickFreeSlot`,
`markChannelPresent`, `markChannelAbsent`, `deriveSecret`, plus the messaging /
contact / repeater methods. The adapter exposes these as pass-throughs.

## 7. Dependencies

- **Add:** `@andyshinn/meshcore-ts` via `pnpm link`
  (`/Users/andy/GitHub/andyshinn/meshcore-ts`). First plan step: `pnpm build`
  in the meshcore-ts repo to guarantee a current `dist/`, then link.
- **Remove:** `@michaelhart/meshcore-decoder`.
- **Keep:** `@stoprocent/noble` (the lib ships no BLE driver).
- Confirm `vite.main.config.mts` resolves the ESM/CJS lib cleanly (pure-JS;
  bundles fine; noble stays external as a native module).

## 8. Deletions

- `src/main/protocol/features/*`, `buffer.ts`, `codes.ts`, `encode.ts`,
  `registry.ts`, `feature.ts`, `meshPacket.ts` (on-air parsing now in the lib),
  and `session.ts` (→ `sessionAdapter.ts`). Delete only what becomes
  unreferenced; verify with a usage sweep before removing each.
- Protocol-internal unit tests: `tests/unit/main/protocol/{buffer,registry,
  repeater,errors}.test.ts` and per-feature decoder tests.

## 9. Testing strategy

- **Delete** protocol-internal unit tests (now the library's responsibility).
- **Keep + adapt** the integration tests that exercise the main→renderer flow
  against the new adapter + fake transport: `tests/integration/inbound/*`
  (device-info, batt-storage, contacts-iterator/full, contact-discovered/
  evicted) and `tests/integration/outbound/*` (add-contact, contact-interop,
  device-admin, device-time). These assert on `emit.*` / state outcomes, which
  the adapter preserves; update fixtures/imports as needed.
- **Keep + adapt** e2e: `tests/e2e/connect-replay.spec.ts` (asserts
  `owner-name`) and `tests/e2e/send-message.spec.ts`, driven by
  `tests/support/fake-transport.ts`.
- **Add** one DOM test asserting the hover-card "Device" group renders Model /
  Firmware / Build from a seeded `deviceInfo`.
- Gates: `pnpm typecheck`, `pnpm lint` (scoped `biome check src tests`),
  `pnpm test`, `pnpm test:e2e`.

## 10. Error handling

The lib intentionally has no `error` event; command methods reject and the
transport surfaces failures via `transportState: 'error'`. The adapter:

- wraps command delegations and, on rejection, emits `emit.error` with a
  user-facing message (preserving today's error broadcast behavior);
- maps `transportState: 'error'` to the existing transport-state broadcast;
- keeps reconnect/backoff in `ble.ts` (transport-level), unchanged.

## 11. Risks / open items (resolve during planning)

1. **Event payload shape parity** — enumerate each `WsMessage` payload vs. the
   lib event payload; fill snapshot gaps from `session.state.*`.
2. **`emit.error` / `emit.contactsSync` synthesis** — confirm where coresense
   currently raises these and reproduce the triggers in the adapter.
3. **Vite/ESM bundling** of the linked package in the Electron main bundle.
4. **`PacketSummary` shape** — keep stable so `PacketLog.tsx` is minimally
   touched; confirm it renders nothing that depended on meshcore-decoder's
   `DecodedPacket` internals.

## 12. Out of scope

- Restoring the REQ `requestType` name in the *passive* inspector — impossible
  without decryption (the byte is in the encrypted body). meshcore-ts now
  exports `getRequestTypeName` / `getAnonReqTypeName` for callers that already
  hold the byte; the observed-packet REQ line stays `src→dst`. The `pnpm build`
  step in §7 ensures these new exports are present in the linked `dist/`.
- Serial/TCP transports (BLE only this round).
- Any change to the renderer beyond the four files in §4.4–4.5.

## 13. Verification (hardware smoke checklist)

After automated gates pass, on a real device:

1. Launch the app; scan finds the device; connect succeeds.
2. Owner name renders; **Device group shows model / firmware version / build
   date**.
3. Contacts sync; battery/storage/capacity gauges populate.
4. Send a channel message and a DM; both reach the device and update state.
5. Open the packet inspector; on-air packets decode (advert/text/group/etc.).
6. Disconnect/reconnect recovers cleanly.
