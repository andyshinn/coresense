# Packet Log Inspector — Design Spec

**Date:** 2026-07-10
**Branch:** `worktree-feat+packet-log-inspector`
**Design source:** `docs/design/handoff-extracted/.../design_handoff_packet_log/` (Claude Design handoff, "Packet Log — byte-level packet inspector")

## 1. Overview

Revamp the **Packet Log** from a single-line raw stream into a two-part **byte-level inspector**:

- a **flat live packet list** (main pane) with real columns, a route badge, and a source filter, and
- a **right-rail byte-level breakdown** that appears when a packet is selected — the same select→inspect pattern the channel/DM message pane already uses.

Plus a **standalone packet decoder** (paste any raw packet → decode) surfaced as a command-palette dialog and an in-rail "Bring Your Own Packet" (BYON) panel.

The breakdown is adapted from the letsmesh packet analyzer, narrowed to what a **single client on one radio** actually knows (RSSI/SNR of this reception, route, hops/path, size, received-at, radio preset) rather than network-wide aggregates.

## 2. Goals / non-goals

### In scope
- New columned live list: `TIME · TYPE · DETAILS · RSSI/SNR · HOP`, route badge (D/F/B), `[Both][RF][BLE]` source segmented control, free-text filter, live dot, `shown / total` count, row selection.
- Right-rail detail: DETAILS card → PACKET HASH (copy) → Packet Byte Breakdown → `{Type}` Payload Byte Breakdown → Decrypted Plaintext / Advert App-Data / lock note. BLE frames get a BLE Frame Breakdown. Empty state with a "Decode hex…" button.
- Byte strip + field cards + collapsible bit tables with **bidirectional, strip-scoped hover**.
- **Live decrypt of channel packets** (GroupText/GroupData) using held `channel.secretHex`; DMs degrade to a lock note.
- **Standalone decoder**: command-palette dialog + in-rail BYON panel; input **auto-detects hex / base64 / `meshcore://`**.
- **Packet persistence across reload** via a SQLite `packets` table; hydrate recent history into the live view on connect.
- **Light + dark theme** support (derive light-mode variants of the field/route/BLE colors).

### Out of scope (this pass)
- **"Trace path" action** — the button renders **disabled** ("coming soon"); no active MeshCore trace / path-viewer wiring.
- **DM/direct-message decryption** — our node's private key isn't in the renderer, so Request/Response/TextMessage/AnonRequest show the lock note.
- **Serial-transport packets** — `serial.ts` still doesn't `emit.packet`; only BLE + replay feed the log (pre-existing limitation, unchanged).
- **"Load older" pagination** into persisted history beyond the hydrated working set — retained on disk for future export, not surfaced now.
- Sortable/resizable columns.

## 3. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Standalone decoder input format | **Auto-detect** hex / base64 / `meshcore://` |
| Standalone decoder surface | **Command-palette dialog + in-rail BYON** (no new left-nav item) |
| Theme | **Both light & dark** |
| Live decrypt (channel packets) | **In scope** |
| Persist packets across reload | **In scope** |
| Wire "Trace path" | **Deferred** — render disabled |

## 4. Architecture

**Decode happens in the renderer**, on demand, via a pure adapter that wraps `@michaelhart/meshcore-decoder`'s `analyzeStructure(hex, opts)`. That decoder is renderer-safe (its package.json sets `browser: { crypto:false, fs:false }`), already a dependency, and — critically — the **only** available decoder that exposes per-field byte offsets (`startByte`/`endByte`) and a per-bit header breakdown. `@andyshinn/meshcore-ts` (main-only, Node-only) exposes neither byte offsets nor on-air decryption, so it is **not** used for the inspector.

Rationale for renderer-side decode:
- Byte offsets come straight out of `analyzeStructure` — no custom mapping of raw values to positions.
- The **same adapter** serves live packets, the in-rail BYON panel, and the standalone dialog (one code path, no duplication).
- Decode stays off the wire (WS payloads keep shipping raw `RawPacket`).
- Decryption uses `channel.secretHex`, which is already in the renderer store.
- The adapter is a set of pure functions — unit-testable against golden fixtures.

