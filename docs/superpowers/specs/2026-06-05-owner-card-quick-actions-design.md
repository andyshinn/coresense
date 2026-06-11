# Owner Card redesign + configurable Quick Actions — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorming) — ready for implementation planning
**Source design:** Claude Design handoff bundle `meshcore-desktop-application` (chat12 = owner card thread; `project/ownercard/*`, `OwnerCard - Final.html`)

## 1. Goal & scope

Redesign the left-nav **owner card** and its **hover popover** to match the design bundle's "Final" direction, and make the card's action buttons **user-configurable** via a new **Quick Actions settings tab**.

In scope (renderer only):

1. **OwnerCard redesign** — public-key **identicon** replaces the avatar/online-dot; an **instrument rail** (FREQ / SF / TX / GPS / ADV·LOC / RPT) is added beneath the battery; the single hard-coded "Flood advert" button becomes **up to 4 user-configurable quick actions** in a primary + secondary layout.
2. **Instrument hover popover** — replaces the key/value `RadioDetailsContent` with the design's gauges + capacity-bars treatment.
3. **Quick Actions settings tab** — a new settings tab where the user picks up to 4 actions from a searchable command menu and orders them (first = primary). Persisted in `AppSettings`.

Out of scope: every other screen in the bundle (Map View, Contact Manager, Firmware Flashing, Repeater Neighbours, Keyboard Shortcuts, Path Viewer, the broader Settings Panel redesign); refactoring the command palette to consume the new catalog (a deliberate follow-up).

## 2. Current state (what we're changing)

- **`src/renderer/shell/leftnav/OwnerCard.tsx`**
  - `OwnerCard({ owner, client })` renders: avatar (`User` icon) + transport status dot, name, 6-char pubkey prefix + copy + path-hash badge, a battery bar, and **one** hard-coded **Flood advert** button (`api.sendAdvert(client, true)`).
  - `RadioDetailsContent` renders the hover popover as a key/value list (`KeyValueGroup`/`KeyValueRow`): Public key, Radio, Device, Capacity, Position.
- Store selectors available (Zustand, `src/renderer/lib/store.ts`):
  - `deviceInfo`: `batteryMv, deviceModel, firmwareVerCode, maxContacts, maxChannels, storageTotalKb, storageUsedKb`
  - `radioSettings`: `frequencyHz, bandwidthHz, spreadingFactor, codingRate, txPowerDbm, pathHashMode, repeatMode`
  - `deviceIdentity`: `lat, lon, sharePositionInAdvert`
  - `gpsConfig`: `enabled, intervalSec`
  - `contacts` (`.length`), `channels` (`.length`), `transportState`, `appSettings`
  - `owner` is passed into `OwnerCard` as a prop (`Owner | null`, has `publicKeyHex`, `publicKeyShort`, `name`).

## 3. Architecture — the Quick Action catalog

A single typed catalog is the source of truth for both the card and the settings picker, structured so command-palette actions can be folded in later.

**New file: `src/renderer/features/quick-actions/catalog.tsx`**

```ts
import type { LucideIcon } from 'lucide-react';
import type { ApiClient } from '../../lib/api';
import type { Owner } from '../../../shared/types';
import { useStore } from '../../lib/store';

type StoreState = ReturnType<typeof useStore.getState>;

export interface QuickActionCtx {
  client: ApiClient | null;
  owner: Owner | null;
}

export interface QuickActionDef {
  id: string;                       // 'flood' | 'direct' | 'gps' | 'shareLoc' | 'copyKey' | 'reboot' | 'disconnect'
  label: string;                    // full label, e.g. 'Flood advert' (primary button + menu)
  short: string;                    // compact label for icon buttons / a11y, e.g. 'Flood'
  icon: LucideIcon;
  kind: 'action' | 'toggle' | 'danger';
  requiresConnection: boolean;      // disabled + dimmed when not connected
  /** Toggles only — live on/off read from the store for the state dot. */
  getState?: (s: StoreState) => boolean;
  /** Optional confirm step (rendered as a shadcn Popover anchored to the button). */
  confirm?: { title: string; body?: string; confirmLabel: string };
  run: (ctx: QuickActionCtx) => void | Promise<void>;
}

export const QUICK_ACTIONS: QuickActionDef[] = [ /* see table below */ ];
export const QUICK_ACTIONS_BY_ID: Record<string, QuickActionDef>;
export const DEFAULT_QUICK_ACTION_IDS = ['flood', 'gps', 'shareLoc', 'disconnect'];

/** Resolve persisted ids → defs: drop unknown ids, cap at 4, preserve order. */
export function resolveQuickActions(ids: string[]): QuickActionDef[];
```

