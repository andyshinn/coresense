# Telemetry — implementation plan

Add CayenneLPP telemetry to CoreSense for repeaters (and other contacts) and for my own companion radio, built from one shared set of components.

This plan is split in two. **Do Part 1 only** unless told otherwise. Part 2 (UI) is a separate task.

The visual spec is in `mockups/` (see "Reading the mockups" at the end). The design is final for this round; match its layout, copy and tokens.

---

## Product decisions (do not revisit)

1. **Manual requests only.** A telemetry request is a heavyweight mesh operation. No polling, no auto-refresh, no intervals, no background requests. The only trigger is the user clicking **Request telemetry** (repeater/contact) or **Read telemetry** (my radio).
2. **Every request is saved.** Successes, partial replies (e.g. guest/base-only) and failures (timeouts) are all stored, so past requests can be viewed later.
3. **No graphs or sparklines.** Requests are irregular in time, so a time axis is misleading. History is a list of requests plus a side-by-side compare table.
4. **Every reading in the selected request gets a tile.** A tile shows a "was X at HH:MM" line only if an earlier saved request contained the same reading (same channel + LPP type). A newly added sensor shows its tile with no previous line.
5. **"Previous" means the most recent earlier saved request that has that reading**, not just the request directly before. A guest/base-only reply or a timeout in between must not hide earlier environment values.
6. **Repeater and companion share components.** Only `TelemetryPanel` knows the source; groups, tiles and rows don't.
7. **Raw bytes are always kept**, so saved requests can be decoded again if the decoder improves. The decoded readings may be cached, but raw is the source of truth.

---

## Part 1 — core (no UI)

### 1.1 `decodeLpp(bytes)` — shared, pure

Place it in the shared package or folder the repo already uses for code shared by main and renderer. It must have no Node or DOM dependencies.

```ts
type LppTypeId = number;

interface Reading {
  ch: number;          // LPP channel
  typeId: LppTypeId;   // LPP type id (e.g. 103)
  offset: number;      // byte offset of this reading's [ch] byte in the payload
  len: number;         // total bytes incl. ch + type
  value: number | { lat: number; lon: number; alt: number }; // GPS is the object form
}

interface DecodeResult {
  readings: Reading[];
  rest: Uint8Array;    // undecoded tail (unknown type id or truncated) — empty when fully decoded
}

function decodeLpp(bytes: Uint8Array): DecodeResult;
```

Rules:
- The payload is a sequence of `[ch][type][data…]`. Big-endian, as in the ElectronicCats CayenneLPP library that MeshCore uses.
- If the type id is unknown or the data is truncated, **stop** and put the remaining bytes in `rest`. Never throw on bad input, because payloads come off the air.
- Treat a run of trailing `0x00` bytes as padding, not as `ch 0 / digital input`. **Verify** in firmware whether replies are padded; guard for it either way.

