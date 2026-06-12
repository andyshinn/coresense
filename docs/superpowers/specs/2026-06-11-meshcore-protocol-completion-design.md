# MeshCore Protocol Completion & Per-Feature Modularization — Design Spec

**Date:** 2026-06-11
**Status:** Draft (design); pending user review → implementation plan
**Branch:** TBD (`feat/protocol-completion`)

## Summary

Bring CoreSense's MeshCore companion-radio protocol layer to **feature parity with
the current firmware** (v1.16.0, `FIRMWARE_VER_CODE = 13`, 65 commands) and, in the
same sweep, **rearchitect the protocol layer into per-feature modules** so future app
features can be built without ever re-touching the wire protocol.

Today CoreSense implements **34 of 65** firmware commands (2 of those — `EXPORT_CONTACT`,
`IMPORT_CONTACT` — are declared in `codes.ts` but have no encoder). Incoming-frame
dispatch is a ~290-line parse-and-react `if/else` chain in `ProtocolSession.onPacket`
([session.ts:1422](../../../src/main/protocol/session.ts#L1422)). Encoders/decoders are
flat function tables in [encode.ts](../../../src/main/protocol/encode.ts) /
[decode.ts](../../../src/main/protocol/decode.ts), reading raw `Buffer` at hardcoded
absolute offsets.

This work:

1. **Completes the protocol** — adds the ~26 missing commands + their responses/pushes
   across 9 feature areas.
2. **Modularizes** — introduces a `Feature` registry so each feature owns its codes,
   encoders, decoders, frame handler, and session-facing methods. `onPacket` becomes a
   thin dispatcher. **All existing features migrate into the same structure**, test-guarded,
   module-by-module.
3. **Borrows three proven pieces** from the official
   [meshcore.js](https://github.com/meshcore-dev/meshcore.js) reference: a cursor-based
   `BufferReader`/`BufferWriter`, a complete CayenneLPP type table, and advert
   parsing + ed25519 signature verification.

**Scope is the protocol layer only** — `codes` + encode/decode + `ProtocolSession`
methods + tests. No IPC bridge wiring, no UI. The deliverable is a complete, uniformly
structured set of protocol building blocks.

Firmware truth verified against `/Users/andy/GitHub/meshcore-dev/MeshCore/`
(`examples/companion_radio/MyMesh.cpp`, `src/helpers/`); reference patterns verified
against `/Users/andy/GitHub/meshcore-dev/meshcore.js/` (v1.7.0).

## Goals

- Implement **every** firmware companion command/response/push, including destructive
  and build-flag-gated ones (implemented + frame-tested; device behavior not exercised).
- Reorganize the protocol layer so a "feature" is a single, self-contained, independently
  testable module — what it does, how it's used, what it depends on, all in one place.
- Replace the central `onPacket` switch with a code→feature registry; eliminate hardcoded
  buffer offsets in favor of a cursor reader/writer.
- Keep the full test suite green at **every** migration step.
- Round-trip unit tests for every encoder/decoder; integration tests for stateful/async flows.

## Non-Goals

- No IPC/bridge exposure of new commands; no renderer or UI work. (Future features wire
  these building blocks as needed.)
- No new transport types (TCP/web-BLE/web-serial). CoreSense's existing BLE+serial
  transport stays.
- No `BinaryToTextTranslator` (binary→CLI text-mode for room/repeater text interface) —
  explicitly out of scope.
- No protocol-version downgrade paths beyond what the firmware itself gates; we continue
  to negotiate `APP_PROTOCOL_VERSION = 4`.

## Current state & gap analysis

| | Firmware (truth) | CoreSense (today) |
|---|---|---|
| Commands | 65 | 34 defined (2 without encoder) |
| Protocol ver | `FIRMWARE_VER_CODE 13` (fw v1.16.0) | negotiates `APP_PROTOCOL_VERSION 4` |

Note: meshcore.js (v1.7.0, supported protocol version **1**) is *behind* CoreSense in
several areas (no anon/binary requests, custom vars, stats, path-hash mode, most repeater
admin). It is a field-level reference, **not** a completeness target. The firmware is the
target.

### Missing surface, grouped (the 9 new feature modules)

| Group | Missing commands (firmware code) | Missing responses / pushes |
|---|---|---|
| **A. Device time** | `GET_DEVICE_TIME` (5), `SET_DEVICE_TIME` (6) | `RESP_CURR_TIME` (9) |
| **B. Contact interop** | `SHARE_CONTACT` (16), `GET_CONTACT_BY_KEY` (30); **encoders** for `EXPORT_CONTACT` (17) / `IMPORT_CONTACT` (18) | **decoder** for `RESP_EXPORT_CONTACT` (11) |
| **C. Device admin / security** | `EXPORT_PRIVATE_KEY` (23), `IMPORT_PRIVATE_KEY` (24), `SET_DEVICE_PIN` (37), `FACTORY_RESET` (51) | **decoder** for `RESP_PRIVATE_KEY` (14), `RESP_DISABLED` (15) |
| **D. Radio tuning** | `GET_TUNING_PARAMS` (43), `SET_TUNING_PARAMS` (21) | `RESP_TUNING_PARAMS` (23) |
| **E. Message signing** | `SIGN_START` (33), `SIGN_DATA` (34), `SIGN_FINISH` (35) | `RESP_SIGN_START` (19), `RESP_SIGNATURE` (20) |
| **F. Flood scope** | `SET_FLOOD_SCOPE_KEY` (54), `SET_DEFAULT_FLOOD_SCOPE` (63), `GET_DEFAULT_FLOOD_SCOPE` (64) | `RESP_DEFAULT_FLOOD_SCOPE` (28) |
| **G. Path diagnostics** | `SEND_PATH_DISCOVERY_REQ` (52), `GET_ADVERT_PATH` (42) | `RESP_ADVERT_PATH` (22), `PUSH_PATH_DISCOVERY_RESPONSE` (0x8d), `PUSH_PATH_UPDATED` (0x81) |
| **H. Raw / control / channel data** | `SEND_RAW_DATA` (25), `SEND_RAW_PACKET` (65), `SEND_CONTROL_DATA` (55), `SEND_CHANNEL_DATA` (62) | `PUSH_CONTROL_DATA` (0x8e), `RESP_CHANNEL_DATA_RECV` (27) |
| **I. Misc** | `HAS_CONNECTION` (28), `GET_ALLOWED_REPEAT_FREQ` (60); optional `alt` field on `SET_ADVERT_LATLON` (14) | `RESP_ALLOWED_REPEAT_FREQ` (26), `PUSH_ADVERT` (0x80), formal registration of `PUSH_LOG_RX_DATA` (0x88) |

Exact byte layouts in the **Appendix**.

## Firmware reality (the constraints that shape this design)

- **Synchronous vs async.** Most new commands reply synchronously (`RESP_OK`/`ERR` or one
  typed `RESP`). Exceptions: **path discovery** (52) replies `RESP_SENT` with a `tag`,
  then the real result arrives later as `PUSH_PATH_DISCOVERY_RESPONSE` (0x8d) —
  await-by-tag, identical to the existing telemetry/status/trace pattern via
  `adminSessions`.
- **Signing is the one true sub-state-machine.** `SIGN_START → RESP_SIGN_START` (carries
  `max_len = MAX_SIGN_DATA_LEN = 8192`) → N× `SIGN_DATA` chunks (each ≤ `MAX_FRAME_SIZE-1`,
  reply `RESP_OK`) → `SIGN_FINISH → RESP_SIGNATURE` (64-byte ed25519 sig). Out-of-order
  frames return `ERR_CODE_BAD_STATE`; over-budget data returns `ERR_CODE_TABLE_FULL`.
- **Build-flag-gated commands.** `EXPORT_PRIVATE_KEY`/`IMPORT_PRIVATE_KEY` depend on
  `ENABLE_PRIVATE_KEY_EXPORT`/`_IMPORT`; when off the firmware replies `RESP_DISABLED` (15).
- **Destructive, no-reply / reboot commands.** `FACTORY_RESET` (51) expects the literal
  ASCII `"reset"`, replies `RESP_OK`, then reboots (link drops) — same shape as existing
  `REBOOT`. These are implemented + frame-tested only.
- **`MAX_FRAME_SIZE = 176`**, all multi-byte integers little-endian.
- **`EXPORT_CONTACT`/`IMPORT_CONTACT`** carry a serialized `mesh::Packet` advert blob
  (`Packet::writeTo`/`readFrom`) — this is what the borrowed `Advert` parser decodes.
- **`GET_CONTACT_BY_KEY`** replies with a standard `RESP_CONTACT` (0x03, 148 bytes) — the
  existing `parseContact` decoder is reused; only a one-shot await is new.
- **`PUSH_ADVERT` (0x80)** is a *known-contact re-advert*, just `[pubkey 32B]`; distinct
  from `PUSH_NEW_ADVERT` (0x8a) which carries the full 148-byte contact.

## Architecture

### The `Feature` module

Because decode is coupled to side effects (a branch parses **and** reacts), a feature
module owns its encoders, decoders, frame handler, and public methods together:

```ts
// src/main/protocol/feature.ts
export interface Feature {
  /** Wire codes (RESP_*/PUSH_*) this feature decodes & reacts to. */
  readonly handles: readonly number[];
  /** React to an inbound frame for one of `handles`. */
  handle(code: number, frame: Buffer, ctx: FeatureContext): void;
  /** Public, session-facing API, bound to a context. */
  methods(ctx: FeatureContext): Record<string, (...args: never[]) => unknown>;
}
```

Each module also exports its **pure** encoders (`encode*`) and decoders (`decode*`),
which are side-effect-free and trivially round-trip testable.

### Registry & dispatch

```ts
// src/main/protocol/registry.ts — builds a code→feature map from a feature list,
// asserting no two features claim the same code.
```

`ProtocolSession.onPacket` becomes:

```ts
onPacket(p) {
  if (p.kind !== 'companion' || p.code === undefined) return;
  const feature = this.registry.get(p.code);
  if (feature) return feature.handle(p.code, Buffer.from(p.bytes), this.ctx);
  return this.legacyOnPacket(p);   // shrinks to empty during migration, then deleted
}
```

`ProtocolSession` collects each feature's `methods(ctx)` and re-exposes them, so the
public session API (`session.getDeviceTime()`, `session.shareContact()`, …) is unchanged
in shape — methods just live in modules now.

### `FeatureContext` — the controlled session surface

The only session internals a feature may touch. Module-level singletons the current
branches already import directly (`stateHolder()`, `emit`, `adminSessions`,
`discoveredStore`) stay direct imports — they are **not** threaded through the context.

```ts
export interface FeatureContext {
  writeFrame(frame: Buffer): Promise<void>;
  /** Send → await a synchronous RESP_OK/ERR or one typed RESP. Replaces the
   *  bespoke pendingAcks FIFO / pendingLocalStats single-slot patterns.
   *  Rejects with ProtocolError(errCode) on RESP_ERR; FeatureDisabledError on RESP_DISABLED. */
  request(opcode: number, frame: Buffer, opts?: { expect?: number; timeoutMs?: number }): Promise<Buffer>;
  /** Await an async push correlated by tag (path discovery; mirrors adminSessions tags). */
  awaitTag(tagHex: string, opts?: { timeoutMs?: number }): Promise<Buffer>;
}
```

`request()` is the generic helper validated by meshcore.js's `once(RespCode)`/`once(Err)`
race-to-resolve ergonomics — but backed by CoreSense's existing FIFO/tag correlation
(meshcore.js's global-emitter approach races when two same-type requests overlap; we keep
the stricter correlation).

### Shared primitive: `BufferReader` / `BufferWriter` (borrowed)

A cursor-based reader/writer ([buffer.ts](../../../src/main/protocol/buffer.ts), new),
TS-typed and `Buffer`-backed, replaces hardcoded absolute offsets like
`frame.readUInt32LE(132)`. Ported from meshcore.js with additions:

- Reader: `readByte/readInt8/readUInt16LE/readInt16LE/readUInt32LE/readInt32LE/readInt24BE/
  readBytes(n)/readRemaining/readString/readCString(maxLen)` + `remaining`.
- Writer: `writeByte/writeInt8/writeUInt16LE/writeUInt32LE/writeInt32LE/writeBytes/
  writeString/writeCString(s, maxLen)` + `toBuffer()`.

`readCString(maxLen)` centralizes the many fixed null-padded 31/32-byte name fields.
Every feature module's encode/decode is written against this; existing encoders/decoders
migrate to it as they move into modules.

### Error model

Extend `ERR_CODE` (today only `TABLE_FULL`) to the firmware's full set:

```ts
export const ERR_CODE = {
  UNSUPPORTED_CMD: 0x01, NOT_FOUND: 0x02, TABLE_FULL: 0x03,
  BAD_STATE: 0x04, FILE_IO_ERROR: 0x05, ILLEGAL_ARG: 0x06,
} as const;
```

- `ProtocolError extends Error { errCode }` — thrown by `ctx.request()` on `RESP_ERR`,
  carrying the firmware err byte.
- `FeatureDisabledError extends Error` — `RESP_DISABLED` for gated commands.
- Existing `ContactTableFullError`/`UnknownContactError` keep working (the former maps to
  `errCode === TABLE_FULL`).
- No-reply commands (`REBOOT`, `FACTORY_RESET`) resolve optimistically.

## Migration strategy (test-guarded)

Registry and legacy switch coexist during migration. Two parallel tracks:

1. **Add new features** as modules from day one (registry path only — no legacy involvement).
2. **Migrate existing features** one at a time. Each migration is one atomic, revertible step:
   move a feature's branch + its encoders/decoders into a module → register it → delete the
   legacy branch → **run full suite** (must stay green). When the legacy switch is empty,
   remove `legacyOnPacket` and the fallback.

Existing features to migrate (each becomes a module): `appStart/selfInfo`, `deviceInfo`,
`battAndStorage`, `contacts` (iterator + new-advert + deleted + full), `directMessages`
(send + acks + recv V1/V3), `channelMessages` (send + recv V1/V3 + channel info),
`channels`, `repeaterAdmin` (login/logout/cli/acl/neighbours/owner/status/trace + binary +
local stats), `telemetry`, `radioParams`, `advertConfig` (name/latlon/self-advert/other
params), `customVars/gps`, `autoAdd`, `pathHashMode`, `drain` (msg-waiting / next-msg /
no-more). The existing test suite under [tests/](../../../tests/) is the safety net.

## New feature modules

Each new module follows the same template: `handles`, `handle()`, pure `encode*`/`decode*`,
and `methods(ctx)`. Public `ProtocolSession` methods listed per group; full frame layouts
in the Appendix.

- **A. `features/time.ts`** — `getDeviceTime(): Promise<number>` (CURR_TIME),
  `setDeviceTime(epochSecs)` (rejects `ILLEGAL_ARG` on non-decreasing), `syncDeviceTime()`.
- **B. `features/contactInterop.ts`** — `shareContact(pubKeyHex)`,
  `exportContact(pubKeyHex?)` → advert blob (self when omitted),
  `importContact(blob)`, `getContactByKey(pubKeyHex)` (reuses `parseContact`). Decodes
  `RESP_EXPORT_CONTACT`; blob parsing uses the borrowed `Advert`.
- **C. `features/deviceAdmin.ts`** — `exportPrivateKey()` (→ `FeatureDisabledError` when
  gated), `importPrivateKey(key)`, `setDevicePin(pin)` (0 or 6-digit),
  `factoryReset()` (sends `"reset"`, optimistic). Decodes `RESP_PRIVATE_KEY`/`RESP_DISABLED`.
- **D. `features/tuning.ts`** — `getTuningParams()` → `{ rxDelayBase, airtimeFactor }`
  (firmware encodes ×1000), `setTuningParams(opts)`.
- **E. `features/signing.ts`** — owns the state machine: `signData(bytes): Promise<Buffer>`
  orchestrates START → chunked DATA → FINISH and returns the 64-byte signature; guards
  `BAD_STATE`/over-budget.
- **F. `features/floodScope.ts`** — `setFloodScopeKey(key16 | { unscoped: true })`,
  `setDefaultFloodScope(name, key16)` / clear, `getDefaultFloodScope()` → `{ name, key } | null`.
- **G. `features/pathDiagnostics.ts`** — `sendPathDiscoveryReq(pubKeyHex)` (RESP_SENT tag →
  `awaitTag` → `PUSH_PATH_DISCOVERY_RESPONSE`), `getAdvertPath(pubKeyHex)` →
  `{ recvTimestamp, path }`. Reacts to `PUSH_PATH_UPDATED` (refresh contact path).
- **H. `features/rawData.ts`** — `sendRawData(pathHex, payload)`,
  `sendRawPacket(priority, packetBytes)`, `sendControlData(bytes)` (asserts high bit),
  `sendChannelData(opts)`. Reacts to `PUSH_CONTROL_DATA` and `RESP_CHANNEL_DATA_RECV`.
- **I. `features/misc.ts`** — `hasConnection(pubKeyHex): Promise<boolean>` (OK/ERR),
  `getAllowedRepeatFreq()` → `Array<{ lowerHz, upperHz }>`; reacts to `PUSH_ADVERT` (0x80,
  known re-advert → touch contact). Extend existing `SET_ADVERT_LATLON` encoder with
  optional `alt` (bytes 9–12, int32 LE).

## Borrowed enhancements

1. **`BufferReader`/`BufferWriter`** — described above (shared primitive).
2. **CayenneLPP completeness** — port the missing LPP types into the existing table-driven
   decoder ([decode.ts:235](../../../src/main/protocol/decode.ts#L235)): GPS (136, int24×3),
   Generic sensor (100), Percentage (120), Power (128), Concentration (125), Altitude (121),
   Distance (130), Energy (131), Direction (132), Unixtime (133), Accelerometer (113),
   Gyrometer (134), Colour (135), Frequency (118), Switch (142), Polyline (240). Adds
   `readInt24BE` (provided by the new reader). Keeps the existing table shape and
   abort-on-unknown safety.
3. **Advert parse + ed25519 verify** — `features/advert.ts` (or a shared
   `protocol/advert.ts`): `Advert.fromBytes(payload)` → `{ publicKey, timestamp, signature,
   appData: { type, lat, lon, name } }` and `verify()` using Node's built-in `crypto`
   ed25519 (**no new dependency**). Used by `contactInterop` to decode export/import blobs
   and, optionally, to authenticate adverts seen via `PUSH_LOG_RX_DATA`.

## Testing

- **Unit (per feature):** round-trip — `encode*` produces the exact firmware bytes (golden
  buffers), `decode*` parses captured fixtures back to the expected struct. Co-located under
  `tests/unit/main/protocol/features/<group>.test.ts`. `buffer.ts` gets its own primitive tests.
- **Integration:** stateful/async flows — signing sequence, path-discovery await-by-tag,
  export→import round-trip, `RESP_DISABLED` handling, `RESP_ERR` code propagation — under
  [tests/integration/](../../../tests/integration/) (outbound/inbound), reusing the existing
  fake-transport harness.
- **Migration guard:** the **entire** suite runs green after every feature migration step
  (CI + local). A red suite blocks the next step.
- **Fixtures:** captured frames under [tests/fixtures/frames/](../../../tests/fixtures/frames/).
- Lint scoped to `src tests` (repo-wide lint trips on build artifacts — see project memory).

## Phasing / sequencing

One cohesive sweep, but ordered so risk is front-loaded into infrastructure and the suite
stays green throughout:

1. **Infra:** `buffer.ts` (+ tests), `feature.ts`, `registry.ts`, `context.ts`
   (`request`/`awaitTag`), error types, `ERR_CODE` expansion. Wire registry into `onPacket`
   with full legacy fallback (no behavior change; suite green).
2. **Migrate existing features** into modules, one per step, suite green each time, until
   `legacyOnPacket` is empty and removed.
3. **New features A–I** as modules (independent of each other; can parallelize).
4. **Borrowed enhancements** (CayenneLPP table, Advert+verify) folded into their owning
   modules (telemetry, contactInterop).
5. **Final pass:** confirm 65/65 command coverage; remove dead code; full suite + lint.

## Risks & mitigations

- **Migrating intricate working code (contacts iterator, DM acks, drain).** *Mitigation:*
  one feature per atomic step, full suite green each step, each step revertible. These
  branches already have integration tests.
- **`request()` must exactly preserve existing FIFO ack semantics** (e.g.
  `addContactToRadio` detecting `TABLE_FULL`). *Mitigation:* implement `request()` to wrap
  the existing `pendingAcks` behavior; migrate the simplest features first to validate it
  before touching DM/contact flows.
- **Firmware line numbers in the Appendix are extraction-time references** and may drift.
  *Mitigation:* byte layouts (not line numbers) are the contract; TDD against captured
  real frames validates each decoder; implementers read the firmware while writing tests.
- **Build-gated / destructive commands can't be behavior-tested.** *Mitigation:* explicit
  non-goal; frame-level unit tests only; `RESP_DISABLED` path tested with a synthetic frame.
- **Scope creep into IPC/UI.** *Mitigation:* hard non-goal; methods return data, nothing wires.

## Open questions

- Should `PUSH_LOG_RX_DATA` (0x88) advert authentication (via the new `Advert.verify`) be
  on by default, or opt-in behind a debug flag? (Leaning opt-in; transport already routes
  0x88 mesh bytes today.)
- `request()` correlation for the handful of single-typed-RESP commands that currently use
  bespoke single-slot fields (`pendingLocalStats`): fold into `request()` during their
  feature's migration, or leave until the owning feature moves? (Leaning: fold during migration.)

## Key references

- Firmware: `/Users/andy/GitHub/meshcore-dev/MeshCore/examples/companion_radio/MyMesh.cpp`
  (`handleCmdFrame` + writer/push helpers), `src/helpers/` (`ContactInfo`, `Identity`,
  `Packet`). Version: `MyMesh.h` `FIRMWARE_VER_CODE = 13`, fw v1.16.0.
- Reference lib: `/Users/andy/GitHub/meshcore-dev/meshcore.js/` v1.7.0 —
  `src/buffer_reader.js`, `src/buffer_writer.js`, `src/advert.js`, `src/cayenne_lpp.js`,
  `src/connection/connection.js`.
- CoreSense protocol: [codes.ts](../../../src/main/protocol/codes.ts),
  [encode.ts](../../../src/main/protocol/encode.ts), [decode.ts](../../../src/main/protocol/decode.ts),
  [session.ts](../../../src/main/protocol/session.ts), [repeater.ts](../../../src/main/protocol/repeater.ts),
  [companionFrame.ts](../../../src/main/transport/companionFrame.ts).

---

## Appendix — exact frame layouts (new surface)

All integers little-endian. `code` = frame byte 0. Layouts extracted from firmware
`MyMesh.cpp`; cross-checked against `companionFrame.ts` response-name table.

### A. Device time
- **`GET_DEVICE_TIME` (5):** `[0x05]`. → `RESP_CURR_TIME`.
- **`RESP_CURR_TIME` (9):** `[0x09][epoch u32]` (5 B).
- **`SET_DEVICE_TIME` (6):** `[0x06][epoch u32]`. → `OK`, or `ERR ILLEGAL_ARG` if epoch < current.

### B. Contact interop
- **`SHARE_CONTACT` (16):** `[0x10][pubkey 32B]`. → `OK` / `ERR NOT_FOUND` / `ERR TABLE_FULL`.
- **`EXPORT_CONTACT` (17):** `[0x11]` (self) or `[0x11][pubkey 32B]`. → `RESP_EXPORT_CONTACT`.
- **`RESP_EXPORT_CONTACT` (11):** `[0x0b][serialized mesh::Packet advert blob…]` (`Packet::writeTo`: `[header][transport_codes? 4B][path_len][path][payload]`).
- **`IMPORT_CONTACT` (18):** `[0x12][advert blob…]` (min len > 2+32+64). → `OK` / `ERR ILLEGAL_ARG`.
- **`GET_CONTACT_BY_KEY` (30):** `[0x1e][pubkey 32B]`. → `RESP_CONTACT` (0x03, 148 B, existing `parseContact`) / `ERR NOT_FOUND`.

### C. Device admin / security
- **`EXPORT_PRIVATE_KEY` (23):** `[0x17]`. → `RESP_PRIVATE_KEY` or `RESP_DISABLED`.
- **`RESP_PRIVATE_KEY` (14):** `[0x0e][prv_key 64B]` (65 B).
- **`IMPORT_PRIVATE_KEY` (24):** `[0x18][prv_key 64B]` (optionally `+[pub_key 32B]` → 97 B). → `OK` / `ERR ILLEGAL_ARG` / `ERR FILE_IO_ERROR` / `RESP_DISABLED`. Side effect: reloads contacts.
- **`SET_DEVICE_PIN` (37):** `[0x25][pin u32]` (pin 0 or 100000–999999). → `OK` / `ERR ILLEGAL_ARG`.
- **`FACTORY_RESET` (51):** `[0x33]"reset"` (5 ASCII). → `OK` then reboot / `ERR FILE_IO_ERROR`.
- **`RESP_DISABLED` (15):** `[0x0f]` (1 B).

### D. Radio tuning
- **`SET_TUNING_PARAMS` (21):** `[0x15][rx_delay_base×1000 u32][airtime_factor×1000 u32]` (9 B; firmware divides by 1000). → `OK`.
- **`GET_TUNING_PARAMS` (43):** `[0x2b]`. → `RESP_TUNING_PARAMS`.
- **`RESP_TUNING_PARAMS` (23):** `[0x17][rx_delay_base×1000 u32][airtime_factor×1000 u32]` (9 B).

### E. Message signing (stateful)
- **`SIGN_START` (33):** `[0x21]`. → `RESP_SIGN_START`.
- **`RESP_SIGN_START` (19):** `[0x13][reserved u8][max_len u32 = 8192]` (6 B).
- **`SIGN_DATA` (34):** `[0x22][chunk…]` (chunk ≤ `MAX_FRAME_SIZE-1`). → `OK` / `ERR BAD_STATE` / `ERR TABLE_FULL`.
- **`SIGN_FINISH` (35):** `[0x23]`. → `RESP_SIGNATURE` / `ERR BAD_STATE`.
- **`RESP_SIGNATURE` (20):** `[0x14][signature 64B]` (65 B).

### F. Flood scope
- **`SET_FLOOD_SCOPE_KEY` (54):** variant 0 → `[0x36][0x00][key 16B]` (set scope key); variant 1 → `[0x36][0x01]` (unscoped). → `OK`.
- **`SET_DEFAULT_FLOOD_SCOPE` (63):** `[0x3f][name 31B][key 16B]` (set; name 1–30 chars) or short frame → clear. → `OK` / `ERR ILLEGAL_ARG`.
- **`GET_DEFAULT_FLOOD_SCOPE` (64):** `[0x40]`. → `RESP_DEFAULT_FLOOD_SCOPE`.
- **`RESP_DEFAULT_FLOOD_SCOPE` (28):** `[0x1c][name 31B][key 16B]` (48 B) when set, else `[0x1c]` (1 B).

### G. Path diagnostics
- **`SEND_PATH_DISCOVERY_REQ` (52):** `[0x34][reserved u8][pubkey 32B]` (34 B). → `RESP_SENT` (0x06) `[flood u8][tag u32][est_timeout u32]`, then async `PUSH_PATH_DISCOVERY_RESPONSE`.
- **`PUSH_PATH_DISCOVERY_RESPONSE` (0x8d):** `[0x8d][reserved u8][pubkey_prefix 6B][out_path_len u8][out_path…][in_path_len u8][in_path…]`.
- **`GET_ADVERT_PATH` (42):** `[0x2a][reserved u8][pubkey 32B]`. → `RESP_ADVERT_PATH` / `ERR NOT_FOUND`.
- **`RESP_ADVERT_PATH` (22):** `[0x16][recv_timestamp u32][path_len u8][path…]`.
- **`PUSH_PATH_UPDATED` (0x81):** `[0x81][pubkey 32B]` (33 B).

### H. Raw / control / channel data
- **`SEND_RAW_DATA` (25):** `[0x19][path_len i8][path…][payload ≥4B]` (path_len ≥ 0; flood unsupported). → `OK` / `ERR`.
- **`SEND_RAW_PACKET` (65):** `[0x41][priority u8][raw packet bytes…]`. → `OK` / `ERR TABLE_FULL` / `ERR ILLEGAL_ARG`.
- **`SEND_CONTROL_DATA` (55):** `[0x37][b1 (high bit 0x80 set)…]`. → `OK` / `ERR`.
- **`SEND_CHANNEL_DATA` (62):** `[0x3e][channel_idx u8][path_len u8 (0xff=flood)][path…][data_type u16][payload…]`. → `OK` / `ERR NOT_FOUND` / `ERR ILLEGAL_ARG` / `ERR TABLE_FULL`.
- **`PUSH_CONTROL_DATA` (0x8e):** `[0x8e][snr×4 i8][rssi i8][path_len u8][payload…]`.
- **`RESP_CHANNEL_DATA_RECV` (27):** `[0x1b][snr×4 i8][rsv u8][rsv u8][channel_idx u8][path_len u8 (0xff=flood)][data_type u16][data_len u8][data…]`.

### I. Misc
- **`HAS_CONNECTION` (28):** `[0x1c][pubkey 32B]`. → `OK` (connected) / `ERR NOT_FOUND`.
- **`GET_ALLOWED_REPEAT_FREQ` (60):** `[0x3c]`. → `RESP_ALLOWED_REPEAT_FREQ`.
- **`RESP_ALLOWED_REPEAT_FREQ` (26):** `[0x1a]` then N× `[lower_freq u32][upper_freq u32]` (8 B per range, to frame limit).
- **`PUSH_ADVERT` (0x80):** `[0x80][pubkey 32B]` (33 B) — known-contact re-advert (distinct from `PUSH_NEW_ADVERT` 0x8a, 148 B full contact).
- **`SET_ADVERT_LATLON` (14), extended:** `[0x0e][lat i32][lon i32]` (+ optional `[alt i32]` at bytes 9–12). → `OK` / `ERR ILLEGAL_ARG`.