The one thing `meshcore-decoder` does **not** cover is BLE/serial **companion frames**; those get a small renderer-side layout table keyed by `codeName` (see §6.4), mirroring the handoff's `BLE_FRAMES` and matching its explicit "frame codes are firmware-version-specific" caveat.

```
radio ──BLE/replay──▶ main: emit.packet(RawPacket)
                         ├─▶ storage/packets.ts  (INSERT + prune)      [persist]
                         └─▶ server.ts WS broadcast {type:'packet'}     [live]
renderer connect ──GET /api/packets?limit=N──▶ hydrate store.packets     [reload survival]
renderer live  ──ws 'packet'──▶ store.applyPacket (ring buffer, cap 2000)
select row / paste ──▶ lib/packetInspect.ts (analyzeStructure + keyStore) ──▶ view-model
                         └─▶ ByteStrip / FieldCard / BitTable (pure)
```

## 5. Data model & persistence

### 5.1 `RawPacket` (unchanged shape) — `src/shared/types.ts:12-30`
Already carries `timestamp, transportType, kind, hex, bytes, payloadHex, payloadBytes, snr?, rssi?, code?, codeName?`. No new fields required for the list/detail; everything else is derived by the decode adapter (hash, path, field offsets) or read from existing store state (radio preset).

### 5.2 SQLite `packets` table — `src/main/storage/db.ts` (+ new `src/main/storage/packets.ts`)
`db.ts` already opens `messages.db` and creates `messages` + `discovered_contacts`. Add a `packets` table:

```sql
CREATE TABLE IF NOT EXISTS packets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,          -- RawPacket.timestamp (epoch ms)
  transport    TEXT    NOT NULL,          -- 'ble' | 'serial'
  kind         TEXT    NOT NULL,          -- 'mesh' | 'companion'
  hex          TEXT    NOT NULL,          -- verbatim transport frame
  payload_hex  TEXT    NOT NULL,          -- mesh packet / companion body
  snr          REAL,                      -- nullable
  rssi         REAL,                      -- nullable
  code         INTEGER,                   -- companion frame code, nullable
  code_name    TEXT                       -- nullable
);
CREATE INDEX IF NOT EXISTS idx_packets_ts ON packets(ts);
```

New `storage/packets.ts` exposes `insertPacket(p)`, `recentPackets(limit)` (most-recent, returned ascending by `ts`), `prunePackets(keep)`, `clearPackets()`. `bytes`/`payloadBytes` are re-derived from hex on read (not stored twice).

### 5.3 Retention & hydration (tunable constants, called out for review)
- **Persist cap:** keep the newest **20,000** packets; prune on insert (batched, e.g. every 200 inserts delete `WHERE id <= max_id - 20000`).
- **Hydrate-on-connect:** renderer fetches the newest **1,000** via a new `GET /api/packets?limit=1000` and seeds `store.packets`.
- **In-memory working cap:** raise `MAX_PACKETS` **500 → 2,000** (`store.ts:59`); live WS packets append and slice to the cap as today.
- **Toolbar `total`** = current in-memory working-set size (`packets.length`); **`shown`** = after source + text filter. History beyond the working set is retained on disk but not shown (future "load older" / export).

Wiring:
- `src/main/transport/ble.ts` (and `replay.ts`) already call `emit.packet`; the bus subscriber that persists lives next to the WS broadcast subscription (`src/main/server.ts:190,231`) — one `bus.on('packet', insertPacket)` registration in the storage init path. (No change to capture sites.)
- New route in `src/main/api/routes.ts`: `GET /api/packets?limit=` → `recentPackets(limit)`.
- `clearPackets()` store action already exists (`store.ts:917`) + a "Clear packet log" palette action (`actions.ts:275`); extend it to also call the main `clearPackets()` via a new endpoint/message so persisted rows clear too.

