# Contact Management — Design Spec

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Branch:** `worktree-contact-manager`

## Summary

Build a Contact Management feature for CoreSense (Electron + React desktop client for
MeshCore) as two integrated surfaces:

1. A **main-pane Contact Manager** — a dense, filterable table for curating which
   discovered nodes are committed to the radio's limited contact store.
2. A **rich right-pane contact detail** — shown whenever a contact is focused anywhere
   in the app (Manager row, sidebar, @mention), mirroring the official MeshCore app's
   contact page, with a "Heard Via" path inspector embedded.

The feature is delivered in **3 phases** under **one cohesive design** (this doc):
backend foundation → main-pane Manager → right-pane detail.

Design source material: the Claude Design handoff bundle ("MeshCore Desktop Application",
`Contact Manager.html` + `cm-*.jsx`) and the official-app contact-page screenshots.
Firmware truth verified against the real source at
`/Users/andy/GitHub/meshcore-dev/MeshCore/` (`examples/companion_radio`,
`src/helpers/BaseChatMesh`, `src/helpers/ContactInfo`).

## Goals

- Distinguish **discovered** nodes (heard via advert) from **on-radio** contacts
  (committed to the device's store), and let the user curate between them.
- Surface radio **capacity** and protect favourites from eviction.
- Provide a rich per-contact detail view with the same information/actions as the
  official app, reusing existing screens (`RepeaterAdmin`, DMView, Map) rather than
  rebuilding them.
- Keep the sidebar/@mentions/map focused on **on-radio** contacts only.

## Non-Goals (v1)

- Rebuilding telemetry / ACL / remote-console UIs — these deep-link into the existing
  `RepeaterAdmin` tabs.
- A standalone block-rules editor screen (reuse the existing client-side blocking
  subsystem; "Add block rule" is an entry point).
- Sensor reading visualization beyond what `RepeaterAdmin`/telemetry already offers.
- Data migration from the current persisted contacts (app is early dev; losing the
  current contact cache on first run is acceptable for simpler code).

## Firmware reality (the constraints that shape this design)

Verified in `examples/companion_radio/MyMesh.cpp` and `src/helpers/BaseChatMesh.cpp`:

- **`PUSH_CODE_NEW_ADVERT` (0x8A)** is emitted for **every** heard advert that parses and
  has a name — including nodes the radio does **not** auto-store — carrying the full
  contact record (pubkey, type, flags, out_path, name, last_advert_timestamp, gps,
  lastmod). A stored contact merely re-advertising instead emits the lighter
  `PUSH_CODE_ADVERT` (0x80, pubkey only). **The opcode alone does not tell us whether the
  firmware stored the node** — reconcile against `GET_CONTACTS`.
- **Auto-add is a firmware setting.** `manual_add_contacts` bit gates a per-kind bitmask
  `autoadd_config` (chat 0x02 / repeater 0x04 / room 0x08 / sensor 0x10) plus
  overwrite-oldest (0x01) and a `autoadd_max_hops` cap. Default (zeroed prefs) =
  **auto-add everything, overwrite-oldest off.** Commands: `CMD_SET_AUTOADD_CONFIG`
  (dec 58 / 0x3a), `CMD_GET_AUTOADD_CONFIG` (dec 59 / 0x3b → `RESP_CODE_AUTOADD_CONFIG`
  25). When a kind is not auto-added, the advert is still pushed (0x8A) but not stored.
- **Add a contact:** `CMD_ADD_UPDATE_CONTACT` (9) inserts a brand-new contact (or updates
  an existing one). Store-full → `ERR_CODE_TABLE_FULL` unless overwrite-oldest is on.
  Optional trailing fields (gps lat/lon, then lastmod) are **all-or-nothing** — sending
  only GPS makes the firmware misparse the next field (firmware issue #427).
- **Remove a contact:** `CMD_REMOVE_CONTACT` (dec 15) → OK frame. Firmware-initiated
  eviction (overwrite-oldest) instead emits `PUSH_CODE_CONTACT_DELETED` (0x8F).
  `PUSH_CODE_CONTACTS_FULL` (0x90) signals the store is full.
- **Favourite = contact flags bit 0.** Protects a contact from overwrite-oldest eviction
  ("oldest" = smallest `lastmod`, bumped on every advert/message).
- **Capacity (`MAX_CONTACTS`)** is per-board (350 typical on flash-rich boards, 160/100
  on others) — **read from the device**: `DEVICE_INFO` byte 2 carries `MAX_CONTACTS / 2`
  (double it). Current count = the 4-byte total in `CONTACTS_START` (first reply to
  `GET_CONTACTS`). No dedicated free-slots query.
- **Export/Import:** `CMD_EXPORT_CONTACT` (dec 17 → `RESP_EXPORT_CONTACT` 11) returns the
  verbatim raw advert packet; `CMD_IMPORT_CONTACT` (dec 18) injects a raw advert packet
  back through the normal RX path — so an import **obeys the same auto-add rules** (it
  only sticks if its kind is auto-added, else it just appears as a discovered advert).
- **No first-heard timestamp** on the device — only `last_advert_timestamp` (their clock)
  and `lastmod` (our clock), both overwritten each advert. **First-heard must be tracked
  app-side.**

## Architecture & data model (Phase 1 foundation)

### Storage

A new **SQLite-backed discovered-contacts store**, keyed by `publicKeyHex` (mirrors the
existing messages DB pattern using `node:sqlite`). It holds **every node we've ever
heard** — on-radio or not — with an app-tracked `firstHeardMs`. This replaces today's
behavior of upserting every advert into the settings.json contact list.

No migration: on first run the store rebuilds from the `GET_CONTACTS` sync and incoming
adverts.

### The two sets and reconciliation

- **On-radio set** — authoritative, from the device's `GET_CONTACTS` sync (initial + a
  re-sync after mutations). Carries full fields.
- **Discovered pool** — the whole SQLite store. A contact's `onRadio` flag = membership
  in the latest `GET_CONTACTS` result.
- **On `0x8A`:** upsert into the store (refresh name/gps/path/last-advert; stamp
  `firstHeardMs` if new). If the pubkey is in the on-radio set → update the live contact
  and re-broadcast. If not → discovered-only. Because `0x8A` is ambiguous about storage,
  trust `GET_CONTACTS` as truth and trigger a debounced re-sync when the auto-add config
  implies the node should have been stored (kind auto-added, within hop cap, store not
  full).
- **On `0x8F`:** mark `onRadio: false`. **On `0x90`:** capacity-full warning.

### Feeds and operations

- The existing `type: 'contacts'` WS feed (sidebar, @mentions, map) becomes
  **on-radio-only**.
- A **new feed** (e.g. `type: 'discovered'`) provides the Manager with the full pool plus
  `onRadio` / `blocked` / `favourite` status per row.
- New main→device operations (IPC/API + protocol encode/decode):
  - **Add to radio** → `ADD_UPDATE_CONTACT` (9) from the stored record; re-sync to confirm.
  - **Remove from radio** → `REMOVE_CONTACT` (15); the node stays in the discovered pool
    with `onRadio: false`.
  - **Favourite** → device contact flags **bit 0** via `ADD_UPDATE_CONTACT` for on-radio
    contacts (read-modify-write to preserve other flag bits); app-persisted for
    discovered-only contacts until added.
  - **Auto-add config** → `GET/SET_AUTOADD_CONFIG` (per-kind + overwrite-oldest + max-hops).
  - **Capacity** → `maxContacts` from `DEVICE_INFO` (×2) + live on-radio count.
  - **Export/Import** → cmds 17/18 (lowest priority within Phase 1).
  - **Clear discovered list** → clears the app-side store (keeps on-radio contacts).
  - **Block rules** → reuse existing client-side blocking subsystem.

### Pinned vs Favourite (two orthogonal concepts — both kept)

- **Pinned (pin-to-top)** — app-only UI organization (pin a contact/channel to the top of
  the nav/lists). Unchanged: the existing `pinned` field, context-menu Pin/Unpin, and
  drag-reorder all stay.
- **Favourite (★)** — a **new** field mapping to the firmware's contact flag bit 0; its
  only job is to protect the contact from overwrite-oldest eviction. Synced to the device
  flag for on-radio contacts, app-tracked for discovered-only.

These are independent toggles; a contact can be pinned, favourited, both, or neither.

## Main-pane Contact Manager (Phase 2)

Replaces the `tool:contacts` placeholder in `MainPane`. Reuses the Field Console CSS
tokens (`--cs-*`), plus a few new tokens for path/status colors (origin/sink/hop,
online/warn/danger).

- **Header:** "Contacts" title + subtitle, right-aligned **capacity meter**
  (`onRadio / maxContacts` from device, progress bar turning warn ≥90%, "overwrite
  oldest" chip reflecting the live auto-add setting).
- **Toolbar (two rows):**
  - Search (matches name OR public key) + **state segments** All / On Radio / Discovered /
    Blocked (with live counts).
  - **Type** filter (User/Repeater/Room/Sensor), **Last-heard** filter (Any / hour / 24h /
    7d), **Favourites-only ★** toggle, **Sort** (Last heard / First heard / Name / Type /
    Hops / Key), and a small **view** menu (table↔list, compact↔comfortable). Defaults:
    **compact table, public keys shown**.
  - A **select-all-filtered** bar below the toolbar.
- **List (compact table, keys shown):** columns — checkbox · type glyph · **Name** (+ ★ if
  favourite; pubkey beneath, toggleable; strikethrough if blocked) · **Type** · **Hops** ·
  **First heard** · **Last heard** · **Status** pill (On Radio / Discovered / Blocked) ·
  hover row-actions (Add↔Remove from radio, Block/Unblock). Row **click = focus** (drives
  the right pane); **checkbox = select** (drives bulk actions). List layout = avatar +
  stacked meta variant. Blocked rows dimmed.
- **App RightRail is contextual for the Manager — three modes:**
  1. **Rows selected** → **Bulk actions**: Add to radio · Remove · Favourite · Block.
  2. **One contact focused (no selection)** → the **rich contact detail** (Phase 3) with
     the Heard-Via inspector embedded.
  3. **Nothing focused/selected** → **List actions**: capacity summary, Add-all-filtered /
     Remove-all-filtered, **Prune older than** 7d/1mo/3mo/6mo (removes non-favourite
     on-radio contacts via `REMOVE_CONTACT`), **Auto-Add settings**, **Import/Export**,
     **Clear discovered list**, **Add block rule**.

This folds the design's "Quick Actions / Selection / Heard Via" rail into the single app
RightRail, and makes Heard-Via part of the focused-contact detail.

## Rich right-pane contact detail (Phase 3)

Expand the existing right-rail `ContactCard` into the full detail; it appears **whenever a
contact is focused anywhere** (Manager row, sidebar click, @mention). One component,
reused.

- **Header:** avatar · name (inline-edit pencil → `ADD_UPDATE_CONTACT` name) · short
  pubkey · status/kind-adaptive quick-action row.
- **Info fields (KeyValueRows, matching the screenshots):** Public Key (full + copy) ·
  Position lat/lon + kebab (copy coords / view on map) · **Distance Away** (computed from
  contact GPS and our node's position from `SELF_INFO`/advert, km/mi; hidden if either
  side lacks GPS) · Contact Type · Last Advert Heard (relative + absolute) · **First Heard**
  (new app-tracked field) · Path block: Hops Away (or "Flood") with reset-path ✕
  (`RESET_PATH`), Out Path (inline-edit → `setContactPath`), Out Path Hash Size.
- **Heard-Via inspector** embedded: the design's multi-path hop chain (origin → relays →
  your radio), collapsible per path; intermediate hops report no signal.
- **Actions — adapt to status + kind ("real where backed, link otherwise"):**

  | Action | Behavior | Backing |
  |---|---|---|
  | Add to radio | prominent CTA when discovered-only | `ADD_UPDATE_CONTACT` (9) |
  | Message | → DMView | existing |
  | Favourite ★ | device flag bit 0 | `ADD_UPDATE_CONTACT` |
  | View on Map | center map on contact | existing |
  | Copy key / coords | clipboard | trivial |
  | Telemetry | → `RepeaterAdmin` Telemetry tab | existing (repeater/sensor) |
  | Permissions | → `RepeaterAdmin` ACL tab | existing (repeater) |
  | Remote Management | → `RepeaterAdmin` Status/CLI | existing (repeater) |
  | Share | export card | `EXPORT_CONTACT` (17) |
  | Remove | confirm → `REMOVE_CONTACT` (15), or drop from discovered store | existing/new |
  | Ping (Zero Hop) | optional/best-effort zero-hop trace | `SEND_TRACE_PATH` (24) — include only if it lands cleanly, else omit |

- **Status-adaptive shape:**
  - **Discovered-only** → "Add to radio" is the primary CTA; actions requiring an on-radio
    contact (Message, path edit, telemetry, remote-mgmt) are disabled with a hint to add
    first. Still allowed: Favourite, View-on-Map (if GPS), Share, Block, Remove-from-discovered.
  - **On-radio chat** → Message · Favourite · Path · Map · Share · Remove.
  - **On-radio repeater/room/sensor** → `RepeaterAdmin` deep-links (Telemetry / Permissions
    / Remote-Mgmt / Neighbours) · Path · Map · Share · Remove.

## Phasing

- **Phase 1 — Backend foundation:** SQLite discovered store + reconciliation; protocol
  encode/decode for `ADD_UPDATE_CONTACT`, `REMOVE_CONTACT`, `GET/SET_AUTOADD_CONFIG`,
  `EXPORT`/`IMPORT`; session handlers for `0x8A` split, `0x8F`, `0x90`; capacity from
  `DEVICE_INFO`; `favourite` field + device-flag sync; IPC/API + on-radio `contacts` and
  new `discovered` feeds; sidebar switches to on-radio-only.
- **Phase 2 — Main-pane Manager:** the table/list, toolbar+filters, status pills, bulk +
  list-action rail, capacity meter — wired to Phase 1.
- **Phase 3 — Rich detail + Heard-Via:** expand `ContactCard`, distance computation,
  focus-anywhere wiring, `RepeaterAdmin` deep-links, share/edit/remove.

## Testing

Per project conventions: TDD; `pnpm typecheck` + `pnpm lint` after changes; per-task
commits.

- **Unit:** discovered store + reconciliation logic; new protocol encode/decode (hand-built
  fixtures now, real captured golden frames later — the existing device-capture
  follow-up); distance math; filter/sort/status derivation.
- **Component:** Manager table/filters/bulk actions; detail panel status-adaptive rendering.
- **Real-device verification** the user drives at each phase boundary.

## Risks & mitigations

- **`0x8A` ambiguity (stored vs not):** trust `GET_CONTACTS`; optimistic update + debounced
  re-sync to avoid row flicker.
- **`maxContacts` is `DEVICE_INFO` byte ×2, per-board:** read + double, never hardcode 350.
- **`ADD_UPDATE_CONTACT` optional-field gotcha (#427):** GPS + last-advert are
  all-or-nothing; encode carefully and cover with a test.
- **`RepeaterAdmin` deep-links need admin login:** route in and let its existing login flow
  handle it; don't assume a session.
- **Import obeys auto-add:** an imported contact only sticks if its kind is auto-added
  (or follow with an explicit add); surface this to the user.
- **Performance at hundreds–thousands of discovered nodes:** SQLite-backed + virtualized list.

## Key references

- Design bundle: `Contact Manager.html`, `cm-panel.jsx` (manager + detail), `cm-path.jsx`
  (Heard-Via), `cm-shell.jsx`, `cm-data.js`, `cm-icons.jsx`, plus the 8 chat transcripts.
- Firmware: `/Users/andy/GitHub/meshcore-dev/MeshCore/examples/companion_radio/MyMesh.cpp`,
  `src/helpers/BaseChatMesh.cpp`, `src/helpers/ContactInfo.h`.
- Current app: `src/shared/types.ts` (Contact), `src/main/protocol/{codes,encode,decode,session}.ts`,
  `src/main/api/routes.ts`, `src/renderer/lib/store.ts`, `src/renderer/shell/` (AppShell,
  MainPane, leftnav, rightrail + `sections/ContactCard.tsx`, `sectionsFor.tsx`),
  `src/renderer/panels/repeater-admin/`, `src/main/blocking/`.