### Catalog (7 actions — final)

| id | label | short | kind | requiresConnection | getState | confirm | run wiring |
|---|---|---|---|---|---|---|---|
| `flood` | Flood advert | Flood | action | yes | — | — | `api.sendAdvert(client, true)` |
| `direct` | Direct advert | Direct | action | yes | — | — | `api.sendAdvert(client, false)` |
| `gps` | Toggle GPS | GPS | toggle | yes | `s.gpsConfig.enabled` | — | `api.putGpsConfig(client, { ...s.gpsConfig, enabled: !s.gpsConfig.enabled })` |
| `shareLoc` | Share location in advert | Adv loc | toggle | yes | `s.deviceIdentity.sharePositionInAdvert` | — | `api.putDeviceIdentity(client, { sharePositionInAdvert: !current })` |
| `copyKey` | Copy public key | Key | action | **no** (needs `owner`) | — | — | `navigator.clipboard.writeText(owner.publicKeyHex)` |
| `reboot` | Reboot radio | Reboot | action | yes | — | `{ title: 'Reboot radio?', body: 'The radio will be unavailable for a few seconds.', confirmLabel: 'Reboot' }` | `api.rebootDevice(client)` |
| `disconnect` | Disconnect | Unplug | danger | yes | — | `{ title: 'Disconnect radio?', confirmLabel: 'Disconnect' }` | `api.disconnect(client)` |

- Every `run` reports outcome with `notify.success` / `notify.error` (same pattern as `OwnerCard.onFloodAdvert` and `buildActionItems`).
- Toggle `run`s read current state via `useStore.getState()` at click time, then write the inverse.
- `sendLoc` ("Send location") is intentionally **excluded** — it is not a real MeshCore device command.
- **Default assignment:** `['flood', 'gps', 'shareLoc', 'disconnect']` (flood = primary).
- Proposed Lucide icons (implementer may refine to match the 1.5-stroke language): `flood`→`Megaphone`, `direct`→`Radio`, `gps`→`LocateFixed`, `shareLoc`→`MapPin`, `copyKey`→`KeyRound`, `reboot`→`RotateCcw`, `disconnect`→`Unplug`.

**Extensibility (future, not now):** a `paletteItemFromQuickAction()` adapter (or registering palette actions into `QUICK_ACTIONS`) lets command-palette actions like "Add channel" / "Add user" become assignable without changing the card or the picker. The catalog's `id`/`kind`/`run` shape is chosen to make that a pure addition.

## 4. OwnerCard redesign

```
+-------------------------------+
| [identicon] egrme.sh Hand     |   header = hover trigger
|             1a3d3c (copy) 2b  |
| ----------------------------- |
| Battery          4.08 V · 95% |
| ##################-------      |
| FREQ 910.5  SF 10   TX 22dB   |   instrument rail (3-col grid)
| GPS  5min   ADV·LOC RPT off   |
| --- QUICK ACTIONS ------- (⚙) |   gear → settings tab
| [   ⌁  Flood advert        ]  |   primary (amber-tinted)
| [ GPS• ] [ LOC• ] [  ⏻  ]     |   up to 3 secondary icon buttons
+-------------------------------+
```

### 4.1 Identity mark — Identicon
- **New file `src/renderer/features/quick-actions/Identicon.tsx`** (or `shell/leftnav/Identicon.tsx`). Port `pkCells` + `Identicon` from the design's `owc-card.jsx`: deterministic 5×5 mirrored grid, amber (`cs-accent`) cells on `cs-bg-3`, 30px rounded tile. Input: `owner.publicKeyHex`.
- No owner → neutral placeholder tile; header text stays "No identity" with the existing "configure to send adverts" sub-line.
- The transport **online dot is removed** from the identity mark — connection status already lives in `ConnectionFooter`.

