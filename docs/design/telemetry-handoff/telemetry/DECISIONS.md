# Telemetry — implementation decisions (2026-10-10)

This file amends `PLAN.md`. Where they disagree, **this file wins**. It records the answers the product owner gave before implementation, plus firmware facts verified against `meshcore-dev/MeshCore`.

Scope: **Part 1 + Part 2 in one PR** (core commits first, UI after). No e2e runs; verify with vitest + tsc + biome (`src tests`) + a scratch vite build.

## Verified facts that override PLAN.md

1. **LPP 116 (voltage) and 117 (current) are signed int16.** ElectronicCats `getTypeSigned()` returns true for both, whatever the header comment says. Decode as signed.
2. **Mesh replies are zero-padded** to a 16-byte AES block (`Utils.cpp:98-103`). Self reads over BLE/USB are not. Padding guard: at a record boundary, if every remaining byte is `0x00`, stop with `rest` empty. MeshCore never uses ch 0.
3. **Ch 1 also carries the MCU temperature** (type 103) whenever the board has one, guests included.
   - Remote replies (repeater, companion-as-target) are ordered voltage, [GPS], sensors, MCU temp **last**.
   - Self reads are ordered voltage, MCU temp, then sensors/GPS.
   - Label it **"MCU temp"** with the Lucide `Cpu` icon.
   - Because ch 1 can hold two temperatures (T1000-E: GPS + luminosity + temperature on ch 1, plus MCU), a reading's identity is **(ch, typeId, occurrence index within that ch+type)**, not (ch, typeId).
4. **MLX90614 is two channels, one temperature each** (object, then ambient), not two temps on one channel.
   - BSEC adds analog input.
   - RAK12035 calibration adds a second channel.
   - **INA3221 emits voltage + current per channel on up to 3 consecutive channels** (verify in `EnvironmentSensorManager.cpp` whether power is emitted too). The product owner runs exactly this: an INA3221 with 3 power channels.
   - Generic sensor (100) is gas resistance Ω (BME680) or IAQ (BSEC).
   - Follow the firmware, not the PLAN table, and keep the "field set matches X" wording.
5. **Repeaters answer only clients in their ACL**; others are silently dropped, which shows as a timeout. Guests get `perm_mask=0`: voltage + MCU temp only. Read-only and read-write roles get everything.
6. **The companion firmware keeps ONE pending request per radio.** `clearPendingReqs()` runs on every login, status, telemetry, binary or discovery send, so a second admin request kills a pending telemetry reply.
7. **The lib's `sendTelemetryReq` is fire-and-forget**; use `session.sendBinaryRequest(contactKey, reqData, {timeoutMs})` (public, `Promise<Buffer>` of raw LPP, tag stripped).
   - Send `reqData = [0x03, 0x00 /* ~0xFF = all perms */, 0, 0, 0, rand4…]`, mirroring firmware's own sender.
   - A disconnect rejects every admin awaiter. Map that to outcome `error` ("disconnected").
8. **Persistence uses `node:sqlite` `DatabaseSync`** in `messages.db` (`src/main/storage/db.ts`), not better-sqlite3. There is no migration framework: use `CREATE … IF NOT EXISTS` plus guarded `ALTER`. Store raw bytes the way the packet log does.
9. Routes live under `/api/` (Hono, `src/main/api/routes.ts`). Contact keys in the app are `c:<64hex>`.
10. Battery helper: `lipoPercent(mv)` / `formatVoltage(mv)` in `src/renderer/lib/battery.ts` takes **mV**. Move both to `src/shared` (re-export or update imports) and convert V→mV.

## Product decisions (answers)

