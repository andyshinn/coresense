# Repeater Neighbours Map + List View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repeater Neighbours tab's bare table with a real MapLibre map (focal repeater + SNR-coloured signal links to located neighbours) beside a resolved neighbour list.

**Architecture:** Pure helpers resolve each neighbour's name/location from the contact store by key prefix and build the map's link/​bounds geometry. `MapCanvas` is parameterized (`renderOverlays`/`persistViewport`/`initialView`, all defaulting to today's behavior) so a focused `NeighbourMapLayer` can reuse the existing map bootstrap + marker visuals without forking the Map View. Order/Count are instant client-side; Fetch is the only network call.

**Tech Stack:** React 19, TypeScript, Zustand, MapLibre GL, Vitest (pure-node unit project), Biome (lint), pnpm.

**Spec:** `docs/superpowers/specs/2026-06-01-repeater-neighbours-map-view-design.md`

**Conventions:**
- Unit tests live in `tests/unit/**/*.test.ts`, run in a **node** environment (no DOM). Only pure functions are unit-tested; React components are verified via `pnpm typecheck` + `pnpm lint` (there is no jsdom/component-test harness in this repo — do not add one).
- Test imports use relative paths to `src/` (e.g. `../../../../src/renderer/lib/...`), matching existing tests.
- Run a single unit file: `pnpm exec vitest run --project unit <path>`.
- Full suite: `pnpm test` (baseline: 150 passing). Typecheck: `pnpm typecheck`. Lint: `pnpm lint`.

---

## File Structure

**New**
- `src/renderer/lib/neighbours.ts` — `ResolvedNeighbour` type, `resolveNeighbours()`, sort table + `sortNeighbours()` (pure).
- `src/renderer/components/map/neighbourLinks.ts` — `buildNeighbourLinkFeatures()`, `computeNeighbourBounds()` (pure).
- `src/renderer/components/map/NeighbourMapLayer.tsx` — overlay: focal marker, signal-link layer, neighbour markers, count banner.
- `src/renderer/panels/repeater-admin/neighbours/NeighbourList.tsx` — right-pane list (controls + rows + grouping).
- `tests/unit/renderer/lib/neighbours.test.ts`
- `tests/unit/renderer/components/map/neighbourLinks.test.ts`
- `tests/unit/renderer/components/path/signalBars.test.ts`

**Modified**
- `src/renderer/components/path/SignalBars.tsx` — add `snrColor(snr)`.
- `src/renderer/components/map/MapCanvas.tsx` — add `renderOverlays` / `persistViewport` / `initialView` props.
- `src/renderer/panels/repeater-admin/NeighboursTab.tsx` — rewrite into the map + list split.

---

## Task 1: `snrColor` helper

Adds a concrete-hex SNR colour (MapLibre paint can't read CSS vars). Bands match the `--cs-online/--cs-warn/--cs-danger` tokens (`132 204 22` / `245 158 11` / `220 38 38`).

**Files:**
- Modify: `src/renderer/components/path/SignalBars.tsx`
- Test: `tests/unit/renderer/components/path/signalBars.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/components/path/signalBars.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { snrBand, snrColor } from '../../../../../src/renderer/components/path/SignalBars';

describe('snrBand', () => {
  it('classifies strong/mid/weak by threshold', () => {
    expect(snrBand(5)).toBe('strong');
    expect(snrBand(4.9)).toBe('mid');
    expect(snrBand(0)).toBe('mid');
    expect(snrBand(-0.1)).toBe('weak');
  });
});

describe('snrColor', () => {
  it('maps each band to its fixed hex token', () => {
    expect(snrColor(12)).toBe('#84cc16'); // --cs-online
    expect(snrColor(2.5)).toBe('#f59e0b'); // --cs-warn
    expect(snrColor(-3)).toBe('#dc2626'); // --cs-danger
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/components/path/signalBars.test.ts`
Expected: FAIL — `snrColor` is not exported from SignalBars.

- [ ] **Step 3: Add the implementation**

In `src/renderer/components/path/SignalBars.tsx`, append after `fmtSnr`:

```ts
/** Fixed SNR band colours (hex), matching the --cs-online/--cs-warn/--cs-danger
 *  tokens. Used where a concrete colour string is required — e.g. MapLibre paint,
 *  which can't resolve CSS custom properties. Bands are semantic and
 *  theme-independent, so hard-coding the hexes keeps them in sync with the
 *  SignalBars gauge by construction. */
export function snrColor(snr: number): string {
  const b = snrBand(snr);
  if (b === 'strong') return '#84cc16';
  if (b === 'mid') return '#f59e0b';
  return '#dc2626';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/components/path/signalBars.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/path/SignalBars.tsx tests/unit/renderer/components/path/signalBars.test.ts
git commit -m "feat(snr): add snrColor() hex helper for map paint"
```

---

## Task 2: Neighbour resolution + sorting (`lib/neighbours.ts`)

Pure: resolves each `RepeaterNeighbour` prefix against the contact store (on-radio ∪ discovered) into a `ResolvedNeighbour` with name/location/ambiguity, plus the client-side sort table.

**Files:**
- Create: `src/renderer/lib/neighbours.ts`
- Test: `tests/unit/renderer/lib/neighbours.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/neighbours.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DiscoveredContact } from '../../../../src/shared/contacts/discovered';
import type { Contact, RepeaterNeighbour } from '../../../../src/shared/types';
import { resolveNeighbours, sortNeighbours } from '../../../../src/renderer/lib/neighbours';

function contact(p: Partial<Contact> & { publicKeyHex: string }): Contact {
  return {
    key: `c:${p.publicKeyHex}`,
    name: 'C',
    kind: 'repeater',
    ...p,
  } as Contact;
}
function disc(p: Partial<DiscoveredContact> & { publicKeyHex: string }): DiscoveredContact {
  return {
    key: `c:${p.publicKeyHex}`,
    name: 'D',
    kind: 'repeater',
    firstHeardMs: 0,
    onRadio: false,
    favourite: false,
    blocked: false,
    ...p,
  } as DiscoveredContact;
}
const raw = (prefix: string, snrDb = 1, heardSecsAgo = 10): RepeaterNeighbour => ({
  pubKeyPrefixHex: prefix,
  snrDb,
  heardSecsAgo,
});

describe('resolveNeighbours', () => {
  it('marks an unmatched prefix as Unknown / off-map', () => {
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [], []);
    expect(r.name).toBe('Unknown repeater');
    expect(r.nameSource).toBe('unknown');
    expect(r.located).toBe(false);
    expect(r.ambiguous).toBe(false);
    expect(r.contactKey).toBeNull();
  });

  it('resolves a unique match with a valid fix (located)', () => {
    const c = contact({ publicKeyHex: 'aabbccddeeff0011', name: 'Mt Bonnell', gpsLat: 30.3, gpsLon: -97.7 });
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [c], []);
    expect(r.name).toBe('Mt Bonnell');
    expect(r.nameSource).toBe('contacts');
    expect(r.located).toBe(true);
    expect(r.lat).toBe(30.3);
    expect(r.lon).toBe(-97.7);
    expect(r.contactKey).toBe('c:aabbccddeeff0011');
  });

  it('treats a 0/0 fix as no location (off-map)', () => {
    const c = contact({ publicKeyHex: 'aabbccddeeff0011', gpsLat: 0, gpsLon: 0 });
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [c], []);
    expect(r.located).toBe(false);
    expect(r.lat).toBeNull();
  });

  it('flags ambiguity and prefers a located, recently-heard match', () => {
    const a = contact({ publicKeyHex: 'aabbccddeeff1111', name: 'NoFix', lastSeenMs: 9999 });
    const b = contact({ publicKeyHex: 'aabbccddeeff2222', name: 'HasFix', gpsLat: 1, gpsLon: 1, lastSeenMs: 1 });
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [a, b], []);
    expect(r.ambiguous).toBe(true);
    expect(r.name).toBe('HasFix'); // located wins over recency
    expect(r.located).toBe(true);
  });

  it('lets an on-radio contact win over a discovered duplicate of the same key', () => {
    const c = contact({ publicKeyHex: 'aabbccddeeff0011', name: 'OnRadio' });
    const d = disc({ publicKeyHex: 'aabbccddeeff0011', name: 'Discovered' });
    const [r] = resolveNeighbours([raw('aabbccddeeff')], [c], [d]);
    expect(r.name).toBe('OnRadio');
    expect(r.ambiguous).toBe(false);
  });
});

describe('sortNeighbours', () => {
  const list = [
    { ...raw('a1', 2, 100), name: 'Zeta', nameSource: 'contacts', contactKey: null, lat: null, lon: null, located: false, ambiguous: false },
    { ...raw('a2', 8, 5), name: 'Alpha', nameSource: 'contacts', contactKey: null, lat: null, lon: null, located: false, ambiguous: false },
  ];
  it('sorts strongest SNR first', () => {
    expect(sortNeighbours(list, 'snr-desc').map((n) => n.snrDb)).toEqual([8, 2]);
  });
  it('sorts most recent first (smallest heardSecsAgo)', () => {
    expect(sortNeighbours(list, 'recent').map((n) => n.heardSecsAgo)).toEqual([5, 100]);
  });
  it('sorts by name A–Z', () => {
    expect(sortNeighbours(list, 'name').map((n) => n.name)).toEqual(['Alpha', 'Zeta']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/neighbours.test.ts`
Expected: FAIL — cannot find module `lib/neighbours`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/lib/neighbours.ts`:

```ts
import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type { Contact, RepeaterNeighbour } from '../../shared/types';

export type NeighbourNameSource = 'protocol' | 'contacts' | 'unknown';

export interface ResolvedNeighbour {
  pubKeyPrefixHex: string;
  heardSecsAgo: number;
  snrDb: number;
  name: string;
  nameSource: NeighbourNameSource;
  contactKey: string | null;
  lat: number | null;
  lon: number | null;
  located: boolean;
  ambiguous: boolean;
}

const UNKNOWN_NAME = 'Unknown repeater';

// Normalized match candidate drawn from either the on-radio contact list or the
// discovered list. `heardMs` is "when WE last heard it" for the recency tie-break.
interface Candidate {
  key: string;
  publicKeyHex: string;
  name: string;
  lat: number | null;
  lon: number | null;
  located: boolean;
  heardMs: number;
}

// Both coords present, not the 0/0 "no GPS" sentinel, and within WGS84 range
// (mirrors hasValidFix, but works on the looser DiscoveredContact too).
function coordsValid(lat: number | undefined, lon: number | undefined): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    (lat !== 0 || lon !== 0) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function contactCandidate(c: Contact): Candidate {
  const located = coordsValid(c.gpsLat, c.gpsLon);
  return {
    key: c.key,
    publicKeyHex: c.publicKeyHex.toLowerCase(),
    name: c.name,
    lat: located ? (c.gpsLat as number) : null,
    lon: located ? (c.gpsLon as number) : null,
    located,
    heardMs: c.lastSeenMs ?? 0,
  };
}

function discoveredCandidate(d: DiscoveredContact): Candidate {
  const located = coordsValid(d.gpsLat, d.gpsLon);
  return {
    key: d.key,
    publicKeyHex: d.publicKeyHex.toLowerCase(),
    name: d.name,
    lat: located ? (d.gpsLat as number) : null,
    lon: located ? (d.gpsLon as number) : null,
    located,
    heardMs: d.lastHeardMs ?? d.firstHeardMs ?? 0,
  };
}

// Merge on-radio + discovered, de-duped by publicKeyHex — the on-radio contact
// wins (it's the committed record).
function buildCandidates(contacts: Contact[], discovered: DiscoveredContact[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const d of discovered) byKey.set(d.publicKeyHex.toLowerCase(), discoveredCandidate(d));
  for (const c of contacts) byKey.set(c.publicKeyHex.toLowerCase(), contactCandidate(c));
  return [...byKey.values()];
}

// Best of several prefix matches: a located match wins; tie-break by recency.
function pickBest(matches: Candidate[]): Candidate {
  return [...matches].sort((a, b) => {
    if (a.located !== b.located) return a.located ? -1 : 1;
    return b.heardMs - a.heardMs;
  })[0] as Candidate;
}

export function resolveNeighbours(
  raw: RepeaterNeighbour[],
  contacts: Contact[],
  discovered: DiscoveredContact[],
): ResolvedNeighbour[] {
  const candidates = buildCandidates(contacts, discovered);
  return raw.map((n) => {
    const prefix = n.pubKeyPrefixHex.toLowerCase();
    const matches = candidates.filter((c) => c.publicKeyHex.startsWith(prefix));
    if (matches.length === 0) {
      return {
        pubKeyPrefixHex: n.pubKeyPrefixHex,
        heardSecsAgo: n.heardSecsAgo,
        snrDb: n.snrDb,
        name: UNKNOWN_NAME,
        nameSource: 'unknown',
        contactKey: null,
        lat: null,
        lon: null,
        located: false,
        ambiguous: false,
      };
    }
    const best = matches.length === 1 ? (matches[0] as Candidate) : pickBest(matches);
    return {
      pubKeyPrefixHex: n.pubKeyPrefixHex,
      heardSecsAgo: n.heardSecsAgo,
      snrDb: n.snrDb,
      name: best.name,
      nameSource: 'contacts',
      contactKey: best.key,
      lat: best.lat,
      lon: best.lon,
      located: best.located,
      ambiguous: matches.length > 1,
    };
  });
}

// ── Client-side sorting ────────────────────────────────────────────────
export type NeighbourSortKey = 'snr-desc' | 'snr-asc' | 'recent' | 'oldest' | 'name';

export const NEIGHBOUR_SORTS: Record<
  NeighbourSortKey,
  { label: string; cmp: (a: ResolvedNeighbour, b: ResolvedNeighbour) => number }
> = {
  'snr-desc': { label: 'Strongest SNR', cmp: (a, b) => b.snrDb - a.snrDb },
  'snr-asc': { label: 'Weakest SNR', cmp: (a, b) => a.snrDb - b.snrDb },
  recent: { label: 'Most recent', cmp: (a, b) => a.heardSecsAgo - b.heardSecsAgo },
  oldest: { label: 'Oldest', cmp: (a, b) => b.heardSecsAgo - a.heardSecsAgo },
  name: { label: 'Name (A–Z)', cmp: (a, b) => a.name.localeCompare(b.name) },
};

export function sortNeighbours(
  list: ResolvedNeighbour[],
  key: NeighbourSortKey,
): ResolvedNeighbour[] {
  const sort = NEIGHBOUR_SORTS[key] ?? NEIGHBOUR_SORTS['snr-desc'];
  return [...list].sort(sort.cmp);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/neighbours.test.ts`
Expected: PASS (all `resolveNeighbours` + `sortNeighbours` cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/neighbours.ts tests/unit/renderer/lib/neighbours.test.ts
git commit -m "feat(neighbours): resolve prefix->contact name/location + sort table"
```

---

## Task 3: Map link + bounds builders (`neighbourLinks.ts`)

Pure builders: the GeoJSON link `FeatureCollection` (focal → each located neighbour, paint baked into properties) and the fit-bounds box.

**Files:**
- Create: `src/renderer/components/map/neighbourLinks.ts`
- Test: `tests/unit/renderer/components/map/neighbourLinks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/components/map/neighbourLinks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ResolvedNeighbour } from '../../../../../src/renderer/lib/neighbours';
import {
  buildNeighbourLinkFeatures,
  computeNeighbourBounds,
} from '../../../../../src/renderer/components/map/neighbourLinks';

const focal = { lat: 30, lon: -97 };
function n(p: Partial<ResolvedNeighbour> & { pubKeyPrefixHex: string }): ResolvedNeighbour {
  return {
    heardSecsAgo: 1,
    snrDb: 1,
    name: 'n',
    nameSource: 'contacts',
    contactKey: null,
    lat: null,
    lon: null,
    located: false,
    ambiguous: false,
    ...p,
  };
}

describe('buildNeighbourLinkFeatures', () => {
  it('emits one feature per located neighbour, focal -> neighbour', () => {
    const located = [n({ pubKeyPrefixHex: 'a', lat: 31, lon: -96, located: true, snrDb: 8 })];
    const fc = buildNeighbourLinkFeatures(focal, located, null);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([
      [-97, 30],
      [-96, 31],
    ]);
    expect(fc.features[0].properties).toMatchObject({ id: 'a', color: '#84cc16', opacity: 0.5 });
  });

  it('skips neighbours without coordinates', () => {
    const fc = buildNeighbourLinkFeatures(focal, [n({ pubKeyPrefixHex: 'a', located: true })], null);
    expect(fc.features).toHaveLength(0);
  });

  it('brightens the active link and dims the rest', () => {
    const located = [
      n({ pubKeyPrefixHex: 'a', lat: 31, lon: -96, located: true }),
      n({ pubKeyPrefixHex: 'b', lat: 29, lon: -98, located: true }),
    ];
    const fc = buildNeighbourLinkFeatures(focal, located, 'a');
    const a = fc.features.find((f) => f.properties.id === 'a');
    const b = fc.features.find((f) => f.properties.id === 'b');
    expect(a?.properties.opacity).toBe(0.95);
    expect(a?.properties.width).toBe(2.4);
    expect(b?.properties.opacity).toBe(0.16);
  });
});

describe('computeNeighbourBounds', () => {
  it('encloses focal + located neighbours', () => {
    const located = [
      n({ pubKeyPrefixHex: 'a', lat: 31, lon: -96, located: true }),
      n({ pubKeyPrefixHex: 'b', lat: 29, lon: -98, located: true }),
    ];
    expect(computeNeighbourBounds(focal, located)).toEqual([
      [-98, 29],
      [-96, 31],
    ]);
  });
  it('returns the single focal point when no neighbours are located', () => {
    expect(computeNeighbourBounds(focal, [])).toEqual([
      [-97, 30],
      [-97, 30],
    ]);
  });
  it('returns null when there is nothing to frame', () => {
    expect(computeNeighbourBounds(null, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/components/map/neighbourLinks.test.ts`
Expected: FAIL — cannot find module `neighbourLinks`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/components/map/neighbourLinks.ts`:

```ts
import type { ResolvedNeighbour } from '../../lib/neighbours';
import { snrColor } from '../path/SignalBars';

export interface FocalPoint {
  lat: number;
  lon: number;
}

interface LinkProps {
  id: string;
  color: string;
  width: number;
  opacity: number;
}

// One dashed LineString per located neighbour, focal -> neighbour, with the
// paint values baked into each feature's properties so the line layer can read
// them via ['get', ...]. The active (hovered/selected) link brightens; the rest
// dim when something is active.
export function buildNeighbourLinkFeatures(
  focal: FocalPoint,
  located: ResolvedNeighbour[],
  activeId: string | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString, LinkProps> {
  const features = located
    .filter((n) => n.lat != null && n.lon != null)
    .map((n) => {
      const isActive = activeId === n.pubKeyPrefixHex;
      const dim = activeId != null && !isActive;
      return {
        type: 'Feature' as const,
        properties: {
          id: n.pubKeyPrefixHex,
          color: snrColor(n.snrDb),
          width: isActive ? 2.4 : 1.4,
          opacity: dim ? 0.16 : isActive ? 0.95 : 0.5,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [focal.lon, focal.lat],
            [n.lon as number, n.lat as number],
          ],
        },
      };
    });
  return { type: 'FeatureCollection', features };
}

// Bounds [[west,south],[east,north]] enclosing the focal point + all located
// neighbours, or null if there is nothing to frame.
export function computeNeighbourBounds(
  focal: FocalPoint | null,
  located: ResolvedNeighbour[],
): [[number, number], [number, number]] | null {
  const pts: Array<[number, number]> = [];
  if (focal) pts.push([focal.lon, focal.lat]);
  for (const n of located) {
    if (n.lat != null && n.lon != null) pts.push([n.lon, n.lat]);
  }
  const first = pts[0];
  if (!first) return null;
  let [west, south] = first;
  let [east, north] = first;
  for (const [lng, lat] of pts) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [
    [west, south],
    [east, north],
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/components/map/neighbourLinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/map/neighbourLinks.ts tests/unit/renderer/components/map/neighbourLinks.test.ts
git commit -m "feat(neighbours): pure link-feature + fit-bounds builders for the map"
```

---

## Task 4: Parameterize `MapCanvas`

Add three optional props, each defaulting to today's exact behavior so the Map View is unchanged.

**Files:**
- Modify: `src/renderer/components/map/MapCanvas.tsx`

- [ ] **Step 1: Widen the props interface**

Replace the `MapCanvasProps` interface (lines 25–29) with:

```ts
interface MapCanvasProps {
  client: ApiClient;
  manifest: TileManifest;
  settings: MapSettings;
  // Optional overlay renderer — defaults to the standard clusters/local/info
  // stack. A focused view (e.g. repeater neighbours) passes its own layer.
  renderOverlays?: (map: MapLibreMap | null) => ReactNode;
  // When false, the moveend/zoom persistence effect is skipped (transient
  // sub-maps must not overwrite the Map View's saved viewport).
  persistViewport?: boolean;
  // Initial camera. Defaults to pickInitialView (persisted viewport / freshest
  // contact / extract centre).
  initialView?: InitialView;
}
```

Add the React type import at the top of the file (line 3 currently `import { useEffect, useRef, useState } from 'react';`):

```ts
import { type ReactNode, useEffect, useRef, useState } from 'react';
```

and change the prop type `(map: MapLibreMap | null) => React.ReactNode` to `(map: MapLibreMap | null) => ReactNode` to use the imported type.

- [ ] **Step 2: Destructure the new props with defaults**

Change the function signature (line 31):

```ts
export function MapCanvas({
  client,
  manifest,
  settings,
  renderOverlays,
  persistViewport = true,
  initialView,
}: MapCanvasProps) {
```

- [ ] **Step 3: Use `initialView` at mount**

In the mount-once effect, change the initial-view line (currently `const initial = pickInitialView(manifest, settings);`, line 60) to:

```ts
    const initial = initialView ?? pickInitialView(manifest, settings);
```

- [ ] **Step 4: Gate viewport persistence**

In the persistence effect (the one beginning `// Persist the viewport after the user stops interacting.`, around line 223), add an early-out right after `if (!map) return;`:

```ts
    const map = mapRef.current;
    if (!map) return;
    if (!persistViewport) return;
```

and add `persistViewport` to that effect's dependency array (currently `}, [client]);`):

```ts
  }, [client, persistViewport]);
```

- [ ] **Step 5: Replace the hardcoded overlay render**

Replace the JSX return (lines 271–278) with:

```tsx
  const overlays =
    renderOverlays ??
    ((map: MapLibreMap | null) => (
      <>
        <MapClusters map={map} />
        <MapLocalNode map={map} />
        <MapInfo map={map} />
      </>
    ));

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {overlays(mapInstance)}
    </div>
  );
```

- [ ] **Step 6: Verify typecheck, lint, and the existing suite**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors on `MapCanvas.tsx`.

Run: `pnpm test`
Expected: still passing (no regressions; baseline + the new pure tests from Tasks 1–3).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/map/MapCanvas.tsx
git commit -m "refactor(map): parameterize MapCanvas (overlays/persist/initialView), defaults unchanged"
```

---

## Task 5: `NeighbourMapLayer` overlay

Imperatively manages the signal-link layer + neighbour markers + focal marker on the live map, and renders the count banner. Mirrors the `MapClusters` install/diff pattern; reuses `buildContactMarker` for marker visuals.

**Files:**
- Create: `src/renderer/components/map/NeighbourMapLayer.tsx`

- [ ] **Step 1: Write the component**

Create `src/renderer/components/map/NeighbourMapLayer.tsx`:

```tsx
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import type { Contact } from '../../../shared/types';
import type { ResolvedNeighbour } from '../../lib/neighbours';
import {
  buildContactMarker,
  type MarkerState,
  syncMarkerVisual,
} from './markers/markerHtml';
import {
  buildNeighbourLinkFeatures,
  computeNeighbourBounds,
  type FocalPoint,
} from './neighbourLinks';

const LINK_SOURCE = 'neighbour-links';
const LINK_LAYER = 'neighbour-links';

interface FocalRepeater {
  lat: number;
  lon: number;
  name: string;
}

interface NeighbourMapLayerProps {
  map: MapLibreMap | null;
  focal: FocalRepeater;
  // All displayed neighbours (located + off-map). Only located ones are plotted.
  neighbours: ResolvedNeighbour[];
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

// Minimal Contact shape for the marker builder — it only reads name/kind/key.
function markerContact(n: ResolvedNeighbour): Contact {
  return {
    key: n.contactKey ?? `nb:${n.pubKeyPrefixHex}`,
    publicKeyHex: n.pubKeyPrefixHex,
    name: n.name,
    kind: 'repeater',
  } as Contact;
}

// Focal repeater marker — distinct double-ring + persistent label. Inline
// styles keep it self-contained (no extra CSS file).
function buildFocalElement(name: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.alignItems = 'center';
  el.style.gap = '4px';
  el.style.pointerEvents = 'none';
  el.innerHTML = `
    <svg width="50" height="50" viewBox="0 0 50 50" aria-hidden="true">
      <circle cx="25" cy="25" r="23" fill="none" stroke="#f59e0b" stroke-width="1" opacity="0.3" />
      <circle cx="25" cy="25" r="18" fill="none" stroke="#f59e0b" stroke-width="1.4" opacity="0.75" />
      <rect x="16" y="16" width="18" height="18" rx="3" fill="#84cc16" stroke="#0c0a06" stroke-width="1.5" />
    </svg>`;
  const label = document.createElement('span');
  label.textContent = name;
  label.style.background = 'rgba(12,10,6,0.92)';
  label.style.border = '1px solid #f59e0b';
  label.style.color = '#f5f1e6';
  label.style.font = '600 11px Inter, system-ui, sans-serif';
  label.style.padding = '3px 8px';
  label.style.borderRadius = '4px';
  label.style.whiteSpace = 'nowrap';
  label.style.boxShadow = '0 2px 8px rgba(0,0,0,.6)';
  el.appendChild(label);
  return el;
}

export function NeighbourMapLayer({
  map,
  focal,
  neighbours,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
}: NeighbourMapLayerProps) {
  const located = useMemo(
    () => neighbours.filter((n) => n.located && n.lat != null && n.lon != null),
    [neighbours],
  );
  const activeId = hoveredId ?? selectedId;
  const focalPoint: FocalPoint = { lat: focal.lat, lon: focal.lon };

  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const focalMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Read current selection inside the (create-once) marker click handler without
  // capturing a stale value.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const renderRef = useRef<() => void>(() => {});

  const stateFor = (id: string): MarkerState => ({
    selected: selectedId === id,
    faded: activeId != null && activeId !== id,
    stale: false,
    showLabel: false,
  });

  renderRef.current = () => {
    if (!map) return;

    const src = map.getSource(LINK_SOURCE) as GeoJSONSource | undefined;
    if (src) src.setData(buildNeighbourLinkFeatures(focalPoint, located, activeId));

    const markers = markersRef.current;
    const wanted = new Set<string>();
    for (const n of located) {
      const id = n.pubKeyPrefixHex;
      wanted.add(id);
      const lngLat: [number, number] = [n.lon as number, n.lat as number];
      const existing = markers.get(id);
      if (existing) {
        existing.setLngLat(lngLat);
        syncMarkerVisual(existing.getElement(), markerContact(n), stateFor(id), null);
      } else {
        const el = buildContactMarker(markerContact(n), stateFor(id));
        el.addEventListener('mouseenter', () => onHover(id));
        el.addEventListener('mouseleave', () => onHover(null));
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelect(selectedIdRef.current === id ? null : id);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(lngLat)
          .addTo(map);
        markers.set(id, marker);
      }
    }
    for (const [id, marker] of markers) {
      if (!wanted.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    if (!focalMarkerRef.current) {
      focalMarkerRef.current = new maplibregl.Marker({
        element: buildFocalElement(focal.name),
        anchor: 'center',
      })
        .setLngLat([focal.lon, focal.lat])
        .addTo(map);
    } else {
      focalMarkerRef.current.setLngLat([focal.lon, focal.lat]);
    }
  };

  // Install the link source + layer once the style is ready; retry on styledata
  // (also re-installs after setStyle theme flips, which wipe custom layers).
  useEffect(() => {
    if (!map) return;
    const install = () => {
      try {
        if (!map.getSource(LINK_SOURCE)) {
          map.addSource(LINK_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }
        if (!map.getLayer(LINK_LAYER)) {
          map.addLayer({
            id: LINK_LAYER,
            type: 'line',
            source: LINK_SOURCE,
            layout: { 'line-cap': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': ['get', 'width'],
              'line-opacity': ['get', 'opacity'],
              'line-dasharray': [2, 1.5],
            },
          });
        }
        renderRef.current();
      } catch {
        // Style not ready yet; the next styledata will re-attempt.
      }
    };
    install();
    map.on('styledata', install);
    return () => {
      map.off('styledata', install);
    };
  }, [map]);

  // Re-render markers + links when data or hover/selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderRef reads current values; these are triggers
  useEffect(() => {
    if (!map) return;
    renderRef.current();
  }, [map, located, selectedId, hoveredId, focal.lat, focal.lon, focal.name]);

  // Frame focal + located neighbours when the located SET (or focal) changes —
  // not on hover/select.
  const boundsKey = useMemo(
    () => `${located.map((n) => n.pubKeyPrefixHex).join(',')}|${focal.lat},${focal.lon}`,
    [located, focal.lat, focal.lon],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fit only when boundsKey changes
  useEffect(() => {
    if (!map) return;
    const bounds = computeNeighbourBounds(focalPoint, located);
    if (!bounds) return;
    const [[w, s], [e, n]] = bounds;
    if (w === e && s === n) {
      map.easeTo({ center: [w, s], zoom: Math.max(map.getZoom(), 12), duration: 300 });
    } else {
      map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 300 });
    }
  }, [map, boundsKey]);

  // Tear down markers + layer/source on unmount.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
      focalMarkerRef.current?.remove();
      focalMarkerRef.current = null;
      if (map) {
        if (map.getLayer(LINK_LAYER)) map.removeLayer(LINK_LAYER);
        if (map.getSource(LINK_SOURCE)) map.removeSource(LINK_SOURCE);
      }
    };
  }, [map]);

  if (neighbours.length === 0) return null;
  const offMap = neighbours.length - located.length;
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 5,
        padding: '6px 13px',
        borderRadius: 999,
        background: 'rgba(8,30,38,0.82)',
        border: '1px solid rgba(34,211,238,0.32)',
        color: '#9ddfeb',
        font: '12px Inter, system-ui, sans-serif',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 14px rgba(0,0,0,.4)',
        backdropFilter: 'blur(8px)',
      }}
    >
      Showing <b style={{ color: '#cdeef4' }}>{located.length}</b> of {neighbours.length} neighbours
      {offMap > 0 ? ` · ${offMap} off-map` : ''}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors on `NeighbourMapLayer.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/map/NeighbourMapLayer.tsx
git commit -m "feat(neighbours): NeighbourMapLayer (focal marker, SNR links, markers, banner)"
```

---

## Task 6: `NeighbourList` right pane

Controls (Order/Count/Fetch) + header + located/off-map grouped rows. Reuses `SignalBars`/`fmtSnr`/`snrTokenVar` and `MarkerShape`.

**Files:**
- Create: `src/renderer/panels/repeater-admin/neighbours/NeighbourList.tsx`

- [ ] **Step 1: Write the component**

Create `src/renderer/panels/repeater-admin/neighbours/NeighbourList.tsx`:

```tsx
import { MapPinOff } from 'lucide-react';
import { MarkerShape } from '../../../components/map/markers/MarkerShape';
import { fmtSnr, SignalBars, snrTokenVar } from '../../../components/path/SignalBars';
import {
  NEIGHBOUR_SORTS,
  type NeighbourSortKey,
  type ResolvedNeighbour,
} from '../../../lib/neighbours';

interface NeighbourListProps {
  neighbours: ResolvedNeighbour[]; // already resolved, sorted, and count-sliced
  total: number; // page.total reported by the firmware
  mapShown: boolean;
  sortKey: NeighbourSortKey;
  count: number;
  busy: boolean;
  hasFetched: boolean;
  onSort: (k: NeighbourSortKey) => void;
  onCount: (n: number) => void;
  onFetch: () => void;
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

function fmtSecsAgo(s: number): string {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function NeighbourRow({
  n,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  n: ResolvedNeighbour;
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}) {
  const unknown = n.nameSource === 'unknown';
  const bg = selected ? 'bg-cs-accent-soft/10' : hovered ? 'bg-cs-bg-3' : '';
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(n.pubKeyPrefixHex)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(selected ? null : n.pubKeyPrefixHex)}
      className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${bg} ${
        selected ? 'border-l-2 border-cs-accent' : 'border-l-2 border-transparent'
      }`}
    >
      <span className="shrink-0" style={{ opacity: n.located ? 1 : 0.55 }}>
        <MarkerShape type="repeater" size={22} opacity={unknown ? 0.5 : 1} dashed={unknown} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`truncate text-[13px] ${
              unknown ? 'font-normal italic text-cs-text-dim' : 'font-medium text-cs-text'
            }`}
          >
            {n.name}
          </span>
          {n.nameSource === 'contacts' && (
            <span title="Name resolved from contacts" className="shrink-0 text-cs-text-dim">
              ◇
            </span>
          )}
          {n.ambiguous && (
            <span title="Prefix matches more than one contact — best guess" className="shrink-0 text-cs-warn">
              ⚠
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-cs-text-dim">
          <span className="truncate">{n.pubKeyPrefixHex}</span>
          <span className="opacity-50">·</span>
          <span className="shrink-0">{fmtSecsAgo(n.heardSecsAgo)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <SignalBars snr={n.snrDb} size={13} />
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: `rgb(var(${snrTokenVar(n.snrDb)}))` }}
        >
          {fmtSnr(n.snrDb)}
        </span>
      </span>
    </button>
  );
}

export function NeighbourList({
  neighbours,
  total,
  mapShown,
  sortKey,
  count,
  busy,
  hasFetched,
  onSort,
  onCount,
  onFetch,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
}: NeighbourListProps) {
  const located = mapShown ? neighbours.filter((n) => n.located) : [];
  const locatedIds = new Set(located.map((n) => n.pubKeyPrefixHex));
  const offMap = neighbours.filter((n) => !locatedIds.has(n.pubKeyPrefixHex));

  const fieldCls =
    'h-8 rounded-md border border-cs-border bg-cs-bg-3 px-2.5 font-mono text-[12.5px] text-cs-text outline-none';

  return (
    <div className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-cs-border bg-cs-bg-2">
      {/* Controls */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-cs-border p-3.5">
        <label className="flex flex-col gap-1 text-[11.5px] text-cs-text-muted">
          Order
          <select
            value={sortKey}
            onChange={(e) => onSort(e.target.value as NeighbourSortKey)}
            className={`${fieldCls} cursor-pointer`}
          >
            {Object.entries(NEIGHBOUR_SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2.5">
          <label className="flex w-[70px] shrink-0 flex-col gap-1 text-[11.5px] text-cs-text-muted">
            Count
            <input
              type="number"
              min={1}
              max={64}
              value={count}
              onChange={(e) => onCount(Number(e.target.value) || 16)}
              className={fieldCls}
            />
          </label>
          <button
            type="button"
            onClick={onFetch}
            disabled={busy}
            className="h-8 flex-1 rounded-md border border-cs-border bg-cs-bg-3 text-[12.5px] font-medium text-cs-text transition-colors hover:bg-cs-accent-soft/30 disabled:opacity-50"
          >
            {busy ? 'Fetching…' : 'Fetch neighbours'}
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-cs-border px-3.5 py-2.5">
        <span className="font-mono text-[10px] tracking-widest text-cs-text-dim">NEIGHBOURS</span>
        <span className="font-mono text-[10.5px] text-cs-text-muted">
          {mapShown ? `${located.length} on map · ` : ''}
          {neighbours.length} of {total} heard
        </span>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasFetched ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
            <span className="text-[13px] text-cs-text-muted">No neighbours loaded</span>
            <span className="text-[11px] text-cs-text-dim">Press “Fetch neighbours” to query the repeater.</span>
          </div>
        ) : (
          <>
            {located.map((n) => (
              <NeighbourRow
                key={n.pubKeyPrefixHex}
                n={n}
                selected={selectedId === n.pubKeyPrefixHex}
                hovered={hoveredId === n.pubKeyPrefixHex}
                onHover={onHover}
                onSelect={onSelect}
              />
            ))}
            {offMap.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-3 font-mono text-[9.5px] uppercase tracking-wider text-cs-text-dim">
                  <MapPinOff size={11} aria-hidden="true" />
                  <span className="flex-1">No location advert</span>
                  <span>{offMap.length}</span>
                </div>
                {offMap.map((n) => (
                  <NeighbourRow
                    key={n.pubKeyPrefixHex}
                    n={n}
                    selected={selectedId === n.pubKeyPrefixHex}
                    hovered={hoveredId === n.pubKeyPrefixHex}
                    onHover={onHover}
                    onSelect={onSelect}
                  />
                ))}
              </>
            )}
            <div className="h-2" />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors on `NeighbourList.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/panels/repeater-admin/neighbours/NeighbourList.tsx
git commit -m "feat(neighbours): right-pane list (controls, grouped rows, SNR readout)"
```

---

## Task 7: Rewrite `NeighboursTab`

Compose the map + list split, lift state, wire client-side Order/Count + manual Fetch, and the no-map fallbacks.

**Files:**
- Modify (full rewrite): `src/renderer/panels/repeater-admin/NeighboursTab.tsx`

- [ ] **Step 1: Replace the file contents**

Overwrite `src/renderer/panels/repeater-admin/NeighboursTab.tsx` with:

```tsx
import { MapPinOff, MapIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { hasValidFix } from '../../../shared/types';
import type { Contact, RepeaterNeighboursPage } from '../../../shared/types';
import { logError, MapErrorFallback } from '../../components/errors/ErrorFallback';
import { MapCanvas } from '../../components/map/MapCanvas';
import { NeighbourMapLayer } from '../../components/map/NeighbourMapLayer';
import { type ApiClient, api } from '../../lib/api';
import {
  type NeighbourSortKey,
  resolveNeighbours,
  sortNeighbours,
} from '../../lib/neighbours';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { NeighbourList } from './neighbours/NeighbourList';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

// Client Order key -> firmware orderBy byte for the fetch window
// (0=newest, 1=oldest, 2=strongest SNR, 3=weakest). 'name' has no firmware
// equivalent, so fetch the strongest window.
const ORDER_BY_FOR_SORT: Record<NeighbourSortKey, number> = {
  'snr-desc': 2,
  'snr-asc': 3,
  recent: 0,
  oldest: 1,
  name: 2,
};

function MapPlaceholder({ icon, text }: { icon: 'no-gps' | 'no-tiles'; text: string }) {
  const Icon = icon === 'no-gps' ? MapPinOff : MapIcon;
  return (
    <div className="flex h-full w-full items-center justify-center bg-cs-bg p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Icon className="h-7 w-7 text-cs-text-dim" aria-hidden="true" />
        <p className="max-w-xs text-sm text-cs-text-muted">{text}</p>
      </div>
    </div>
  );
}

export function NeighboursTab({ contact, client }: Props) {
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const manifest = useStore((s) => s.mapManifest);
  const settings = useStore((s) => s.mapSettings);

  const [page, setPage] = useState<RepeaterNeighboursPage | null>(null);
  const [sortKey, setSortKey] = useState<NeighbourSortKey>('snr-desc');
  const [count, setCount] = useState(16);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const focalLocated = hasValidFix(contact);
  const tilesOk = !manifest.missing && !!manifest.basemap;
  const mapShown = focalLocated && tilesOk && !!client;

  // Resolve -> sort -> count-slice. Map and list share the same displayed set.
  const displayed = useMemo(() => {
    if (!page) return [];
    const resolved = resolveNeighbours(page.neighbours, contacts, discovered);
    return sortNeighbours(resolved, sortKey).slice(0, count);
  }, [page, contacts, discovered, sortKey, count]);

  const load = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const res = await api.repeaterNeighbours(client, contact.key, {
        count,
        orderBy: ORDER_BY_FOR_SORT[sortKey],
        prefixLen: 6,
      });
      setPage(res.page);
    } catch (err) {
      notify.error(`Neighbours fetch failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Map (hero) */}
      <div className="relative min-w-0 flex-1">
        {mapShown && client ? (
          <ErrorBoundary FallbackComponent={MapErrorFallback} onError={logError}>
            <MapCanvas
              client={client}
              manifest={manifest}
              settings={settings}
              persistViewport={false}
              initialView={{
                center: [contact.gpsLon as number, contact.gpsLat as number],
                zoom: 12,
                bearing: 0,
                pitch: 0,
              }}
              renderOverlays={(map) => (
                <NeighbourMapLayer
                  map={map}
                  focal={{
                    lat: contact.gpsLat as number,
                    lon: contact.gpsLon as number,
                    name: contact.name,
                  }}
                  neighbours={displayed}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  onHover={setHoveredId}
                  onSelect={setSelectedId}
                />
              )}
            />
          </ErrorBoundary>
        ) : !tilesOk ? (
          <MapPlaceholder icon="no-tiles" text="Map tiles not installed — the neighbour list is still available." />
        ) : (
          <MapPlaceholder
            icon="no-gps"
            text="No location for this repeater. Neighbours are listed on the right; none can be plotted."
          />
        )}
      </div>

      {/* List */}
      <NeighbourList
        neighbours={displayed}
        total={page?.total ?? 0}
        mapShown={mapShown}
        sortKey={sortKey}
        count={count}
        busy={busy}
        hasFetched={page !== null}
        onSort={setSortKey}
        onCount={setCount}
        onFetch={load}
        selectedId={selectedId}
        hoveredId={hoveredId}
        onHover={setHoveredId}
        onSelect={setSelectedId}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck`
Expected: no errors. (If Biome flags import ordering in the rewritten file, run `pnpm lint` to see the exact fix and reorder.)

Run: `pnpm lint`
Expected: no errors on `NeighboursTab.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/panels/repeater-admin/NeighboursTab.tsx
git commit -m "feat(neighbours): map+list Neighbours tab (client-side order/count, manual fetch)"
```

---

## Task 8: Full verification + manual smoke test

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit + integration suite**

Run: `pnpm test`
Expected: PASS — 150 baseline + the new pure tests from Tasks 1–3 (≈11 added), 0 failures.

- [ ] **Step 2: Typecheck and lint the whole project**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke test (documented; requires a connected radio + a repeater you can log into)**

Launch the app, open a repeater's admin panel, switch to the **Neighbours** tab, and confirm:
- Before fetching: list shows "No neighbours loaded / Press Fetch"; map shows the focal repeater (if it has GPS) or the appropriate placeholder.
- Press **Fetch neighbours**: located neighbours plot with SNR-coloured dashed links to the focal marker; the count banner reads "Showing N of M neighbours · K off-map".
- **Order** and **Count** re-sort/re-slice instantly with **no** network round-trip; only **Fetch** queries the radio.
- Hovering a list row highlights its marker + link (and vice-versa); clicking selects (dims the rest).
- Off-map / Unknown neighbours appear under "No location advert" with the dashed avatar; a contacts-resolved name shows the ◇ glyph; an ambiguous match shows ⚠.
- A repeater with no GPS shows the placeholder + every neighbour in the off-map group.

If no radio is available, note this step as skipped (cannot be automated — no e2e harness for live-radio repeater admin).

- [ ] **Step 4: Final commit (if any lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(neighbours): final verification touch-ups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Map+list split, map hero, controls in right pane → Task 7 + 6.
- `resolveNeighbours` (protocol→contacts→Unknown, ambiguity best-guess+flag, located/off-map) → Task 2.
- Parameterized `MapCanvas` (renderOverlays/persistViewport/initialView, defaults preserved) → Task 4.
- `NeighbourMapLayer` (focal marker, SNR-coloured links, Chip markers, **no labels**, count banner, no-GPS placeholder via Task 7) → Task 5 + 7.
- SNR reuse (`SignalBars`/`fmtSnr`) + `snrColor` for map → Task 1 + 6.
- Client-side Order/Count, manual-only Fetch, no auto-fetch → Task 7.
- Off-map group + sparse-remote-map as first-class state → Task 6 (`mapShown` forces all to off-map when no focal GPS) + Task 7 placeholders.
- Marker reuse (`buildContactMarker`/`MarkerShape`) → Task 5 + 6.
- Tests: pure units for resolve/sort/links/snrColor → Tasks 1–3; React wiring via typecheck/lint + manual → Tasks 4–8.

**Type consistency:** `ResolvedNeighbour`, `NeighbourSortKey`, `FocalPoint`, `MarkerState`, `RepeaterNeighboursPage`, `snrColor`/`snrBand`/`fmtSnr`/`snrTokenVar`, `buildContactMarker`/`syncMarkerVisual`, `MarkerShape` props, and `MapCanvas` props are used identically across tasks (verified against the real source signatures).

**No placeholders:** every code step contains complete code; every command lists its expected result.
