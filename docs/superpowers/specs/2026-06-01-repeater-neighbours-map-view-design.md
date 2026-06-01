# Repeater Neighbours — Map + List View

_Design spec · 2026-06-01_

## Overview

Replace the current repeater **Neighbours** tab — today a bare three-column
table (pubkey prefix · heard · SNR) — with a map-forward view: a real MapLibre
map filling the main pane, and a resolved neighbour list in a right pane. Names
are resolved from the contact database by key prefix (the protocol returns no
name), located neighbours are plotted and linked to the focal repeater by a
signal line coloured by SNR, and the SNR is shown with the existing Path Viewer
signal-bars element.

This implements the Claude Design handoff `neighbours/Repeater Neighbours.html`
(intent captured in the design bundle's `chats/chat9.md`), recreated against the
real Coresense architecture rather than the prototype's static artboard.

## Goals

- Turn the Neighbours tab into a **map (hero) + list (right rail)** view.
- Resolve each neighbour's **name** and **location** from known contacts via the
  key prefix; fall back to "Unknown repeater" when unresolved.
- Reuse the existing map stack and SNR vocabulary — **DRY against the current
  map**, don't fork it.
- Keep fetching a deliberate, manual action (it's a high-cost radio operation).

## Non-goals

- No new IPC/protocol work. `RepeaterNeighbour` and `api.repeaterNeighbours`
  stay exactly as they are.
- No "Tweaks" panel (that was design-tool scaffolding) — the landed visual
  choices are baked in.
- No click-through navigation from a neighbour to its own contact detail (the
  resolved contact key is carried in the model for a future enhancement, but
  click only selects/couples to the map for now).
- Sensors/rooms/other kinds: neighbours are repeaters; resolution may match any
  contact kind but the marker/avatar treatment is the repeater shape.

## Current state (what exists today)

- **Tab body:** `src/renderer/panels/repeater-admin/NeighboursTab.tsx` — Order /
  Count / Fetch controls + a table. `Order` and `Count` are request params; data
  loads only on the **Fetch** button (`api.repeaterNeighbours`).
- **Chrome:** `src/renderer/panels/repeater-admin/index.tsx` already renders the
  repeater identity header and the tab bar (Login/Path/Status/ACL/**Neighbours**/
  Owner/CLI). The prototype's `IdentityHeader`/`TabBar` are therefore **not**
  reimplemented — only the tab body changes.
- **Data:** `RepeaterNeighbour = { pubKeyPrefixHex, heardSecsAgo, snrDb }`
  (`src/shared/types.ts`). The protocol returns **no name and no location**.
  `api.repeaterNeighbours(client, key, { count, offset, orderBy, prefixLen })`
  → `{ page: { total, neighbours[] } }`. The current tab requests `prefixLen: 6`
  (3-byte prefix).
- **Map:** `src/renderer/components/map/MapCanvas.tsx` is mount-once, always
  renders `MapClusters` (all contacts) + `MapLocalNode` + `MapInfo`, and persists
  the viewport globally to store + server. It is **not** reusable as-is for a
  focused per-repeater map. Shared, reusable building blocks: pmtiles protocol
  (`lib/map/pmtiles-protocol.ts`), `buildStyle` (`lib/map/style-builder.ts`),
  theme `flavors` (`lib/map/flavors.ts`), the map event `bus`, and the marker
  builders below.
- **Reusable marker/SNR primitives already in the app:**
  - `src/renderer/components/path/SignalBars.tsx` → `SignalBars`, `snrBand`,
    `fmtSnr`, `snrTokenVar` (already ported from Path Viewer v2).
  - `src/renderer/components/map/markers/markerHtml.ts` →
    `buildContactMarker(contact, state)` returns an `HTMLButtonElement` (the
    exact map marker visuals); `applyMarkerState`/`syncMarkerVisual` for state.
  - `src/renderer/components/map/markers/MarkerShape.tsx` → `MarkerShape` /
    `shapeMarkup` (the typed shape, for list-row avatars).
  - `src/shared/types.ts` → `hasValidFix(contact)`.
  - Contact sources: `useStore(s => s.contacts)` (on-radio) and
    `useStore(s => s.discovered)` (`DiscoveredContact` carries `publicKeyHex`,
    `name`, `gpsLat`, `gpsLon`, last-heard).

## Decisions (resolved during brainstorming)

1. **Map reuse → parameterize `MapCanvas`.** One component drives both the main
   Map View and the neighbours map. New props default to today's behavior so the
   Map View is unchanged.
2. **Real MapLibre tiles** (same PMTiles basemap as Map View), not the
   prototype's stylized static artboard.
3. **No focal GPS → map placeholder + full list.** When the focal repeater has
   no valid fix, show a map placeholder and push every neighbour into the
   off-map list group.
4. **Ambiguous prefix → best guess + flag.** When a prefix matches 2+ contacts,
   show the best match (prefer one with a valid fix, then most-recently-heard)
   and mark the row with a subtle ambiguity indicator.
5. **Order + Count are instant, client-side.** Fetch is the only network call.
6. **No auto-fetch.** Data loads only on the manual Fetch button.

### Baked-in visual defaults (Tweaks panel dropped)

- Marker style: **Chip** (style A).
- SNR labels on links: **none** — the line **colour** is the only SNR encoding
  on the map.
- List density: comfortable. List width: ~360px. Name-source glyph: shown.

## Data model & resolution

`RepeaterNeighbour` is unchanged. A new **pure** renderer helper produces the
view model:

```ts
// src/renderer/lib/neighbours.ts  (new, pure → unit-tested)
export type NeighbourNameSource = 'protocol' | 'contacts' | 'unknown';

export interface ResolvedNeighbour {
  pubKeyPrefixHex: string;     // carried from RepeaterNeighbour
  heardSecsAgo: number;
  snrDb: number;
  name: string;                // resolved or "Unknown repeater"
  nameSource: NeighbourNameSource;
  contactKey: string | null;   // matched contact key (future click-through)
  lat: number | null;
  lon: number | null;
  located: boolean;            // has a valid fix
  ambiguous: boolean;          // 2+ contacts matched the prefix
}

export function resolveNeighbours(
  raw: RepeaterNeighbour[],
  contacts: Contact[],
  discovered: DiscoveredContact[],
): ResolvedNeighbour[];
```

**Resolution algorithm (per neighbour):**

1. Lowercase the neighbour `pubKeyPrefixHex`. Collect every candidate from
   `contacts` ∪ `discovered` whose `publicKeyHex` (lowercased) **starts with**
   that prefix. (Dedupe `contacts`/`discovered` that refer to the same
   `publicKeyHex`, preferring the on-radio contact.)
2. **0 matches** → `name = "Unknown repeater"`, `nameSource = 'unknown'`,
   `located = false`, `ambiguous = false`.
3. **1 match** → use its `name`; `nameSource = 'contacts'`; coordinates from its
   GPS if `hasValidFix`; `ambiguous = false`.
4. **≥2 matches** → pick best: a match with a valid fix wins; tie-break by
   most-recently-heard. `ambiguous = true`. Name/location from the chosen match;
   `nameSource = 'contacts'`.
5. `'protocol'` source is reserved for future firmware that returns a name; not
   produced today.

Note: `prefixLen` stays `6` on the fetch request. The longer the prefix, the
fewer collisions; bumping it is out of scope but the resolver handles collisions
regardless.

## Map architecture — parameterizing `MapCanvas`

Add three optional props to `MapCanvas`, each defaulting to current behavior:

```ts
interface MapCanvasProps {
  client: ApiClient;
  manifest: TileManifest;
  settings: MapSettings;
  // NEW — all optional, defaults preserve today's Map View behavior:
  renderOverlays?: (map: MapLibreMap) => React.ReactNode; // default: clusters+local+info
  persistViewport?: boolean;                               // default: true
  initialView?: InitialViewSpec;                           // default: pickInitialView()
}
```

- **`renderOverlays`** — default returns `<MapClusters/><MapLocalNode/><MapInfo/>`
  (today's render). The neighbours view passes `(map) => <NeighbourMapLayer .../>`,
  so the all-contacts cluster layer is **not** mounted.
- **`persistViewport`** — when `false`, the moveend/zoomend persistence effect is
  skipped (the neighbours map is a transient sub-map; it must not overwrite the
  Map View's saved viewport).
- **`initialView`** — the neighbours map supplies a `fitBounds` spec computed
  from the focal repeater + located neighbours (with padding); the main map keeps
  `pickInitialView(manifest, settings)`.

Everything else stays shared and unchanged: mount-once instance creation,
`buildStyle`, pmtiles protocol, error forwarding, `transformRequest` auth, nav
control, and the terrain/hillshade/online-fallback effects.

### `NeighbourMapLayer` (new overlay)

Given the live `map`, the focal repeater contact, and the resolved **located**
neighbours, it imperatively manages map sources/markers (the established pattern
in `MapClusters`):

- **Signal links** — a GeoJSON `LineString` source + line layer; one feature per
  located neighbour, focal → neighbour. `line-color` from the SNR band, dashed
  (`line-dasharray`). The active (hovered/selected) link brightens + thickens via
  a feature-state or paint expression keyed on the neighbour id; others dim.
  GeoJSON in map coordinates tracks pan/zoom natively. **No SNR pill labels.**
- **Neighbour markers** — `maplibregl.Marker` whose element is
  `buildContactMarker(contactLike, state)` (Chip visuals), one per located
  neighbour. Hover/click update shared state and couple to the list.
- **Focal marker** — a distinct treatment (ring + persistent name label) at the
  focal repeater's coordinates, drawn on top.
- **Count banner** — a floating centered pill:
  "Showing _N_ of _M_ neighbours · _K_ off-map".
- **No focal GPS** — render the placeholder ("No location for this repeater")
  instead of links/markers; all neighbours are off-map (see List).

A small **pure** module builds the link `FeatureCollection` and the fit-bounds
box from `(focal, located[])` so that logic is unit-testable without MapLibre.

### SNR colour

The list reuses `SignalBars`/`fmtSnr` directly. The map line layer needs a
concrete colour value (MapLibre paint can't read CSS vars), so add a small
`snrColor(snr): string` next to the existing bands (hex matching the band
tokens: strong = lime, mid = amber, weak = red). Both the map and any
colour-coded list affordance use it, keeping one source of truth for SNR bands.

## List pane

Reuses `SignalBars` + `fmtSnr` (SNR readout) and `MarkerShape`/`shapeMarkup`
(row avatar). Composed of:

- **Controls (top):** Order (select) · Count (number) · **Fetch neighbours**
  (button, muted app style). Order and Count apply **instantly client-side**
  (see below). Fetch is the only network call.
- **Header:** `NEIGHBOURS` · "_N_ on map · _M_ heard".
- **Column header:** Name / SNR.
- **Row (`NeighbourRow`):** avatar (repeater shape; dashed + faded when unknown
  or off-map) · name (italic + dim when unknown; a contacts-source glyph when
  resolved from contacts; an ambiguity indicator when `ambiguous`) · pubkey
  prefix + heard-time (`fmtSecsAgo`) · SNR readout (`SignalBars` + `fmtSnr`).
- **Off-map group:** neighbours without a location advert are grouped under a
  "No location advert" divider at the bottom, with a count.
- **Empty state:** before the first Fetch, a "Press Fetch to load neighbours"
  prompt.

### Order / Count semantics

- **Order** (client-side sort of the fetched window): Strongest SNR · Weakest
  SNR · Most recent · Oldest · Name (A–Z).
- **Count** (client-side display cap): show the first _N_ rows after sorting.
  Count also doubles as the **fetch size** passed to `api.repeaterNeighbours`
  the next time Fetch is pressed.
- Changing Order or Count never triggers a network request.

## Interaction & state

State is lifted into the restructured `NeighboursTab`:

- `page: RepeaterNeighboursPage | null`, `busy`, `orderBy`, `count`,
  `selectedId`, `hoveredId`.
- Resolution + sort + slice derive the displayed list with `useMemo` from
  `page`, `orderBy`, `count`, and the store's `contacts`/`discovered`.
- **Hover** a row → highlight its marker + signal link (and vice-versa).
- **Click** a row or marker → select (toggles); selected link/marker emphasised,
  others dimmed.
- **Fetch** → `api.repeaterNeighbours(client, contact.key, { count, orderBy,
  prefixLen: 6 })`; errors via `notify.error` (as today). `busy` disables the
  button.
- **No focal GPS** → map placeholder; list still works; all neighbours off-map.

## Files

**New**
- `src/renderer/lib/neighbours.ts` — `resolveNeighbours`, sort comparators,
  types (pure).
- `src/renderer/components/map/NeighbourMapLayer.tsx` — focal marker, signal-link
  layer, neighbour markers, count banner, no-GPS placeholder.
- `src/renderer/components/map/neighbourLinks.ts` — pure builders (link
  `FeatureCollection`, fit-bounds box) (pure → unit-tested).
- `src/renderer/panels/repeater-admin/neighbours/NeighbourList.tsx` +
  `NeighbourRow.tsx` (or co-located in the tab) — right-pane list.
- `tests/unit/renderer/lib/neighbours.test.ts`,
  `tests/unit/renderer/.../neighbourLinks.test.ts`.

**Changed**
- `src/renderer/components/map/MapCanvas.tsx` — add `renderOverlays`,
  `persistViewport`, `initialView` props (defaults preserve behavior).
- `src/renderer/components/path/SignalBars.tsx` — add a `snrColor(snr): string`
  helper alongside `snrBand` (single source of truth for SNR bands; used by the
  map line layer).
- `src/renderer/panels/repeater-admin/NeighboursTab.tsx` — restructure into the
  map + list split, lifted state, client-side order/count, manual fetch.

## Testing

- **Unit (pure):**
  - `resolveNeighbours`: 0/1/≥2 prefix matches; ambiguity flagging; best-match
    selection (fix-bearing > recency); located vs off-map; contacts ∪ discovered
    dedupe; "Unknown repeater" fallback.
  - sort comparators (each Order option) + Count slice.
  - `snrColor`/band mapping.
  - `neighbourLinks`: feature collection + fit-bounds from focal + located set;
    empty/no-focal-GPS cases.
- **Component:** list grouping (located vs off-map divider + counts), unknown +
  ambiguity glyphs, hover/select state coupling, empty (pre-fetch) state.
- **Regression:** all 150 existing tests stay green; assert `MapCanvas` defaults
  (no `renderOverlays`/`persistViewport`/`initialView`) reproduce current Map
  View behavior (clusters mounted, viewport persisted).

## Risks & mitigations

- **MapCanvas refactor could regress the Map View.** Mitigation: every new prop
  defaults to today's behavior; the Map View call site is unchanged; add a
  regression assertion on defaults.
- **Prefix collisions show a wrong name.** Mitigation: best-guess + explicit
  ambiguity flag so the operator knows it's uncertain; never silently guess.
- **Imperative map layer churn on re-render.** Mitigation: follow the existing
  `MapClusters` diff-against-DOM pattern; build sources once and update via
  `setData`/feature-state rather than tearing down per tick.