### 4.2 Instrument rail (new)
- 3-column grid below the battery bar, hidden when the sidebar is icon-collapsed (`group-data-[collapsible=icon]:hidden`, matching existing detail block).
- Cells (label / value), active values in `cs-accent`:
  - `FREQ` = `radioSettings.frequencyHz` → MHz (3dp); `SF` = `spreadingFactor`; `TX` = `${txPowerDbm}dB`
  - `GPS` = `gpsConfig.enabled ? interval : 'off'`; `ADV·LOC` = `deviceIdentity.sharePositionInAdvert ? 'on' : 'off'`; `RPT` = `radioSettings.repeatMode ? 'on' : 'off'`
- Reuse existing format helpers (`fmtFreq`, `fmtGpsInterval`, etc.) already in `OwnerCard.tsx`.

### 4.3 Quick actions block (new) — `src/renderer/features/quick-actions/QuickActions.tsx`
- Reads `appSettings.quickActions` (string[]), resolves via `resolveQuickActions()`.
- Layout (primary + secondary, from the design's "primary" QA layout):
  - **First** resolved action → full-width **primary** button (amber-tinted; icon + `label`).
  - **Remaining** (up to 3) → compact **secondary** icon buttons in a row (icon + tooltip = `label`).
  - **Toggles** show a small state dot (green `cs-online` when `getState` is true).
  - **`danger`** kind → red hover treatment.
  - **0 actions** → a subtle "Configure quick actions" text link to the settings tab.
- **Per-action disabled state:** `requiresConnection` actions are `disabled` + dimmed + tooltip ("Connect a radio") when `transportState !== 'connected'`; `copyKey` is enabled whenever `owner` exists.
- **Header:** `QUICK ACTIONS` label + gear icon; gear → `setActiveKey('tool:settings:quickActions')`.

### 4.4 `QuickActionButton` (shared) — confirm popover
- Renders one catalog button in either `primary` or `secondary` variant.
- If `def.confirm` is set, wrap the button in a shadcn **`<Popover>`** (`src/renderer/components/ui/popover.tsx`): clicking opens an anchored confirm instead of firing.
  ```
  +---------------------------+
  | Disconnect radio?         |   def.confirm.title
  | (optional body line)      |   def.confirm.body
  |        [Cancel] [Disconnect]   danger-styled confirm
  +---------------------------+
  ```
  Confirm → `def.run(ctx)` + close; Cancel / click-away → close, no-op.
- If no `confirm`, click runs immediately (matches today's flood button).

## 5. Instrument hover popover

Replace `RadioDetailsContent` with the design's `HoverInstrument` (port from `owc-hover.jsx`), rendered inside the existing `HoverCardContent` (`align="start" side="right"`). Suggested file: `src/renderer/shell/leftnav/OwnerCardPopover.tsx`.

- **Gauges row:** three SVG ring gauges — Battery % (`lipoPercent(batteryMv)`), Storage MB (`storageUsedKb/storageTotalKb`), Contacts (`contacts.length/maxContacts`).
- **Radio grid (2-col):** Freq, BW, SF, CR, TX, Repeat — from `radioSettings`.
- **Capacity bars:** Contacts, Channels, Storage (used/max bars).
- **Position:** pin + `lat, lon` + GPS / share-in-advert mini-stats.
- All data comes from the same store selectors the current popover already reads. The full-public-key block is **dropped** from the popover (the card header's copy button covers copy).
- Width widens to ~296–320px to fit gauges (current is `w-64`).

## 6. Quick Actions settings tab

### 6.1 Registration
- Add `'quickActions'` to the `SettingsTab` union in `src/renderer/lib/store.ts` (line ~142).
- In `src/renderer/panels/settings/SettingsPanel.tsx`:
  - Add a `TAB_SECTIONS.quickActions` entry (e.g. `[{ id: 'quickActions-actions', title: 'Owner Card Quick Actions', tab: 'quickActions' }]`).
  - Add a `pillTabs` entry: `{ id: 'quickActions', label: 'Quick Actions', icon: Zap }`.
  - Add `{activeTab === 'quickActions' && <QuickActionsTab client={client} />}`.
- In `src/renderer/shell/MainPane.tsx`, extend `tabFromActiveKey` so `tool:settings:quickActions` → `'quickActions'` (enables the card's gear deep-link).

### 6.2 Tab content — `src/renderer/panels/settings/quick-actions/QuickActionsTab.tsx`
- One `SettingsSection` ("Owner Card Quick Actions") using the existing `useSettingsSection` draft/dirty/save pattern; saves via `saveApp(client, { quickActions: ids }, 'Quick actions saved')` (`src/renderer/panels/settings/app/shared.ts`).
- **Up to 4 ordered slots**, driven by a local draft `string[]`:
  - Slot 1 tagged **PRIMARY**. Each slot row: icon + label + kind tag; **Change** button; **↑ / ↓** reorder; **✕** remove.
  - **Change** opens a cmdk **`<Command>`** menu (reuse `src/renderer/components/ui/command.tsx`) listing **unassigned** catalog actions, searchable by label. Selecting fills the slot. (No duplicate ids.)
  - **+ Add action** shown while `< 4` slots and unused actions remain.
  - No drag-and-drop dependency (arrows only).
- **Live preview:** render the `QuickActions` block from the current **draft** ids, **non-interactive** (`pointer-events-none`) so settings can't fire real device actions.

## 7. Persistence

- `src/shared/types.ts`: add `quickActions: string[]` to `AppSettings`; add `quickActions: ['flood', 'gps', 'shareLoc', 'disconnect']` to `DEFAULT_APP_SETTINGS`.
- Card and tab read `appSettings.quickActions`; the card resolves through `resolveQuickActions()` so unknown/renamed ids are **silently dropped** and the list is **capped at 4** (forward/backward compatible).

## 8. Edge cases
- Not connected → connection-requiring actions disabled with tooltip; `copyKey` enabled when an owner exists; instrument rail still shows last-synced values.
- Toggles reflect **live** store state via `getState` and re-render on store change.
- Fewer than 4 (or zero) assigned actions → layout adapts; zero → config link.
- Unknown persisted id → skipped by `resolveQuickActions`.
- Destructive actions (`reboot`, `disconnect`) require the confirm popover before firing.
- No owner / no device info → identicon placeholder; popover shows `—` for missing values (current behavior).

## 9. Testing (TDD during implementation)
- **Unit (catalog):** identicon determinism (same hex → same cells; different hex → different); each `run` calls the expected `api`/clipboard (mocked) and `notify`s; toggle `run` inverts current store state; `getState` selectors; `resolveQuickActions` drops unknown ids and caps at 4.
- **Component (OwnerCard / QuickActions):** renders identicon + rail values + primary/secondary buttons from a given `quickActions` list; `requiresConnection` buttons disabled when offline; `copyKey` enabled with owner; gear → `setActiveKey('tool:settings:quickActions')`; confirm popover gates `disconnect`/`reboot` (no run until confirmed; run on confirm).
- **Component (settings tab):** add / remove / reorder / change slots; Change opens command menu of unassigned actions; Save calls `saveApp` with the correct ordered ids; preview is non-interactive.
- **Component (popover):** gauges + bars + position render from store state; widened layout.
- Follow existing renderer test conventions (Vitest + Testing Library).

## 10. New / changed files (summary)
**New**
- `src/renderer/features/quick-actions/catalog.tsx` — `QuickActionDef`, `QUICK_ACTIONS`, `resolveQuickActions`, defaults.
- `src/renderer/features/quick-actions/QuickActions.tsx` — card QA block.
- `src/renderer/features/quick-actions/QuickActionButton.tsx` — button + confirm popover.
- `src/renderer/features/quick-actions/Identicon.tsx` — pubkey identicon.
- `src/renderer/shell/leftnav/OwnerCardPopover.tsx` — instrument popover (or kept inside OwnerCard.tsx).
- `src/renderer/panels/settings/quick-actions/QuickActionsTab.tsx` — settings tab.

**Changed**
- `src/renderer/shell/leftnav/OwnerCard.tsx` — identicon, rail, render `<QuickActions>`, new popover.
- `src/shared/types.ts` — `AppSettings.quickActions` + default.
- `src/renderer/lib/store.ts` — `SettingsTab` union += `'quickActions'`.
- `src/renderer/panels/settings/SettingsPanel.tsx` — tab registration.
- `src/renderer/shell/MainPane.tsx` — `tabFromActiveKey` mapping.
