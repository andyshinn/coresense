# Custom Macros & Variables — Design

- **Date:** 2026-06-21
- **Status:** Approved (pending final spec review)
- **Scope of this effort:** Macro **engine subsystem + tests only**. No UI, no composer/send-path wiring.

## 1. Overview

Add a custom **macro** system to CoreSense. A macro is a user-authored
[LiquidJS](https://liquidjs.com/) template that expands into message text when the
user replies to or composes a message. Templates expose mesh/radio metadata
(signal, paths, positions, identities) as variables and a small set of
domain-specific filters (`distance`, `bearing`, `unit`).

The motivating use case (from the README): *"Quick-reply messages with custom
macros. Allowing you to add strings like paths, hop counts, RSSI, SNR, and other
data that can be extracted from messages to replies easily."*

LiquidJS is chosen for its documented template language, rich built-in filters,
and configurable security/DoS controls.

### What ships in this effort

The macro subsystem: the engine, the typed context model + builders, the custom
filters, the persistent CRUD store, and the public API (`renderMacro`,
`validateTemplate`, `getManifest`), all covered by Vitest tests.

### Explicitly out of scope (future work)

- Authoring UI / variable picker / live-preview panel.
- Wiring macro rendering into the actual message **send path** (the Composer and
  `POST /api/messages/:key`).

The "future UI" consumes this subsystem through the HTTP API and the statically
importable manifest.

## 2. Architecture

A pure, **Node-free engine core** lives in `src/shared/macros/` so the future
renderer UI can import it directly for zero-latency live preview. The
**authority** — the persistent store, the device-state context builder, and the
HTTP API — lives in `src/main/macros/`.

The engine core MUST NOT import Node built-ins or `@andyshinn/meshcore-ts`
(both are main-process only; the renderer cannot load them). LiquidJS is
browser-safe and becomes a regular `dependencies` entry (installed via `pnpm`),
importable from both processes.

### Module layout

```
src/shared/macros/
  types.ts        # MacroTemplate, MacroContext, MacroScope, manifest & error types
  geo.ts          # haversine, initialBearing, compassPoint — pure math, no Liquid
  filters.ts      # distance / bearing / unit — registered onto the engine
  engine.ts       # createMacroEngine({ defaultDistanceUnit, limits }) -> configured Liquid
  manifest.ts     # static VARIABLES[] + FILTERS[] metadata + getManifest()
  validate.ts     # validateTemplate(template) -> structured result (no render)
  render.ts       # renderTemplate(engine, template, context, opts) -> {ok,text}|{ok,error}
  index.ts        # public surface of the core

src/main/macros/
  store.ts            # CRUD over a new macros.json (via settingsStore load/save)
  contextBuilder.ts   # buildReplyContext(...) / buildSendContext(...) from device state
  service.ts          # renderMacro(macroIdOrTemplate, context, opts); builds engine from settings
  # + routes added in src/main/api/routes.ts
  # + emit.macros added in the events bus
  # + WsMessage 'macros' added in src/shared/types.ts
```

The `unit` filter's default (km/mi) is **injected** at engine construction from
`AppSettings.distanceUnit` (a new field, see §7), keeping the core pure. Main
constructs/caches its engine from the current setting and rebuilds when the
setting changes.

## 3. Data model

### 3.1 `MacroTemplate` (persisted, user content)

```ts
interface MacroTemplate {
  id: string;            // generated id
  name: string;          // display name
  template: string;      // LiquidJS source
  scope: 'global' | 'channel' | 'contact';
  channelKey?: string;   // required when scope === 'channel'  (e.g. 'ch:General')
  contactKey?: string;   // required when scope === 'contact'  (e.g. 'c:<pubkeyHex>')
  createdAt: number;     // epoch ms
  updatedAt: number;     // epoch ms
}
```

### 3.2 `MacroContext` (serializable; passed to the engine)

A flat, JSON-serializable object so it crosses the HTTP/WS boundary cleanly and
so LiquidJS only navigates plain structures. Positions are `{ lat, lon }` plain
objects (or `null`) so they feed `distance`/`bearing` directly. Signal/time
values are scalars. `paths` is the single array variable.

Two builder entry points produce one `MacroContext`:

- `buildSendContext(...)` — composing a fresh message (the "always" variables).
- `buildReplyContext(...)` — replying to a received `Message` (all variables).

### 3.3 Manifest types

```ts
type MacroVarAvailability = 'always' | 'reply';

interface MacroVariable {
  name: string;
  description: string;
  type: 'string' | 'number' | 'position' | 'array' | 'boolean';
  example: string;
  available: MacroVarAvailability;
}

interface MacroFilterDoc {
  name: string;
  description: string;
  signature: string;   // e.g. "{{ a | distance: b }}"
  example: string;
}

interface MacroManifest {
  variables: MacroVariable[];
  filters: MacroFilterDoc[];
}
```

### 3.4 Result & error types

```ts
type MacroErrorKind =
  | 'parse'             // template failed to parse
  | 'unknown-filter'    // template references a filter that isn't registered
  | 'unknown-variable'  // template references a variable not in the manifest
  | 'timeout'           // render exceeded renderLimit
  | 'render';           // any other render-time failure

interface MacroError {
  kind: MacroErrorKind;
  message: string;
  name?: string;        // offending variable/filter name when applicable
  line?: number;
  col?: number;
}

type RenderResult = { ok: true; text: string } | { ok: false; error: MacroError };

type ValidateResult = { ok: true } | { ok: false; errors: MacroError[] };
```

## 4. Context model: reply vs. send

### 4.1 Variables — always available (both modes)

| Variable | Source | Notes |
|---|---|---|
| `my_name`, `my_callsign` | `Owner.name` | `my_callsign` aliases `my_name` |
| `my_id` | `Owner.publicKeyShort` | |
| `my_pubkey` | `Owner.publicKeyHex` | |
| `my_pos` | `DeviceIdentity.lat` / `.lon` | `{ lat, lon }` or `null` |
| `my_battery_mv` | `DeviceInfo.batteryMv` | integer mV |
| `my_battery_v` | `DeviceInfo.batteryMv / 1000` | volts (2 dp) |
| `channel` | active channel name | `null` for DMs |
| `peer_name` | target `Contact.name` | see §4.3 population rule |
| `peer_id` | target `Contact.publicKeyHex` | |
| `peer_pos` | `Contact.gpsLat` / `.gpsLon` | `{ lat, lon }` or `null` |
| `peer_last_seen` | `Contact.lastSeenMs` | epoch ms or `null` |
| `peer_rssi` | `Contact.rssi` | last-heard aggregate |
| `peer_snr` | `Contact.snr` | last-heard aggregate |
| `peer_hops` | `Contact.hops` | last-heard aggregate |

### 4.2 Variables — reply only (the received `Message`)

| Variable | Source | Notes |
|---|---|---|
| `message_body` | `Message.body` | |
| `msg_time` | `Message.ts` | epoch ms |
| `received_ago` | now − `Message.ts` | humanized elapsed string |
| `sender_name` | resolved from `Message.fromPublicKeyHex` → Contact | author identity |
| `sender_id` | `Message.fromPublicKeyHex` | undefined for self-sent |
| `sender_pos` | sender Contact `gpsLat`/`gpsLon` | `{ lat, lon }` or `null` |
| `rssi` | `Message.meta.rssi` | *this* message's signal |
| `snr` | `Message.meta.snr` | |
| `hops` | `Message.meta.hops` | |
| `times_heard` | `Message.meta.timesHeard` | distinct flood receptions merged |
| `paths` | `Message.meta.paths[]` | mapped — see §4.4 |

### 4.3 `peer_*` population rule

`peer_*` is "the contact this macro is aimed at," populated in every reply case:

- **Reply (DM or channel):** resolved from the replied-to message's sender
  pubkey, so a quick-reply always has `peer_*` even on a channel.
- **New send, DM:** the recipient contact.
- **New send, channel broadcast:** `null`.

This keeps `peer_*` (durable `Contact` record: last-heard aggregates, position)
distinct from `sender_*`/`rssi`/`snr` (the *specific* incoming message). In a DM
reply they describe the same person sourced differently; on a channel reply
`peer_*` resolves to the message author rather than being null.

### 4.4 `paths` shape (corrected against real data)

Verified against `src/shared/types.ts`. The radio does **not** expose per-node or
per-path RSSI — only `finalSnr` (last hop) per path, plus message-level
`rssi`/`snr`/`hops`. Each `paths` entry is mapped from `MessagePath`:

```ts
// source: MessagePath { id, hops: MessageHop[], hashMode, finalSnr }
//         MessageHop  { kind: 'origin'|'hop'|'sink', shortId, name?, pk?, unnamed? }
interface MacroPath {
  id: string;
  length: number;        // hops.length
  hash_mode: number;     // MessagePath.hashMode
  final_snr: number;     // MessagePath.finalSnr (last hop only)
  hops: Array<{
    kind: 'origin' | 'hop' | 'sink';
    short_id: string;    // MessageHop.shortId
    name: string | null; // MessageHop.name
    pk: string | null;   // MessageHop.pk
  }>;
}
```

Example pipelines (using LiquidJS built-ins):

```liquid
{{ paths | sort: "final_snr" | last | map: "name" | join: " → " }}   {# strongest path's node chain #}
{{ paths | size }} paths heard
```

### 4.5 Data realities (dropped / adjusted from the original idea)

- **Remote-node battery: removed.** `Contact` has no battery field; only the
  local device exposes battery (`my_battery_*`).
- **Per-node / per-path RSSI: not available.** Use `final_snr` per path and
  message-level `rssi`/`snr` instead.
- **Self-state is split across three types** stitched by the context builder:
  `Owner` (name/pubkey), `DeviceIdentity` (lat/lon), `DeviceInfo` (batteryMv).

## 5. Engine configuration + error/placeholder contract

### 5.1 LiquidJS configuration (security-first; per-render overridable via `opts`)

| Option | Value | Rationale |
|---|---|---|
| `ownPropertyOnly` | `true` | Block prototype-chain traversal — path/sender fields are attacker-influenced. |
| `strictVariables` | `true` | Undefined variables throw (used to detect typos — see §5.2). |
| `strictFilters` | `true` | Unknown filters throw, enabling distinct error reporting. |
| `renderLimit` | `1000` (ms) | Macro rendering must be near-instant; cap runaway templates. |
| `parseLimit` | conservative | DoS guard on template size/complexity. |
| `memoryLimit` | conservative | DoS guard on memory growth. |

### 5.2 Placeholder vs. strictVariables contract

Reconciles "strictVariables throws" with "substitute a placeholder, not silent
blanks":

- The render context is wrapped so that **every manifest variable is a known
  key** (value may be `null`). `strictVariables` therefore throws **only for
  genuinely-unknown names** (typos such as `{{ sner }}`) → surfaced as a
  `unknown-variable` error.
- A **known-but-empty** variable (e.g. `rssi` on a message without it, `my_pos`
  with no GPS) renders the configurable **placeholder** (default `?`) — never a
  silent blank, never an error.
- Mechanism: a manifest-aware context wrapper (a `has`-trapping proxy whose
  membership reflects the manifest) plus a placeholder "drop" for known-but-null
  values. Filters are null-tolerant (invalid coords → `null` → placeholder).
- `placeholder` is configurable per render via `opts.placeholder`.

### 5.3 Never throw into the send path

`renderTemplate` (core) and `renderMacro` (main) **always return** a
`RenderResult` and never throw. A timeout returns
`{ ok: false, error: { kind: 'timeout', ... } }`. This honors the requirement
that a failed/timed-out render surfaces a clear error and never throws uncaught
into the radio send path.

## 6. Custom filters

Three filters registered on the engine, backed by pure math in `geo.ts`
(mean Earth radius **6371008.8 m**). All filters are null-tolerant: invalid or
missing coordinates yield `null` (→ placeholder), never a throw.

| Filter | Usage | Returns |
|---|---|---|
| `distance` | `{{ my_pos \| distance: peer_pos }}` | great-circle **meters** (number) |
| `bearing` | `{{ my_pos \| bearing: peer_pos }}` | initial bearing formatted `"247° WSW"` (16-point compass) |
| `unit` | `{{ my_pos \| distance: peer_pos \| unit: 'km' }}` | formatted string; default unit from `AppSettings.distanceUnit`; auto sub-km → m (metric) / sub-mile → ft (imperial) |

`geo.ts` exports pure helpers: `haversineMeters(a, b)`, `initialBearingDeg(a, b)`,
`compassPoint(deg)` (16-point). Array operations over `paths` use LiquidJS
**built-ins** (`first`, `last`, `map`, `join`, `sort`, `size`) — not
reimplemented.

## 7. New setting: `AppSettings.distanceUnit`

`AppSettings` (in `src/shared/types.ts`) gains:

```ts
distanceUnit: 'metric' | 'imperial';  // default: 'metric'
```

`DEFAULT_APP_SETTINGS` is updated accordingly. `'metric'` maps to km (auto sub-km
→ m); `'imperial'` maps to mi (auto sub-mile → ft). The `unit` filter uses this
as its default when no explicit unit argument is given. Existing persistence
(`mergeDefaults`) backfills the field for older config files.

## 8. Public API, store & HTTP

### 8.1 Persistent store (main)

- New file `macros.json` added to the `FILES` map in
  `src/main/storage/settings.ts`, with `settingsStore.loadMacros()` /
  `saveMacros()` following the existing atomic write-through pattern (defaults to
  `[]`).
- `StateHolder` (`src/main/state/holder.ts`) gains `getMacros`, `addMacro`,
  `updateMacro`, `removeMacro`.
- Mutations validate the template via `validateTemplate`; a parse-failing
  template is rejected so a broken macro is never persisted.

### 8.2 Core surface (`src/shared/macros`)

- `createMacroEngine({ defaultDistanceUnit, limits? })` → configured `Liquid`.
- `renderTemplate(engine, template, context, opts?)` → `RenderResult`.
- `validateTemplate(template)` → `ValidateResult` — parses without rendering;
  distinguishes `parse` vs. `unknown-filter` (vs. `unknown-variable`).
- `getManifest()` → `MacroManifest` (static; UI may import directly).

### 8.3 Service surface (`src/main/macros/service.ts`)

- `renderMacro(macroIdOrTemplate, context, opts?)` → `RenderResult`. When given
  an id, the macro is loaded from the store; otherwise the string is treated as a
  raw template. The engine is built from the current `distanceUnit`.
- `buildReplyContext(...)` / `buildSendContext(...)` assemble `MacroContext` from
  `Owner` / `DeviceIdentity` / `DeviceInfo` / `Contact` / `Channel` / `Message`.

### 8.4 HTTP endpoints (`src/main/api/routes.ts`)

| Method & path | Purpose |
|---|---|
| `GET /api/macros` | list macros |
| `POST /api/macros` | create macro |
| `PUT /api/macros/:id` | update macro |
| `DELETE /api/macros/:id` | delete macro |
| `GET /api/macros/manifest` | the manifest |
| `POST /api/macros/validate` | `{ template }` → `ValidateResult` |
| `POST /api/macros/render` | `{ macroId?, template?, mode: 'reply'\|'send', messageId?, contactKey?, channelKey?, placeholder? }` → builds context server-side, renders |

CRUD mutations broadcast the updated list via a new `emit.macros(...)` on the
events bus and a `WsMessage` variant `{ type: 'macros'; payload: MacroTemplate[] }`
(added to `src/shared/types.ts`). A matching renderer client method set is added
to `src/renderer/lib/api.ts` (`getMacros`, `addMacro`, `updateMacro`,
`deleteMacro`, `validateMacro`, `renderMacro`, `getMacroManifest`) for the future
UI; no renderer UI is built in this effort.

## 9. Testing (Vitest)

### Core (`src/shared/macros`)

- **`geo.ts`** — `haversineMeters` against known coordinate pairs (including a
  sub-km case and a near-antipodal case); `initialBearingDeg` for cardinal and
  intercardinal directions; `compassPoint` boundary values.
- **Filters** — `distance` returns meters; `unit` formatting boundaries (sub-km →
  m, km rounding, mi, sub-mile → ft); `bearing` formatting (`"247° WSW"`); all
  three return the placeholder/`null` on missing coords.
- **Render** — scalar interpolation; `paths` pipeline
  (`sort: "final_snr" | last`, `map: "name" | join`); missing-position and
  missing-scalar → placeholder; **unknown variable → error**;
  **prototype-access attempt blocked** by `ownPropertyOnly`; **runaway template
  hits `renderLimit`** → `timeout` error.
- **`validate`** — distinct structured errors for bad syntax (`parse`) vs.
  unknown filter (`unknown-filter`) vs. unknown variable.

### Main (`src/main/macros`)

- **Store** — CRUD round-trip on `macros.json` in a temp dir; rejects a macro
  whose template fails to parse.
- **Context builders** — `buildReplyContext` / `buildSendContext` map real
  `Message` / `Contact` / `Owner` / `DeviceInfo` / `DeviceIdentity` fields
  correctly, including `null` cases and the **reply-on-channel → `peer_*` from
  sender** rule.

## 10. Integration points (reference)

| Concern | File |
|---|---|
| Shared types (`Message`, `MessagePath`, `MessageHop`, `Contact`, `Channel`, `Owner`, `DeviceIdentity`, `DeviceInfo`, `AppSettings`, `WsMessage`) | `src/shared/types.ts` |
| Settings persistence / `FILES` map / `settingsStore` | `src/main/storage/settings.ts` |
| In-memory state holder | `src/main/state/holder.ts` |
| HTTP routes (existing settings/blocks CRUD as the pattern) | `src/main/api/routes.ts` |
| Events bus / `emit` | `src/main/events/bus.ts` |
| Renderer API client | `src/renderer/lib/api.ts` |
| LiquidJS dependency | `package.json` (add `liquidjs`) |

## 11. Open questions / future work

- Authoring UI, variable picker, live preview, and character-count surfacing
  (messages cap ~132 chars).
- Wiring `renderMacro` into the Composer / `POST /api/messages/:key` send path.
- Possible scope-aware macro listing (filter by active channel/contact) for the
  UI — the data (`scope`, `channelKey`, `contactKey`) is stored now.