| Topic | Decision |
|---|---|
| Lib sequencing | A **separate session** does the meshcore-ts work. The lib spec is in `MESHCORE-TS-SPEC.md`. Coresense builds against that API now with **runtime feature detection** in the SessionAdapter, so the PR compiles and runs on 0.8.1. The PR stays in **draft** until the lib release, then gets bumped. **Done:** 0.9.0 shipped and the bump removed the feature detection, the 0.8.1 fallbacks and the "Needs meshcore-ts 0.9" states. |
| My radio | New **`tool:myradio`** main-pane panel, opened from the left-nav OwnerCard and its popover. It holds only the telemetry view: read button, groups/tiles, saved-read log, policy, sensor settings, and a per-contact flags rail. **No** empty Overview/Identity/Firmware tabs. |
| Concurrency | A **radio-wide mesh-request lock** in main, acquired by telemetry and by the awaited admin requests (login, ACL, neighbours, owner, CLI). Status is fire-and-forget and is not covered; note this in the PR. While telemetry holds the lock, other admin buttons are disabled with the hint "Waiting for telemetry request". If the lock is busy, return 409 `radio_busy`. A second request for the same node **joins** the in-flight promise; it does not start another request. |
| Timeout | Deadline = firmware **`est_timeout` + 2 s margin**, counted from RESP_SENT, when the lib exposes it (`onSent`, see spec). **Fallback: 15 s overall from the click** (0.8.1). Loading copy shows the real figure: "waiting for reply · Ns · timeout at Ts". Expose `deadlineAt` (epoch ms, or null until known) in the in-flight event. |
| Policy source of truth | **The radio.** Read the modes back from SELF_INFO: use `session.getSelfInfo()` now and the lib's `telemetryPolicy` fold later. Seed the holder on connect, and stop the app's JSON copy overwriting the radio. My radio's segmented controls (**Deny / Per contact / Everyone**) write immediately. Settings › Radio › Telemetry becomes a **link row** to My radio. Multi-acks stays in Settings › Radio › Messages (same byte, so it is preserved on write). Fix the Base copy to "battery voltage, MCU temperature". GPS stays in Settings › Radio › Position, and My radio mirrors it. |
| Contact kinds | **Repeater + sensor** get the Telemetry tab (between Status and ACL in RepeaterAdmin) and the rail section. `source: 'contact'` stays in the model, with no UI. |
| No login | The request button stays enabled, with the hint "Repeaters reply only to logged-in clients". On a timeout with no session, the failed state offers **"Log in"**, which switches to the Login tab (no dialog, so no "…"). |
| Role | Store the full **`aclRole: 'guest' \| 'readOnly' \| 'readWrite' \| 'admin' \| null`**, matching the app's existing `RepeaterAclRole`. Chip copy: "Granted as admin", "Granted as read-only", etc. |
| Hardware | LiPo repeaters, repeaters with I²C sensors including **INA3221 (3 power channels, V + I each)**, and a T1000-E/GPS companion. Test fixtures must cover these. |
| Retention | **One global value** in `AppSettings`: default 50 per node, range 1–500. Editable in the compare rail ("Keep per node · applies to all nodes") and in Settings › App. Shrinking prunes immediately. No per-node override. |

## Accepted defaults (B-items)

- **B3 `permsGranted` is inferred.**
  - Repeater/room guest → `0x01`.
  - Other known roles → `0x07`.
  - Sensor → `0x07`.
  - Companion self → `0x07`.
  - Unknown → `null`, and no chips are shown.
- **B4 No partial outcome.** A guest reply is `ok`; the UI derives "base only" from `aclRole === 'guest'`.
- **B5 Failures before sending are not saved.** Offline, contact not on radio, or no full key return 503/422 and the UI shows a toast. Timeouts, disconnects and RESP_ERR are saved as `timeout`/`error`. A POST that ran returns 200 with the `SavedRequest`, whatever the outcome.
- **B6 Reading key** is `(ch, typeId, occurrence)`, as in fact 3.
- **B7 Ch 1 temperature** is "MCU temp" with `Cpu`. For remote replies it is the last ch-1 temperature, for self reads the first. If a ch 1 holds more than one temperature, the other is labelled "Temperature".
- **B8 Field-set matches** follow the firmware (fact 4).
  - MLX90614 is two adjacent lone-temperature channels: "matches MLX90614 (object/ambient)".
  - Add a BSEC row and a "RAK12035 calibration" row; the latter suppresses the W/Hz units.
  - INA3221 is a V+I group per channel.
  - Captions keep the PLAN's wording ("field set matches …").
- **B9 New pure decoder** at `src/shared/telemetry/lpp.ts` (no Node/DOM), with a single type registry `id → {name, len, decode, unit, step, signed, icon}`. 116 and 117 are signed. Use raw bytes from `sendBinaryRequest`.
- **B10 Battery %:** `lipoPercent` moves to shared. Show "≈ N% est." only when the ch 1 voltage is between 3.0 and 4.4 V; otherwise hide it. Use the existing curve (4.25 V → 100). Bar colour: `online` token.
- **B11 Retention:** see above.
- **B12 Legacy path removed:** `POST /api/repeater/:key/telemetry`, the `repeaterTelemetry` WS event, the `repeaterTelemetryByKey` store slice and `api.repeaterTelemetry`.
  - Ignore unsolicited `0x8B` pushes, but keep `noteHeard` last-heard bumps if a test depends on them.
  - Rewire the command-palette "Request repeater telemetry" action to the new flow.
  - Rewire the ContactDetail "Telemetry" button to open the new Telemetry tab.
- **B13 Rail:** a separate `rail.contact.telemetry` RailSection after the contact card. It targets the focal repeater/sensor contact (not the selected neighbour). Pinned rows: battery first, then one per channel. The trailing slot shows "from HH:MM · age". It has a "Request telemetry" button and an "N saved requests" link to the tab.
- **B14 Tab icon** is `ThermometerSun`.
- **B15 Sensor settings.**
  - Show the GPS switch only when the radio reports `gps`; otherwise "No GPS detected on this radio".
  - `gps_interval` is write-only in firmware. Label it "last set from CoreSense".
  - A rejected interval (T1000) is a partial save, with an error toast.
- **B16 Flags rail.**
  - An inline-editable table with search listing on-radio chat contacts, flagged contacts first.
  - Columns Base / Loc / Env, each enabled only when that mode is "Per contact".
  - Drop the "Permissions…" copy.
  - Writes need the lib; show a disabled state with "Needs meshcore-ts 0.9" when unsupported.