### 5.4 Store changes — `src/renderer/lib/store.ts`
- Add `selectedPacketId: string | null` + `setSelectedPacket(id)` mirroring `selectedMessageId`/`setSelectedMessage` (`store.ts:309,838`); clear it in `navStateUpdate` (`store.ts:479`) exactly like `selectedMessageId`.
  - **Packet identity:** live `RawPacket` has no id. The **renderer** assigns one monotonic client id (`pktSeq++`) to **every** packet as it enters `store.packets` — both live-appended and hydrated — so list keys and selection never collide regardless of source. The SQLite `id` stays server-side only.
- Extend `ui.packetLogFilter` (`shared/types.ts:776`) from `{ showCompanion }` to `{ source: 'both'|'rf'|'ble' }` (migrate the boolean; default `'both'`). Keep it in persisted `UiState`.
- Standalone decoder dialog open/close state: `ui.decoderOpen: boolean` + toggle (session-only or persisted-closed).

## 6. Decode adapter — `src/renderer/lib/packetInspect.ts` (the riskiest piece; built test-first)

Pure module, no React. Public surface mirrors the handoff's documented "swap point" so the UI is decoder-agnostic:

```ts
inspectPacket(hex: string, opts: { keyStore?, radio?, receivedAt? }): PacketInspection
inspectBleFrame(hex: string, codeName?: string): BleInspection
detectAndDecode(input: string, kind: 'rf'|'ble'): PacketInspection | BleInspection  // auto-detect hex/base64/meshcore://
```

`PacketInspection` view-model (consumed by the rail + dialog + rows):

```ts
{
  size, bytes: number[], routeName, payloadTypeName, version, hashFull, hops, pathArrows?,
  fields:  Field[],                              // packet-level (header, path-len, path, payload)
  payload: null | {
    typeName, bytes: number[],
    fields: Field[],                             // payload-relative offsets
    secondary: null
      | { kind:'decrypted'; available:true; bytes, fields }
      | { kind:'appdata';   available:true; title, bytes, fields }
      | { kind:'encrypted'; available:false; note }   // lock note
  },
  lowConfidence?: { reason: string }             // e.g. 0x84 raw-push
}
type Field = { key, name, start, end, colorIdx, value, desc, bits?: BitRow[] }
type BitRow = { range, field, value, binary }
```

### 6.1 Mapping `analyzeStructure` → view-model
- Packet-level `PacketStructure.segments[]` → `fields[]` (`name`, `startByte`→`start`, `endByte`→`end`, `value`). `colorIdx` assigned by field index into the 7-color palette.
- Header segment's `headerBreakdown.fields[] {bits,field,value,binary}` → the Header card's `bits[]` table.
- **Path-length bit table** is computed locally (`hopCount = pl & 0x3f`, `hashSize = (pl>>6)&0x3`) — `analyzeStructure` only guarantees the header's bit breakdown.
- `PacketStructure.payload.segments[]` → `payload.fields[]` (offsets are payload-relative; normalize against `payload.startByte`).

### 6.2 Decryption (channel only)
- Build a `MeshCoreKeyStore` from `store.channels[].secretHex` (`createKeyStore({ channelSecrets })`), pass via `analyzeStructure(hex, { keyStore, attemptDecryption:true, includeRawCiphertext:true })`.
- On success (GroupText/GroupData), reconstruct the **decrypted plaintext byte strip** from decoded fields — `timestamp(4 LE) · flags(1) · text(UTF-8)` — since the decoder returns decoded values, not a positioned plaintext buffer. Fields: Timestamp / Flags / Message.
- No key match (or a DM type) → `secondary = { kind:'encrypted', available:false, note }`, with the note chosen per the handoff ("No key for this channel…" vs "…isn't addressed to us…").

### 6.3 Advert
- Advert app-data → `secondary = { kind:'appdata', title:'Advert App-Data', fields:[Flags, (Latitude, Longitude)?, Node Name] }`, offsets from the advert payload segments / `AdvertPayload.appData`.