Types to support (MeshCore's `EnvironmentSensorManager` emits all except the last four):

| Id | Name | Data bytes | Step | Signed |
|---|---|---|---|---|
| 2 | Analog input | 2 | 0.01 | yes |
| 100 | Generic sensor | 4 | 1 | no |
| 103 | Temperature | 2 | 0.1 °C | yes |
| 104 | Humidity | 1 | 0.5 % | no |
| 115 | Barometer | 2 | 0.1 hPa | no |
| 116 | Voltage | 2 | 0.01 V | no |
| 117 | Current | 2 | 0.001 A | no |
| 118 | Frequency | 4 | 1 Hz | no |
| 120 | Percentage | 1 | 1 % | no |
| 121 | Altitude | 2 | 1 m | yes |
| 128 | Power | 2 | 1 W | no |
| 130 | Distance | 4 | 0.001 m | no |
| 136 | GPS | 9 | lat/lon 0.0001° (int24 signed), alt 0.01 m (int24 signed) | yes |
| 0 | Digital input | 1 | 1 | no |
| 101 | Luminosity | 2 | 1 lux | no |
| 125 | Concentration | 2 | 1 ppm | no |
| 142 | Switch | 1 | 1 | no |

Put the table in code as a single type registry (`id → { name, len, decode }`) so the UI can reuse names and units from it.

**Test fixture.** This is the exact payload shown in the mockups: 42 bytes, 9 readings.

```
01 74 01 A9                         ch1 voltage   4.25 V   (battery)
01 88 04 9C 22 F1 15 2A 00 41 C8    ch1 gps       30.2114, -97.7622, 168.40 m
02 67 00 F6                         ch2 temp      24.6 °C
02 68 75                            ch2 humidity  58.5 %
02 73 27 96                         ch2 barometer 1013.4 hPa
02 79 00 A2                         ch2 altitude  162 m
03 74 02 00                         ch3 voltage   5.12 V
03 75 00 B6                         ch3 current   0.182 A
03 80 00 01                         ch3 power     1 W
```

Also test:
- negative temperature (`0xFF38` → −20.0 °C);
- negative longitude (above);
- an unknown type id mid-payload (`rest` holds the tail and earlier readings are kept);
- a truncated final reading;
- trailing zero padding;
- an empty payload.

### 1.2 Reading semantics — shared, pure

`describeReading(reading, channelReadings)` returns the label, icon key, unit and formatted value, and is used everywhere.

- **Ch 1 is always "Self".** On ch 1, voltage (116) is **Battery** and GPS (136) is **GPS**.
- **On ch 2 and up, voltage is "Bus voltage"**, from an INA power monitor.
- **The LPP payload carries no sensor names.** Infer a group label only from the set of readings on a channel, and word it as a match ("field set matches BME280"), never as a fact. Matches to cover:

  | Readings on the channel | Label |
  |---|---|
  | temp + humidity + barometer + altitude | BME280 |
  | the above + generic | BME680 |
  | temp + barometer + altitude | BMP280 / BMP085 |
  | temp + barometer | LPS22HB |
  | temp + humidity | AHT / SHTC3 / SHT4x |
  | voltage + current + power | INA219 / INA226 / INA260 / INA3221 |
  | two temps | MLX90614 |
  | distance | VL53L0X |
  | temp + percentage | RAK12035 |

  Otherwise use "Sensors".
- **Power has 1 W resolution.** When voltage and current are on the same channel, also expose an estimate, ≈ V × I.
- **Distance 0 from a VL53L0X means out of range.** Format it as "out of range", not "0 mm".
- Battery % is an estimate from voltage only. Mark it "est.", and reuse the app's existing helper if there is one.
- Formatting follows the design system: a space before units ("4.25 V", "1013.4 hPa"), "%" attached ("58.5%"), the Unicode minus "−" in display values, and metric first with imperial as the secondary line.

### 1.3 `SavedRequest` model and store — main process

```ts
interface SavedRequest {
  id: string;
  nodeKey: string;            // public key of the node the request went to; my radio's own key for self-telemetry
  source: 'repeater' | 'contact' | 'companion';
  requestedAt: number;        // epoch ms, when the user clicked
  repliedAt: number | null;
  outcome: 'ok' | 'timeout' | 'error';
  error?: string;
  roundTripMs: number | null;
  hops: number | null;        // path length used; null for companion (BLE/USB)
  route: 'direct' | 'flood' | 'local' | null;
  role: 'admin' | 'guest' | null;   // login role at request time (repeaters)
  permsGranted: number | null;      // TELEM_PERM bitmask if known: 0x01 base, 0x02 location, 0x04 environment
  raw: Uint8Array | null;           // LPP payload; null when no reply
}
```

- Persist with SQLite (better-sqlite3), following whatever persistence pattern the repo already has. Index on `(nodeKey, requestedAt DESC)`.
- Retention defaults to **50 per node**, settable in app settings, not radio settings. Insert, then prune the oldest past the limit in the same transaction.
- Store operations:
  - `list(nodeKey)`, newest first;
  - `get(id)`;
  - `delete(id)`;
  - `clear(nodeKey)`;
  - `previousFor(nodeKey, beforeRequestedAt, ch, typeId)`, which returns the reading and its `requestedAt` from the most recent earlier `ok` request containing that `ch + typeId` (decision 5).

  Do the `previousFor` lookup in code over decoded rows; N is small, so a SQL search inside the blob isn't worth it.

### 1.4 Requesting — main process

- **Repeaters and contacts.** Find how the app already sends repeater **status** requests and receives their replies (the Status tab), and mirror that path for the telemetry request type. In firmware this is the telemetry request handled by `SensorManager::querySensors(requester_permissions, …)`, and the reply payload is LPP. Use the existing timeout behaviour; the mockups assume 15 s.
- **My radio.** Read self-telemetry over the companion connection, so no mesh airtime is used. **Verify** the companion command and response codes against the MeshCore companion protocol in the firmware or the JS library before coding. Don't guess codes.
- Exactly one request in flight per node. A second click while one is pending is a no-op, and the UI disables the button.
- Every attempt produces a `SavedRequest`, including timeouts.

### 1.5 API surface

Application logic in this app goes through the main-process HTTP/WebSocket layer, not IPC (IPC is only for Electron chrome), so follow that:

- `POST /telemetry/:nodeKey/request` → `SavedRequest`, when it finishes or fails
- `GET /telemetry/:nodeKey` → `SavedRequest[]` (newest first; include decoded readings)
- `GET /telemetry/request/:id` → `SavedRequest` + decoded readings + per-reading previous (`{ reading, requestedAt } | null`)
- `DELETE /telemetry/request/:id`, `DELETE /telemetry/:nodeKey`
- WebSocket event `telemetry.saved` with the new `SavedRequest`, so the rail and open tabs update.

Adjust names and routes to match existing conventions in the repo.

### 1.6 Companion telemetry policy (read/write) — verify against firmware

My radio exposes three telemetry modes: **Base**, **Location** and **Environment**. Each can be **Deny**, **Per contact** or **Everyone**. Contacts also carry per-contact telemetry permission flags.

Expose get/set for both the modes and the per-contact flags, plus the sensor settings the radio reports (`getNumSettings` / `getSettingName` / `getSettingValue` / `setSettingValue`; MeshCore currently reports `gps` (0/1) and accepts `gps_interval`). These are **radio settings**, not app settings, so keep them in the radio-settings store and UI.

Confirm each field's existence and encoding in the companion protocol first, and leave out any that don't exist yet.

### 1.7 Tests (Vitest)

- `decodeLpp`: the fixture and edge cases in 1.1.
- `describeReading`: ch-1 vs ch-2+ voltage labels, each field-set match, power estimate, distance 0.
- Store: retention pruning; `previousFor` skips timeouts and guest replies that lack the reading, and returns null for a newly added sensor.
- Request flow, with the radio mocked: a success saves `ok` with raw bytes; a timeout saves `timeout` with `raw = null`; a double click makes only one request.

**Part 1 is done when** all of the above is merged with tests passing and no UI changes.

---

## Part 2 — UI (separate task)

Build with existing CoreSense components and Tailwind utilities (`bg-cs-bg-2`, `text-cs-text-muted`, `border-cs-border`, `font-mono tabular-nums`, `KeyValueRow`, `SettingsRow`, Lucide icons). The mockups' `telemetry.css` is a stand-in for those utilities. Map it across; don't ship it.

### Shared components

| Component | Responsibility | Props (sketch) |
|---|---|---|
| `TelemetryPanel` | Request log (left) + selected request (right). The only part aware of the source. | `source`, `nodeKey`, `requests`, `selectedId`, `onSelect`, `onRequest`, `onDelete`, `onCompare` |
| `TelemetryRequestList` | Grouped by day (Today / Yesterday / date). Row: time, relative age, outcome chip, detail line (round trip · hops · role, or failure reason). Selected row = 2px accent left border + accent-soft tint. | `requests`, `selectedId`, `mode: 'select' \| 'compare'` |
| `TelemetryGroup` | One card per LPP channel. Header: `Ch N`, name ("Self", or the field-set label), the match caption, and the permission chip. | `ch`, `readings`, `previous` |
| `TelemetryTile` | Icon + caps label + type id, big mono value + unit, secondary line, optional **"▲ +0.03 V · was 4.22 V at 19:15"** line only when `previous` exists. | `reading`, `previous?: { reading, requestedAt }` |
| `TelemetryRow` | Compact `KeyValueRow`-style line with type icon. Used by the right rail and the compare table. | `reading`, `compact?` |
| `LppInspector` | Collapsed by default. Decoded table (ch, type, name, bytes, value) and byte strip with ch / type / value highlighting. | `raw`, `readings` |

### Screens (see mockups)

- **Repeater › Telemetry tab** (`Main.dc.html`). This is a new tab between Status and ACL.
  - The left column has the **Request telemetry** primary button and the request list. Its footer shows retention and a "Compare…" link.
  - The right side shows the selected request:
    - a header with the full timestamp, then "age · round trip · hops · bytes · readings", plus **Compare with previous** and **Delete**;
    - permission chips ("Granted as admin" ✓ Base ✓ Location ✓ Environment);
    - one `TelemetryGroup` per channel;
    - the collapsed `LppInspector`.
- **Right rail › Telemetry section** on repeater contact cards. It shows the selected or latest saved request's readings as `TelemetryRow`s, a "from HH:MM · age" stamp, a **Request telemetry** button and an "N saved requests" link to the tab.
- **Compare** (`History.dc.html`).
  - The request list switches to checkboxes; failed requests are disabled and can't be compared.
  - A table has readings as rows, grouped by channel, and the chosen requests as columns, newest left.
  - Each column header shows the date/time and the gap from the newer column.
  - Each cell shows its value and its change against the column to its right; "—" means that request had no such reading, and "new" marks a reading's first appearance.
  - **Show changes only** and **Export CSV** buttons.
  - The rail holds stats and the per-node retention setting.
- **My radio › Telemetry** (`Companion.dc.html`).
  - The same groups and tiles, with a **Read telemetry** button and the caption "read over BLE at … · no airtime used".
  - A GPS-off empty state with a link to sensor settings.
  - "Who can read my telemetry": three segmented controls (Deny / Per contact / Everyone).
  - Sensor settings (GPS switch, `gps_interval`).
  - Rail: a per-contact table of Base / Loc / Env flags.

### States (`Components.dc.html`)

- **Loading:** skeleton tiles, "waiting for reply · Ns · timeout at 15 s", button disabled.
- **Guest login:** Base only. "Environment and location are hidden for guests. Log in as admin to see sensors." + **Log in as admin…**
- **No sensors:** battery only. "This node reported no environment sensors."
- **Viewing an older request:** a ⚠ age chip and "Showing the saved request from HH:MM. Request telemetry for current values."
- **Failed:** "Telemetry request failed: timeout", the path context, **Try again** and **Reset to flood**.
- **Empty (no saved requests yet):** "No telemetry yet. Click Request telemetry to ask this repeater." (not drawn in the mockups; follow the house empty-state pattern).

### Copy rules (from the design system)

- Use sentence case for actions and Title Case only for named surfaces (Packet Log).
- Errors read `<Action> failed: <reason>`, and toasts are past-tense fragments with no period ("Telemetry saved").
- Join metadata with "·", and use "…" for anything that opens a dialog.
- Spell British ("neighbours").
- No emoji and no exclamation marks.

---

## Reading the mockups

`mockups/*.dc.html` are Design Component files from the claude.ai design canvas. They won't run standalone (they expect a `support.js` runtime), but they are plain HTML:

- **Markup** is inside `<x-dc>`. `<sc-for list="{{items}}" as="t">` is a loop and `<sc-if value="{{x}}">` is a conditional. `{{t.value}}` holes are filled from the object returned by `renderVals()` in the `<script type="text/x-dc">` block at the bottom of each file. That block holds all the sample data, icon paths and per-row values.
- **Styles** are inline plus `telemetry.css`, which defines the `--cs-*` tokens (dark theme values from the CoreSense design system) and small helper classes (`.tile`, `.card`, `.chip-*`, `.lc` = label-caps, `.meta` = meta-mono, `.seg` = segmented control).
- **Icons** are inline Lucide paths; use `lucide-react` (battery, map-pin, thermometer, droplet, gauge, mountain, zap, plug, power, percent, ruler, cpu, waves, crosshair, send, trash-2).
- `Reference.dc.html` has the sensor-chip → LPP field table and UI gotchas, and `Components.dc.html` has the component sketch and states.

If PNG exports are included alongside (`mockups/*.png`), treat them as the visual source of truth for spacing and hierarchy.
