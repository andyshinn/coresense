# meshcore-ts 0.9.0: telemetry additions

CoreSense needs these in order to finish its telemetry screens. CoreSense already calls them through runtime feature detection (`typeof session.x === 'function'`), so the names and shapes below are the contract. If a name changes in the lib, also update `src/main/protocol/sessionAdapter.ts` in coresense.

File and line references are to meshcore-ts `main` @ v0.8.2-dev.0 and MeshCore firmware `examples/companion_radio/MyMesh.cpp`.

## 1. Self telemetry (blocks My radio › Read telemetry)

```ts
session.requestSelfTelemetry(opts?: { timeoutMs?: number /* default 5000 */ }): Promise<Buffer /* raw LPP */>
```

- Write `CMD_SEND_TELEMETRY_REQ` with **len == 4**: `[0x27, 0, 0, 0]`.
  - There is no pubkey. `buildSendTelemetryReq` always appends 32 bytes (`protocol/repeater.ts:363-369`), so add a separate encoder.
- Resolve on `PUSH_CODE_TELEMETRY_RESPONSE` (0x8B) `[0x8B][0x00][6B prefix][LPP]` whose prefix equals the **owner** public key prefix. Pass the LPP bytes through verbatim; they are unpadded.
  - Today `handleTelemetryResponse` drops this frame as "unknown sender" (`features/repeaterAdmin.ts:716-724`).
- **Reject on `RESP_ERR`.** Older firmware without the self branch replies `ERR_CODE_UNSUPPORTED_CMD`. The rejection message should contain `unsupported`.
- Do **not** emit `repeaterTelemetry` for self replies.
- Firmware sends no RESP_SENT here and uses no airtime (`MyMesh.cpp:1737-1757`).

## 2. RESP_SENT info and cancellation for binary requests (timeout copy)

```ts
session.sendBinaryRequest(
  contactKey: string,
  reqData: Buffer,
  opts?: {
    timeoutMs?: number,
    signal?: AbortSignal,                                            // new
    onSent?: (info: { flood: boolean; estTimeoutMs: number }) => void // new
  },
): Promise<Buffer>
```

- `onSent` fires once RESP_SENT arrives for this request. `flood` and `est_timeout` are parsed exactly as the DM path parses them (`features/directMessages.ts:181-193`).
- `signal` aborts the wait: it rejects with `AbortError` and releases the tag.
- **Map `RESP_ERR` to a rejection.** Today a RESP_ERR (NOT_FOUND / TABLE_FULL) after CMD_SEND_BINARY_REQ surfaces as the 5 s RESP_SENT timeout, or another ack waiter consumes it.
- Optional, and worth doing: correlate RESP_SENT per frame type instead of giving the admin FIFO first claim on every RESP_SENT. A DM sent just before a telemetry request can have its ack consumed (`directMessages.ts:483-487`).

## 3. Telemetry policy read-back

- In `applySelfInfo` (`features/selfInfo.ts:141-200`), fold `telemetryModeBase/Loc/Env` (byte 46) and `multiAcks` (byte 44) into `state.telemetryPolicy`, then **emit `telemetryPolicy`**.
- The lib default `{1,1,1,1}` must not survive a SELF_INFO. CoreSense works around this today with `session.getSelfInfo()`.

## 4. Per-contact telemetry permission flags

```ts
interface TelemetryPerms { base: boolean; loc: boolean; env: boolean }
Contact.telemetryPerms: TelemetryPerms            // from flags >> 1: bit1 base, bit2 loc, bit3 env
DiscoveredContact.telemetryPerms: TelemetryPerms
session.setContactTelemetryPerms(contactKey: string, perms: TelemetryPerms): Promise<boolean>
```

- **Write.** `CMD_ADD_UPDATE_CONTACT` (0x09) replaces the whole record, so preserve bit 0 (favourite) and every other field. Await RESP_OK. Update state and emit the contact change.
- **Fix the two clobbers:**
  - `setContactPath` writes `flags: 0` (`session.ts:966-973`). That wipes favourite **and** telemetry permissions, and it is already a bug today.
  - The `sendAnonReq` zero-hop shim writes `flags: favourite ? 1 : 0` (`features/repeaterAdmin.ts:288-292`), which wipes telemetry permissions.
  - Both must preserve `row.flags`, as `setContactFavourite` does (`session.ts:1077`).

## 5. Generic custom vars (sensor settings)

```ts
session.requestCustomVars(): Promise<Record<string, string>>   // resolves {} on an empty reply
session.setCustomVar(key: string, value: string): Promise<boolean>
event 'customVars': Record<string, string>                     // fires on every reply, including {}
```

- Firmware `CMD_GET_CUSTOM_VARS` (0x28) **ignores the key** and returns every setting as `RESP_CODE_CUSTOM_VARS` (0x15) `"k:v,k:v"`.
  - With no GPS hardware the reply is empty. Today the lib returns early and emits nothing (`features/customVars.ts:43-57`), so "no GPS" can't be told apart from "no reply".
- `gps_interval` is **write-only** in firmware. Nothing ever reports it, and T1000 rejects it.
- `setGpsConfig` clamps the interval to 60–86399, while firmware accepts 0–86400. Align the comment or the clamp.
- Keep the existing `gpsConfig` event for compatibility.

## 6. Nice to have

- `parseTelemetryLpp`:
  - Read 116/117 as **signed** int16 (ElectronicCats `getTypeSigned()`).
  - Stop at trailing zero padding; mesh replies are AES-block padded.
  - Keep the undecoded tail.
- Telemetry `sendBinaryRequest` could accept a permission mask, building `[0x03, ~mask, 0,0,0, rand4]`. CoreSense already builds this itself.

## Tests to add

- A self-read frame round trip.
- RESP_ERR → rejection.
- `onSent` carries flood and estTimeoutMs.
- An abort releases the tag.
- SELF_INFO emits `telemetryPolicy`.
- Flags survive `setContactPath` and the anon shim.
- `setContactTelemetryPerms` keeps favourite.
- An empty custom-vars reply emits `{}`.