### 6.4 BLE / companion frames — `src/renderer/lib/bleFrameLayouts.ts`
`meshcore-decoder` has no companion-frame support. A renderer-side table keyed by `codeName` (from `RawPacket.codeName`, produced by main's `companionFrame.ts`) gives each frame's field layout (`{key,name,len|'rest',color,desc}`), and `inspectBleFrame` walks it with a cursor to assign byte offsets — same algorithm as the handoff's `decodeBleFrame`. Seed with the handoff's four (`CHANNEL_MSG_RECV`, `CONTACT_MSG_RECV`, `SEND_CHANNEL_TXT_MSG`, `ADVERT`); unknown codes fall back to a single "Body" field. **Explicitly noted as firmware-version-specific**; reconcile against `companionFrame.ts`'s `PUSH_NAMES`/`RESP_NAMES`.

### 6.5 Correctness guards
- Decode the **mesh packet bytes** (`payloadHex`), not the raw transport frame.
- `0x84` raw-push frames write `0xFF` where `path_len` belongs (`companionFrame.ts:69-73`); when the source is a raw push, set `lowConfidence` and show an inline caution in the rail so a mis-parse isn't read as truth.
- `analyzeStructure` "never throws" on bad input, but the adapter still guards empty/odd-length hex and surfaces an invalid state (used by the dialog + empty rows).

### 6.6 Golden fixtures
The handoff's `pl-data.js` builds sample hex from **real field lengths** (one packet per payload type + BLE frames). Port those hex strings into `tests/unit/fixtures/packets.ts` and assert exact field **names + byte ranges** from `inspectPacket`, so the adapter's offsets are pinned regardless of decoder internals.

## 7. Theming & tokens

`--cs-*` tokens already match the handoff (`index.css:17-41`, light via `theme.ts` DARK/LIGHT `:52-84`). Add theme-aware, RGB-triplet tokens for the inspector's non-neutral colors so they flip with the app theme:

- `--cs-field-0 … --cs-field-6` (amber, blue, lime, coral, teal, violet, gold) — dark values from the handoff palette; **light values derived** to hold contrast on the light surfaces.
- `--cs-route-direct` (green), `--cs-route-flood` (blue), `--cs-ble` (violet) — dark from handoff; light variants derived.

Registered in the `@theme` block (`index.css:46-84`) as `--color-cs-field-0`, etc., and set in both `DARK`/`LIGHT` maps in `theme.ts`. Byte-strip tint/hover math uses Tailwind alpha (`bg-cs-field-3/15`) and `color-mix` (or `rgb(var(--cs-field-3) / <a>)`) instead of the prototype's `PLwithAlpha`. Field color by index: `colorIdx → var(--cs-field-<idx % 7>)`.

## 8. Components

Modular, each with one job (mirrors existing `src/renderer/components/ui/` + rail conventions):

### 8.1 List pane — rewrite `src/renderer/components/PacketLog.tsx`
Keep `react-virtuoso` (auto-follow tail) + the `PacketLogHost` lazy wrapper (`AppHosts.tsx:12`) and mount (`MainPane.tsx:69`). Add:
- **Toolbar:** live dot + `RAW PACKETS`; free-text filter (`type/details/hash/hex`); `[Both][RF][BLE]` segmented control (`ui.packetLogFilter.source`, replacing the checkbox); `shown / total`.
- **Column header + grid rows:** `TIME(no ms) · TYPE(badge D/F/B + name) · DETAILS · RSSI/SNR(strength-colored) · HOP`. Badge: `D`=`route-direct`, `F`=`route-flood`, `B`(companion)=`ble`. RSSI color: `>-80` online, `>-96` muted, else warn.
- **Selection:** row click toggles `selectedPacketId` and opens the right rail (mirror `ChannelView.tsx:124-140`); selected row gets `border-l-2 border-cs-accent bg-cs-accent-soft/15` (mirror `MessageItem.tsx:67-75`). Rows carry `data-testid="packet-row"`.
- Per-row summary uses the existing cheap `summarizePacket()` (`lib/decodePacket.ts`); the full byte breakdown is computed only for the selected/pasted packet.

### 8.2 Byte-level primitives (pure) — `src/renderer/components/packet/`
- `ByteStrip.tsx` — rounded hex byte-pairs; per-field colored runs (rounded ends, gap between fields); bidirectional hover via `hovered`/`setHovered`; ids **scoped** by strip (`packet:` / `payload:` / `plain:` / `appdata:` / `ble:`); non-hovered fields dim to ~55%.
- `FieldCard.tsx` — color left rail, title (field color), byte range, mono value box (wraps/scrolls), optional collapsible `BitTable`, description. Hover couples to the strip.
- `BitTable.tsx` — `BITS · FIELD · VALUE · BIN`, default expanded, chevron toggle; binary column tinted in field color. (Header & Path-Length only.)

### 8.3 Detail rail — fill `src/renderer/shell/rightrail/sectionsFor.tsx:238-252`
Replace the two `packetlog` placeholders. When `selectedPacketId` resolves to a packet, render the detail body (built from `KeyValueRow` + the byte primitives) in this order:
1. **DETAILS card** — Type · Route (tag) · RSSI/SNR · Hops (+`· direct`) · Path (`69 → 29 → …`, when present) · Size · Received (full ts w/ ms from `timestamp`) · Radio (`freq · SF/BW/CR` from `store.radioSettings` — confirmed present at `store.ts:255`; this is the radio's **current** config, the honest single-client approximation of the reception preset).
2. **PACKET HASH** — `hashFull` (from `analyzeStructure.messageHash`), click-to-copy (`CopyButton`), and a **disabled** "Trace path" button.
3. **Packet Byte Breakdown** — `ByteStrip` + stacked `FieldCard`s (scope `packet:`).
4. **`{Type}` Payload Byte Breakdown** — payload strip + cards (scope `payload:`), when a payload exists.
5. **Secondary** — Decrypted Plaintext (scope `plain:`, "key held" chip) / Advert App-Data (scope `appdata:`) / lock note.
- **BLE frames** → a single **BLE Frame Breakdown** (DETAILS with Frame/Direction/Transport/Size/Received, then strip+cards scope `ble:`).
- **Empty state** (nothing selected) → prompt + "Decode hex…" button that opens the decoder.
- Collapse/expand is the existing rail behavior (`rightrail/index.tsx`); the rail header hex icon opens the in-rail BYON panel.
- **Deselect-on-outside-click:** rows use `data-testid="packet-row"`; extend `KEEP_SELECTION_SELECTORS` in `useDeselectOnOutsideClick.ts` to keep selection when clicking a packet row or the rail. Clears `selectedPacketId`.

### 8.4 Standalone decoder — `src/renderer/components/packet/PacketDecoderDialog.tsx` + in-rail BYON
- shadcn `Dialog` (`components/ui/dialog.tsx`) launched from a **command-palette action** ("Decode packet…") in `features/command-palette/items/`. Body = the BYON form + inline breakdown.
- **In-rail BYON** panel (`ByonPanel.tsx`) opened by the rail-header hex icon and the empty-state button.
- Both: textarea (auto-detect hex/base64/`meshcore://` via `detectAndDecode`, reusing `lib/meshcoreUri.ts` for the URI case), RF/BLE toggle, live byte counter, Decode → renders the same `ByteStrip`/`FieldCard` output. A pasted packet has no RSSI/SNR/radio, so the DETAILS card shows only derivable fields.
- Icons (lucide): `Binary`/`Braces` (hex/decode), `Copy`, `Lock`/`Unlock`, `ChevronRight`/`ChevronDown`, `PanelRightClose`, `Route`, `X`, `Info`.

## 9. Testing

- **Adapter offsets (unit, `tests/unit/`):** `inspectPacket`/`inspectBleFrame` against the ported `pl-data.js` fixtures — assert field names + exact `start`/`end` per payload type, header/path-len bit tables, channel-decrypt path (with a fixture secret) vs lock note, advert app-data, and the `0x84` low-confidence flag.
- **`sectionsFor` packetlog branch (dom, no render):** mirrors `tests/component/rail-sections-channel.test.tsx` — assert section ids/order with and without a selected packet.
- **Selection render (dom):** mount list + rail, drive `useStore.getState().setSelectedPacket(...)`, assert the breakdown renders and the row shows selected styling; reuse the **`flushSync` harness trick** from `tests/component/deselect-on-outside-click.test.tsx` for the chevron/hex-icon swaps and `composedPath()` deselect semantics.
- **Persistence (integration/unit):** `insertPacket`/`recentPackets`/`prunePackets` round-trip + cap enforcement against an in-memory SQLite db.
- **Store migration (unit):** `packetLogFilter` boolean→`source` migration; `selectedPacketId` cleared on nav.

Commands: `pnpm test:unit`, `pnpm test:dom`, focused: `pnpm exec vitest run --project dom <file>`.

## 10. File map

**New**
- `src/renderer/lib/packetInspect.ts` — decode adapter (view-model).
- `src/renderer/lib/bleFrameLayouts.ts` — companion-frame byte layouts.
- `src/renderer/components/packet/ByteStrip.tsx`, `FieldCard.tsx`, `BitTable.tsx`, `PacketDetail.tsx` (rail body), `ByonPanel.tsx`, `PacketDecoderDialog.tsx`.
- `src/main/storage/packets.ts` — table CRUD + prune.
- `tests/unit/fixtures/packets.ts`, `tests/unit/packetInspect.test.ts`, `tests/unit/storagePackets.test.ts`, `tests/component/packet-log-select.test.tsx`, `tests/component/rail-sections-packetlog.test.tsx`.

**Changed**
- `src/renderer/components/PacketLog.tsx` — rewrite (columns, badge, source control, selection).
- `src/renderer/shell/rightrail/sectionsFor.tsx` — fill packetlog sections.
- `src/renderer/shell/useDeselectOnOutsideClick.ts` — keep-selection selectors.
- `src/renderer/lib/store.ts` — `selectedPacketId`/`setSelectedPacket`, `MAX_PACKETS`→2000, filter migration, hydrate action, packet id assignment, decoder-dialog state, `clearPackets` extension.
- `src/shared/types.ts` — `packetLogFilter.source`, `ui.decoderOpen`, WS/route types for hydrate + clear.
- `src/renderer/index.css` + `src/renderer/lib/theme.ts` — field/route/ble tokens (light + dark).
- `src/main/storage/db.ts` — create `packets` table.
- `src/main/server.ts` — persist subscription.
- `src/main/api/routes.ts` — `GET /api/packets`, clear endpoint.
- `src/renderer/app/wsHandlers.ts` — unchanged live path; hydrate on connect.
- `src/renderer/features/command-palette/items/*` — "Decode packet…" action; keep/extend "Clear packet log".

## 11. Risks & mitigations

- **Adapter/decoder field-semantics mismatch** (michaelhart vs firmware/letsmesh interpretation). → Golden fixtures pin offsets; low-confidence flag on ambiguous raw pushes; bit-table math computed locally where the decoder is silent.
- **Channel decrypt not lighting up** if a channel's `secretHex` is absent (public/hashtag channels). → Graceful lock note; only private channels with a secret decrypt.
- **Light-theme field colors** losing contrast. → Derive and eyeball against both surfaces; treat as a small bounded palette task.
- **Persistence growth** — bounded by the 20k prune; index on `ts`.
- **Packet identity** for selection across live+hydrated sets — one renderer-assigned monotonic id scheme for all packets (§5.4); DB id never leaks into selection, so hydrate/live can't collide.

## 12. Verification (before "done")
Drive the real app (per project `verify`/`run` skills): package + Playwright/Electron with `FAKE_TRANSPORT`/replay, confirm live rows render with badges, selecting a row opens the byte breakdown with working bidirectional hover, channel packets show decrypted plaintext, a DM shows the lock note, the command-palette decoder decodes a pasted hex **and** base64 packet, and packets survive a reload. Screenshot in both light and dark.