- **B17 Compare.**
  - Up to 6 columns, newest on the left.
  - "Compare with previous" selects this request plus the previous `ok` one.
  - Guest replies can be selected; failed requests are disabled.
  - "Show changes only" hides rows whose values are all equal.
  - Export CSV builds a renderer Blob and an anchor download, with columns `reading,ch,type,<ISO time per column>`.
  - A drift warning appears when a channel's field set differs between columns.
- **B18 Stale:** "viewing an older request" means the selected request is not the newest, or it is more than 1 h old. Deleting a single request has no confirm (toast "Request deleted"). "Clear saved requests…" asks for confirmation.
- **B19 Secondary lines.**
  - Keep dew point (from temp + humidity on the same channel), "= unchanged since HH:MM", and "N m from advertised" (GPS vs the contact's advert lat/lon).
  - Drop "solar input", "in a pocket…", "discharging… left" and "from radio".
  - Write "est." on every estimate.
- **B20 Formatting.**
  - Every time goes through the existing `fmtTime`/`fmtDateTime` (respect `timeFormat`).
  - Add a seconds-precision age formatter ("12 s ago") and a duration formatter ("2 h 14 m").
  - Metric first, imperial secondary; ignore `distanceUnit`.
  - Use the Unicode minus "−" in display values.
- **B21 LppInspector** reuses the Packet Log `ByteStrip` with ch/type/value fields, plus the decoded table and dimmed `rest` bytes. Collapsed by default.
- **B22 Contact deletion:** telemetry history is kept, as messages are.
- **B23 Companion reads are saved too** (`source: 'companion'`, `nodeKey` = owner public key). My radio has the same log + selection layout, and "N saved reads" toggles the log column.

## Architecture contract

- **Node key:** store the bare lowercase 64-hex public key as `node_key`. Routes take `:nodeKey` as either the bare hex or the app's `c:<hex>` contact key, normalised by one helper. The owner's own public key means `source: 'companion'`.
- **Shared, pure, under `src/shared/telemetry/`:**
  - `lpp.ts`: registry + `decodeLpp`.
  - `describe.ts`: `describeReading`, `describeChannel` (group label, match caption), power estimate, dew point.
  - `format.ts`: value/unit formatting, metric + imperial.
  - `previous.ts`: `readingKey`, `previousFor` over decoded requests, compare-table builder, CSV builder.
  - `types.ts`: `SavedRequest`, DTOs, WS payloads.
- **Main:**
  - `src/main/storage/telemetry.ts`: table `telemetry_requests` with index `(node_key, requested_at DESC)`; `insert` + prune in one transaction; `list`, `get`, `delete`, `clear`, `pruneAll(limit)`.
  - `src/main/telemetry/service.ts`: request orchestration, lock, deadline, in-flight registry.
  - Plus the mesh-request lock module.
  - Adapter methods are feature-detected; unsupported calls throw a typed `LibUnsupportedError`, which routes map to 501 `lib_unsupported`.
- **API (follow the repo's existing route style):**
  - `POST /api/telemetry/:nodeKey/request` → `SavedRequestDto` (200 even on timeout/error outcomes; 409 `radio_busy`; 503/422 for pre-send failures).
  - `GET /api/telemetry/:nodeKey` → `SavedRequestDto[]` (newest first, decoded readings included).
  - `GET /api/telemetry/request/:id` → `SavedRequestDto` plus a `previous` entry per reading, each `{ reading, requestedAt } | null`. Register the literal `request` route first.
  - `DELETE /api/telemetry/request/:id`, `DELETE /api/telemetry/:nodeKey`.
  - Companion policy, flags and custom vars extend the existing `/api/device/...` routes where they exist.
- **WS events** (follow the bus/broadcast conventions):
  - `telemetrySaved { request }`.
  - `telemetryDeleted { nodeKey, ids | 'all' }`.
  - `telemetryInFlight { inFlight: Array<{ nodeKey, source, startedAt, deadlineAt | null }> }`, a full snapshot each time. It is also included in the app snapshot.
- **Renderer:**
  - The api client, store slices (`telemetryByNode`, `telemetryInFlight`, selected request per node, compare selection) and ws handlers.
  - Components in `src/renderer/features/telemetry/`: `TelemetryPanel`, `TelemetryRequestList`, `TelemetryGroup`, `TelemetryTile`, `TelemetryRow`, `LppInspector`, `TelemetryCompare`.
  - Only `TelemetryPanel` knows the source.
  - Renderer memo rule: never select `s.ui` wholesale; use narrow selectors.
- **Copy rules:** sentence case; errors are `<Action> failed: <reason>`; toasts are past-tense fragments with no period ("Telemetry saved"); join metadata with "·"; "…" only for dialog openers; British spelling; no emoji and no "!".
- **Tinted chips:** measure contrast against the chip's own fill, not the page (`bg-X/15`). Several of the mockup chip colours fail AA.
