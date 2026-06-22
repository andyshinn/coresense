# Custom Macros & Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a LiquidJS-based custom-macro subsystem: a Node-free engine core in `src/shared/macros/` (security-first config, `distance`/`bearing`/`unit` filters, variable manifest, validation) plus the persistent store, device-state context builder, and HTTP API in `src/main/macros/`, all covered by Vitest tests.

**Architecture:** Pure engine core (`src/shared/macros/`) is importable by both processes. The main process owns the persistent `macros.json` store, builds the serializable `MacroContext` from device state, and exposes CRUD + render/validate/manifest over the existing Hono API. The renderer gets API client methods and a state slice for the future UI. No UI components and no send-path wiring are built here.

**Tech Stack:** TypeScript, LiquidJS (new dependency), Electron (main/renderer split), Hono (HTTP), Zustand (renderer state), Vitest (`unit` / `integration` / `dom` projects), Biome (lint/format), pnpm.

**Reference spec:** `docs/superpowers/specs/2026-06-21-custom-macros-design.md`

## Global Constraints

- **Engine core is Node-free.** Nothing under `src/shared/macros/` may import `node:*` or `@andyshinn/meshcore-ts`. Only `liquidjs` and local modules.
- **LiquidJS engine config (non-negotiable):** `ownPropertyOnly: true`, `strictVariables: true`, `strictFilters: true`, `renderLimit: 1000` (ms), `parseLimit: 10000`, `memoryLimit: 10000000`. All overridable per render.
- **Rendering never throws.** `renderTemplate` / `renderMacro` always return a `RenderResult` (`{ ok: true, text }` or `{ ok: false, error }`).
- **Placeholder, not blanks.** Known-but-empty variables render a configurable placeholder (default `?`). Unknown variable names are an error.
- **Variable/filter names are the public contract** consumed by the future UI's manifest — use the exact names in this plan.
- **Earth radius:** `6371008.8` m (mean).
- **Test placement:** pure core + pure builders → `tests/unit/macros/*.test.ts`; anything touching settings/filesystem/`stateHolder`/Hono → `tests/integration/**/*.test.ts`; renderer (store/api) → `tests/component/*.test.tsx`.
- **Lint scope:** never run repo-wide lint. Run `pnpm biome check --write <changed files>` before each commit (repo-wide `pnpm lint` fails on pre-existing build artifacts).
- **Commit cadence:** one commit per task. End every commit message with the `Co-Authored-By` trailer used on the spec commit.

## File Structure

```
src/shared/macros/
  types.ts          # all macro types (no runtime deps)
  geo.ts            # haversineMeters, initialBearingDeg, compassPoint (pure)
  placeholder.ts    # PlaceholderDrop (extends liquid Drop), isPlaceholder
  filters.ts        # distanceValue/bearingText/unitText/normalizeUnit (pure) + registerMacroFilters
  engine.ts         # createMacroEngine(opts) + limit constants
  manifest.ts       # MACRO_VARIABLES, MACRO_FILTERS, getManifest, buildSampleContext
  render.ts         # renderTemplate + error classifiers (exported for validate)
  validate.ts       # validateTemplate(template)
  index.ts          # public surface

src/main/macros/
  store.ts          # macrosStore CRUD over macros.json + MacroValidationError
  contextBuilder.ts # buildReplyContext / buildSendContext
  service.ts        # renderMacro(idOrTemplate, context, opts) — engine from settings

Modified:
  src/shared/types.ts            # AppSettings.distanceUnit (+default); WsMessage 'macros'
  src/main/storage/settings.ts   # FILES.macros + loadMacros/saveMacros
  src/main/events/bus.ts         # emit.macros + BusEvents.macros
  src/main/server.ts             # onMacros broadcast wiring
  src/main/api/routes.ts         # /api/macros CRUD + manifest/validate/render
  src/renderer/lib/api.ts        # macro client methods
  src/renderer/lib/store.ts      # macros slice + applyMacros
  src/renderer/app/wsHandlers.ts # 'macros' case
  package.json                   # liquidjs dependency
```

---

## Setup (run once before Task 1)

- [ ] **Install dependencies and confirm a clean baseline.**

```bash
cd "$(git rev-parse --show-toplevel)"   # the worktree root
pnpm install
pnpm test
```
Expected: install completes; `pnpm test` reports all existing suites passing (0 failures). If anything fails before any changes, stop and report.

---

## Task 1: Geo math (`geo.ts`)

Pure great-circle helpers with no Liquid or Node dependency.

**Files:**
- Create: `src/shared/macros/geo.ts`
- Test: `tests/unit/macros/geo.test.ts`

**Interfaces:**
- Produces:
  - `interface LatLon { lat: number; lon: number }`
  - `haversineMeters(a: LatLon, b: LatLon): number`
  - `initialBearingDeg(a: LatLon, b: LatLon): number` (0–360)
  - `compassPoint(deg: number): string` (16-point)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/macros/geo.test.ts
import { describe, expect, it } from 'vitest';
import { compassPoint, haversineMeters, initialBearingDeg } from '../../../src/shared/macros/geo';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
  });
  it('equals one degree of arc at the equator', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111194.9, 0);
  });
  it('handles a sub-kilometre distance', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 })).toBeCloseTo(111.19, 1);
  });
  it('handles a near-antipodal distance', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6371008.8, 0);
  });
});

describe('initialBearingDeg', () => {
  it('points north', () => expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 5));
  it('points east', () => expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 5));
  it('points south', () => expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 5));
  it('points west', () => expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 5));
});

describe('compassPoint', () => {
  it('maps cardinals and an intercardinal', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
    expect(compassPoint(247)).toBe('WSW');
    expect(compassPoint(360)).toBe('N');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/macros/geo.test.ts`
Expected: FAIL — cannot resolve `../../../src/shared/macros/geo`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/macros/geo.ts
export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6371008.8; // mean Earth radius (metres)
const toRad = (d: number): number => (d * Math.PI) / 180;

export function haversineMeters(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lon - a.lon);
  const s = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function initialBearingDeg(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lon - a.lon);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return POINTS[idx];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/macros/geo.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/shared/macros/geo.ts tests/unit/macros/geo.test.ts
git add src/shared/macros/geo.ts tests/unit/macros/geo.test.ts
git commit -m "feat(macros): great-circle geo helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Macro types + manifest (`types.ts`, `manifest.ts`)

Defines every macro type and the static variable/filter manifest plus a fully-populated sample context (reused by validation).

**Files:**
- Create: `src/shared/macros/types.ts`, `src/shared/macros/manifest.ts`
- Test: `tests/unit/macros/manifest.test.ts`

**Interfaces:**
- Produces (from `types.ts`): `DistanceUnit`, `MacroPosition`, `MacroPathHop`, `MacroPath`, `MacroContext`, `MacroScope`, `MacroTemplate`, `MacroVarAvailability`, `MacroVariable`, `MacroFilterDoc`, `MacroManifest`, `MacroErrorKind`, `MacroError`, `RenderResult`, `ValidateResult`, `RenderOptions`.
- Produces (from `manifest.ts`): `MACRO_VARIABLES: MacroVariable[]`, `MACRO_FILTERS: MacroFilterDoc[]`, `getManifest(): MacroManifest`, `buildSampleContext(): MacroContext`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/macros/manifest.test.ts
import { describe, expect, it } from 'vitest';
import { buildSampleContext, getManifest, MACRO_VARIABLES } from '../../../src/shared/macros/manifest';

describe('macro manifest', () => {
  it('exposes core variables with availability', () => {
    const names = MACRO_VARIABLES.map((v) => v.name);
    expect(names).toEqual(expect.arrayContaining(['my_pos', 'peer_name', 'rssi', 'paths']));
    expect(MACRO_VARIABLES.find((v) => v.name === 'my_pos')?.available).toBe('always');
    expect(MACRO_VARIABLES.find((v) => v.name === 'rssi')?.available).toBe('reply');
  });

  it('lists the custom filters', () => {
    expect(getManifest().filters.map((f) => f.name)).toEqual(expect.arrayContaining(['distance', 'bearing', 'unit']));
  });

  it('sample context populates every manifest variable (no nulls)', () => {
    const ctx = buildSampleContext() as Record<string, unknown>;
    for (const v of MACRO_VARIABLES) {
      expect(ctx[v.name], `${v.name} should be populated`).not.toBeNull();
      expect(ctx[v.name], `${v.name} should be defined`).not.toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/macros/manifest.test.ts`
Expected: FAIL — cannot resolve `manifest`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/macros/types.ts
export type DistanceUnit = 'metric' | 'imperial';

export interface MacroPosition {
  lat: number;
  lon: number;
}

export interface MacroPathHop {
  kind: 'origin' | 'hop' | 'sink';
  short_id: string;
  name: string | null;
  pk: string | null;
}

export interface MacroPath {
  id: string;
  length: number;
  hash_mode: number;
  final_snr: number;
  hops: MacroPathHop[];
}

export interface MacroContext {
  // always available
  my_name: string | null;
  my_callsign: string | null;
  my_id: string | null;
  my_pubkey: string | null;
  my_pos: MacroPosition | null;
  my_battery_mv: number | null;
  my_battery_v: number | null;
  channel: string | null;
  peer_name: string | null;
  peer_id: string | null;
  peer_pos: MacroPosition | null;
  peer_last_seen: number | null;
  peer_rssi: number | null;
  peer_snr: number | null;
  peer_hops: number | null;
  // reply-only
  message_body: string | null;
  msg_time: number | null;
  received_ago: string | null;
  sender_name: string | null;
  sender_id: string | null;
  sender_pos: MacroPosition | null;
  rssi: number | null;
  snr: number | null;
  hops: number | null;
  times_heard: number | null;
  paths: MacroPath[];
}

export type MacroScope = 'global' | 'channel' | 'contact';

export interface MacroTemplate {
  id: string;
  name: string;
  template: string;
  scope: MacroScope;
  channelKey?: string;
  contactKey?: string;
  createdAt: number;
  updatedAt: number;
}

export type MacroVarAvailability = 'always' | 'reply';

export interface MacroVariable {
  name: string;
  description: string;
  type: 'string' | 'number' | 'position' | 'array' | 'boolean';
  example: string;
  available: MacroVarAvailability;
}

export interface MacroFilterDoc {
  name: string;
  description: string;
  signature: string;
  example: string;
}

export interface MacroManifest {
  variables: MacroVariable[];
  filters: MacroFilterDoc[];
}

export type MacroErrorKind = 'parse' | 'unknown-filter' | 'unknown-variable' | 'timeout' | 'render';

export interface MacroError {
  kind: MacroErrorKind;
  message: string;
  name?: string;
  line?: number;
  col?: number;
}

export type RenderResult = { ok: true; text: string } | { ok: false; error: MacroError };
export type ValidateResult = { ok: true } | { ok: false; errors: MacroError[] };

export interface RenderOptions {
  placeholder?: string;
  renderLimit?: number;
}
```

```ts
// src/shared/macros/manifest.ts
import type { MacroContext, MacroFilterDoc, MacroManifest, MacroVariable } from './types';

export const MACRO_VARIABLES: MacroVariable[] = [
  { name: 'my_name', description: 'Your node name', type: 'string', example: 'N0CALL', available: 'always' },
  { name: 'my_callsign', description: 'Alias of my_name', type: 'string', example: 'N0CALL', available: 'always' },
  { name: 'my_id', description: 'Your short public-key id', type: 'string', example: 'a1b2c3d4', available: 'always' },
  { name: 'my_pubkey', description: 'Your full public key', type: 'string', example: 'a1b2c3d4...', available: 'always' },
  { name: 'my_pos', description: 'Your position {lat, lon}', type: 'position', example: '{{ my_pos.lat }}', available: 'always' },
  { name: 'my_battery_mv', description: 'Your battery in millivolts', type: 'number', example: '4100', available: 'always' },
  { name: 'my_battery_v', description: 'Your battery in volts', type: 'number', example: '4.1', available: 'always' },
  { name: 'channel', description: 'Active channel name (empty in a DM)', type: 'string', example: 'General', available: 'always' },
  { name: 'peer_name', description: 'The contact you are addressing', type: 'string', example: 'Alice', available: 'always' },
  { name: 'peer_id', description: "The peer's public key", type: 'string', example: 'abcd...', available: 'always' },
  { name: 'peer_pos', description: "The peer's last position {lat, lon}", type: 'position', example: '{{ peer_pos.lat }}', available: 'always' },
  { name: 'peer_last_seen', description: 'Epoch ms the peer was last heard', type: 'number', example: '1700000000000', available: 'always' },
  { name: 'peer_rssi', description: "The peer's last-heard RSSI", type: 'number', example: '-80', available: 'always' },
  { name: 'peer_snr', description: "The peer's last-heard SNR", type: 'number', example: '7', available: 'always' },
  { name: 'peer_hops', description: "The peer's last-heard hop count", type: 'number', example: '1', available: 'always' },
  { name: 'message_body', description: 'The replied-to message text', type: 'string', example: 'hello', available: 'reply' },
  { name: 'msg_time', description: 'Epoch ms of the replied-to message', type: 'number', example: '1700000000000', available: 'reply' },
  { name: 'received_ago', description: 'Humanised time since the message', type: 'string', example: '5m', available: 'reply' },
  { name: 'sender_name', description: 'Message author name', type: 'string', example: 'Alice', available: 'reply' },
  { name: 'sender_id', description: 'Message author public key', type: 'string', example: 'abcd...', available: 'reply' },
  { name: 'sender_pos', description: "Message author's position {lat, lon}", type: 'position', example: '{{ sender_pos.lat }}', available: 'reply' },
  { name: 'rssi', description: "This message's RSSI", type: 'number', example: '-95', available: 'reply' },
  { name: 'snr', description: "This message's SNR", type: 'number', example: '5.5', available: 'reply' },
  { name: 'hops', description: "This message's hop count", type: 'number', example: '2', available: 'reply' },
  { name: 'times_heard', description: 'Distinct receptions merged', type: 'number', example: '3', available: 'reply' },
  { name: 'paths', description: 'Relay paths this message took', type: 'array', example: '{{ paths | size }}', available: 'reply' },
];

export const MACRO_FILTERS: MacroFilterDoc[] = [
  { name: 'distance', description: 'Great-circle distance in metres between two positions', signature: '{{ a | distance: b }}', example: '{{ my_pos | distance: peer_pos }}' },
  { name: 'bearing', description: 'Initial bearing as degrees + compass point', signature: '{{ a | bearing: b }}', example: '{{ my_pos | bearing: peer_pos }}' },
  { name: 'unit', description: 'Format metres as km/mi (auto sub-unit)', signature: "{{ metres | unit: 'km' }}", example: '{{ my_pos | distance: peer_pos | unit }}' },
];

export function getManifest(): MacroManifest {
  return { variables: MACRO_VARIABLES, filters: MACRO_FILTERS };
}

export function buildSampleContext(): MacroContext {
  return {
    my_name: 'N0CALL',
    my_callsign: 'N0CALL',
    my_id: 'a1b2c3d4',
    my_pubkey: 'a1b2c3d4e5f6',
    my_pos: { lat: 37.7749, lon: -122.4194 },
    my_battery_mv: 4100,
    my_battery_v: 4.1,
    channel: 'General',
    peer_name: 'Alice',
    peer_id: 'c0ffee00',
    peer_pos: { lat: 37.8044, lon: -122.2712 },
    peer_last_seen: 1700000000000,
    peer_rssi: -80,
    peer_snr: 7,
    peer_hops: 1,
    message_body: 'hello there',
    msg_time: 1700000000000,
    received_ago: '5m',
    sender_name: 'Alice',
    sender_id: 'c0ffee00',
    sender_pos: { lat: 37.8044, lon: -122.2712 },
    rssi: -95,
    snr: 5.5,
    hops: 2,
    times_heard: 3,
    paths: [
      {
        id: 'p1',
        length: 2,
        hash_mode: 1,
        final_snr: 6.5,
        hops: [
          { kind: 'origin', short_id: 'aa', name: 'Alice', pk: 'c0ffee00' },
          { kind: 'sink', short_id: 'bb', name: 'Me', pk: 'a1b2c3d4e5f6' },
        ],
      },
    ],
  };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run tests/unit/macros/manifest.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/shared/macros/types.ts src/shared/macros/manifest.ts tests/unit/macros/manifest.test.ts
git add src/shared/macros/types.ts src/shared/macros/manifest.ts tests/unit/macros/manifest.test.ts
git commit -m "feat(macros): types + variable/filter manifest + sample context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: LiquidJS dependency + placeholder + filters (`placeholder.ts`, `filters.ts`)

Adds `liquidjs`, the placeholder drop, and the pure filter math + filter registration.

**Files:**
- Modify: `package.json` (via `pnpm add liquidjs`)
- Create: `src/shared/macros/placeholder.ts`, `src/shared/macros/filters.ts`
- Test: `tests/unit/macros/filters.test.ts`

**Interfaces:**
- Consumes: `geo.ts` (`haversineMeters`, `initialBearingDeg`, `compassPoint`), `types.ts` (`DistanceUnit`).
- Produces (from `placeholder.ts`): `class PlaceholderDrop extends Drop` (ctor `(text: string)`), `isPlaceholder(v: unknown): v is PlaceholderDrop`.
- Produces (from `filters.ts`):
  - `normalizeUnit(u: string): 'km' | 'mi'`
  - `distanceValue(a: unknown, b: unknown): number | null`
  - `bearingText(a: unknown, b: unknown): string | null`
  - `unitText(meters: number, unit: 'km' | 'mi'): string`
  - `registerMacroFilters(engine: Liquid, opts: { defaultDistanceUnit: DistanceUnit }): void`

- [ ] **Step 1: Add the dependency**

Run: `pnpm add liquidjs`
Expected: `liquidjs` appears under `dependencies` in `package.json`; lockfile updated. (Network access required — approve the sandbox prompt if shown.)

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/macros/filters.test.ts
import { describe, expect, it } from 'vitest';
import { bearingText, distanceValue, normalizeUnit, unitText } from '../../../src/shared/macros/filters';

describe('distanceValue', () => {
  it('returns metres for two valid positions', () => {
    expect(distanceValue({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111194.9, 0);
  });
  it('returns null when a position is missing/invalid', () => {
    expect(distanceValue(null, { lat: 0, lon: 1 })).toBeNull();
    expect(distanceValue({ lat: 0, lon: 0 }, { lat: 999, lon: 0 })).toBeNull();
  });
});

describe('bearingText', () => {
  it('formats degrees + compass point', () => {
    expect(bearingText({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBe('90° E');
  });
  it('returns null on invalid input', () => {
    expect(bearingText({ lat: 0, lon: 0 }, null)).toBeNull();
  });
});

describe('normalizeUnit', () => {
  it('maps metric/imperial and passthrough', () => {
    expect(normalizeUnit('metric')).toBe('km');
    expect(normalizeUnit('imperial')).toBe('mi');
    expect(normalizeUnit('km')).toBe('km');
    expect(normalizeUnit('mi')).toBe('mi');
  });
});

describe('unitText', () => {
  it('metric: sub-km shows metres, else km', () => {
    expect(unitText(0, 'km')).toBe('0 m');
    expect(unitText(999, 'km')).toBe('999 m');
    expect(unitText(1000, 'km')).toBe('1.0 km');
    expect(unitText(1500, 'km')).toBe('1.5 km');
  });
  it('imperial: sub-mile shows feet, else miles', () => {
    expect(unitText(100, 'mi')).toBe('328 ft');
    expect(unitText(1609.344, 'mi')).toBe('1.0 mi');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/macros/filters.test.ts`
Expected: FAIL — cannot resolve `filters`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/shared/macros/placeholder.ts
import { Drop } from 'liquidjs';

export class PlaceholderDrop extends Drop {
  constructor(public readonly text: string) {
    super();
  }
  // Any property access on an empty value resolves to the placeholder text.
  liquidMethodMissing(): unknown {
    return this.text;
  }
  valueOf(): string {
    return this.text;
  }
  toString(): string {
    return this.text;
  }
}

export function isPlaceholder(v: unknown): v is PlaceholderDrop {
  return v instanceof PlaceholderDrop;
}
```

```ts
// src/shared/macros/filters.ts
import type { Liquid } from 'liquidjs';
import { compassPoint, haversineMeters, initialBearingDeg, type LatLon } from './geo';
import { isPlaceholder } from './placeholder';
import type { DistanceUnit } from './types';

function asPosition(v: unknown): LatLon | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as { lat?: unknown; lon?: unknown };
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return null;
  return { lat: p.lat, lon: p.lon };
}

export function normalizeUnit(u: string): 'km' | 'mi' {
  if (u === 'imperial' || u === 'mi') return 'mi';
  return 'km';
}

export function distanceValue(a: unknown, b: unknown): number | null {
  const pa = asPosition(a);
  const pb = asPosition(b);
  if (!pa || !pb) return null;
  return haversineMeters(pa, pb);
}

export function bearingText(a: unknown, b: unknown): string | null {
  const pa = asPosition(a);
  const pb = asPosition(b);
  if (!pa || !pb) return null;
  const deg = initialBearingDeg(pa, pb);
  return `${Math.round(deg)}° ${compassPoint(deg)}`;
}

export function unitText(meters: number, unit: 'km' | 'mi'): string {
  if (unit === 'mi') {
    const miles = meters / 1609.344;
    if (miles < 1) return `${Math.round(meters * 3.28084)} ft`;
    return `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function registerMacroFilters(engine: Liquid, opts: { defaultDistanceUnit: DistanceUnit }): void {
  const def = normalizeUnit(opts.defaultDistanceUnit);

  engine.registerFilter('distance', (a: unknown, b: unknown) => {
    if (isPlaceholder(a)) return a;
    if (isPlaceholder(b)) return b;
    return distanceValue(a, b);
  });

  engine.registerFilter('bearing', (a: unknown, b: unknown) => {
    if (isPlaceholder(a)) return a;
    if (isPlaceholder(b)) return b;
    return bearingText(a, b);
  });

  engine.registerFilter('unit', (value: unknown, unitArg?: unknown) => {
    if (isPlaceholder(value)) return value;
    const meters = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(meters)) return null;
    const unit = typeof unitArg === 'string' ? normalizeUnit(unitArg) : def;
    return unitText(meters, unit);
  });
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm vitest run tests/unit/macros/filters.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
pnpm biome check --write src/shared/macros/placeholder.ts src/shared/macros/filters.ts tests/unit/macros/filters.test.ts
git add package.json pnpm-lock.yaml src/shared/macros/placeholder.ts src/shared/macros/filters.ts tests/unit/macros/filters.test.ts
git commit -m "feat(macros): add liquidjs, placeholder drop, distance/bearing/unit filters

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Engine factory (`engine.ts`)

Builds a security-hardened LiquidJS engine with the macro filters registered.

**Files:**
- Create: `src/shared/macros/engine.ts`
- Test: `tests/unit/macros/engine.test.ts`

**Interfaces:**
- Consumes: `filters.ts` (`registerMacroFilters`), `types.ts` (`DistanceUnit`).
- Produces:
  - `DEFAULT_RENDER_LIMIT = 1000`, `DEFAULT_PARSE_LIMIT = 10000`, `DEFAULT_MEMORY_LIMIT = 10000000`
  - `interface MacroEngineOptions { defaultDistanceUnit: DistanceUnit; parseLimit?: number; renderLimit?: number; memoryLimit?: number }`
  - `createMacroEngine(opts: MacroEngineOptions): Liquid`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/macros/engine.test.ts
import { describe, expect, it } from 'vitest';
import { createMacroEngine } from '../../../src/shared/macros/engine';

describe('createMacroEngine', () => {
  it('renders a simple variable', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
    expect(engine.parseAndRenderSync('hi {{ name }}', { name: 'Bob' })).toBe('hi Bob');
  });
  it('throws on an undefined variable (strictVariables)', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
    expect(() => engine.parseAndRenderSync('{{ nope }}', {})).toThrow(/undefined variable/i);
  });
  it('registers the distance filter', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
    const out = engine.parseAndRenderSync('{{ a | distance: b }}', { a: { lat: 0, lon: 0 }, b: { lat: 0, lon: 1 } });
    expect(Number(out)).toBeCloseTo(111194.9, 0);
  });
  it('uses the default unit when none is given', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'imperial' });
    const out = engine.parseAndRenderSync('{{ 1609.344 | unit }}', {});
    expect(out).toBe('1.0 mi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/macros/engine.test.ts`
Expected: FAIL — cannot resolve `engine`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/macros/engine.ts
import { Liquid } from 'liquidjs';
import { registerMacroFilters } from './filters';
import type { DistanceUnit } from './types';

export const DEFAULT_RENDER_LIMIT = 1000;
export const DEFAULT_PARSE_LIMIT = 10000;
export const DEFAULT_MEMORY_LIMIT = 10000000;

export interface MacroEngineOptions {
  defaultDistanceUnit: DistanceUnit;
  parseLimit?: number;
  renderLimit?: number;
  memoryLimit?: number;
}

export function createMacroEngine(opts: MacroEngineOptions): Liquid {
  const engine = new Liquid({
    ownPropertyOnly: true,
    strictVariables: true,
    strictFilters: true,
    parseLimit: opts.parseLimit ?? DEFAULT_PARSE_LIMIT,
    renderLimit: opts.renderLimit ?? DEFAULT_RENDER_LIMIT,
    memoryLimit: opts.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
  });
  registerMacroFilters(engine, { defaultDistanceUnit: opts.defaultDistanceUnit });
  return engine;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/macros/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/shared/macros/engine.ts tests/unit/macros/engine.test.ts
git add src/shared/macros/engine.ts tests/unit/macros/engine.test.ts
git commit -m "feat(macros): hardened liquid engine factory

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Render + error classification (`render.ts`)

`renderTemplate` parses, wraps empties as placeholders, renders synchronously, and classifies any failure. Never throws.

**Files:**
- Create: `src/shared/macros/render.ts`
- Test: `tests/unit/macros/render.test.ts`

**Interfaces:**
- Consumes: `engine.ts` (`createMacroEngine`, `DEFAULT_RENDER_LIMIT`), `placeholder.ts` (`PlaceholderDrop`), `types.ts`.
- Produces:
  - `renderTemplate(engine: Liquid, template: string, context: Record<string, unknown>, opts?: RenderOptions): RenderResult`
  - `classifyParseError(e: unknown): MacroError` and `classifyRenderError(e: unknown, elapsedMs: number, limit: number): MacroError` (exported for reuse by `validate.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/macros/render.test.ts
import { describe, expect, it } from 'vitest';
import { createMacroEngine } from '../../../src/shared/macros/engine';
import { buildSampleContext } from '../../../src/shared/macros/manifest';
import { renderTemplate } from '../../../src/shared/macros/render';

const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
const ctx = () => buildSampleContext() as unknown as Record<string, unknown>;

describe('renderTemplate', () => {
  it('interpolates scalars', () => {
    const r = renderTemplate(engine, 'from {{ sender_name }} at {{ rssi }} dBm', ctx());
    expect(r).toEqual({ ok: true, text: 'from Alice at -95 dBm' });
  });

  it('runs a paths pipeline', () => {
    const r = renderTemplate(engine, '{{ paths | size }} path(s)', ctx());
    expect(r.ok && r.text).toBe('1 path(s)');
  });

  it('renders the placeholder for an empty value', () => {
    const c = { ...ctx(), rssi: null };
    const r = renderTemplate(engine, 'rssi={{ rssi }}', c, { placeholder: '?' });
    expect(r).toEqual({ ok: true, text: 'rssi=?' });
  });

  it('propagates the placeholder through filters when a position is empty', () => {
    const c = { ...ctx(), peer_pos: null };
    const r = renderTemplate(engine, '{{ my_pos | distance: peer_pos | unit: "km" }}', c, { placeholder: '?' });
    expect(r).toEqual({ ok: true, text: '?' });
  });

  it('errors on an unknown variable', () => {
    const r = renderTemplate(engine, '{{ sner }}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unknown-variable');
  });

  it('blocks prototype/inherited property access (ownPropertyOnly)', () => {
    const obj = Object.create({ leaked: 'SECRET' });
    const r = renderTemplate(engine, '{{ obj.leaked }}', { ...ctx(), obj });
    expect(r.ok ? r.text : '').not.toContain('SECRET');
  });

  it('classifies a render-limit breach as timeout', () => {
    const r = renderTemplate(
      engine,
      '{% assign s = "x" %}{% for i in (1..100000) %}{{ s | append: s | append: s }}{% endfor %}',
      ctx(),
      { renderLimit: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/macros/render.test.ts`
Expected: FAIL — cannot resolve `render`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/macros/render.ts
import type { Liquid } from 'liquidjs';
import { DEFAULT_RENDER_LIMIT } from './engine';
import { PlaceholderDrop } from './placeholder';
import type { MacroError, RenderOptions, RenderResult } from './types';

function wrapScope(context: Record<string, unknown>, placeholder: string): Record<string, unknown> {
  const ph = new PlaceholderDrop(placeholder);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) out[k] = v === null || v === undefined ? ph : v;
  return out;
}

function nameFromMessage(msg: string): string | undefined {
  const m = msg.match(/:\s*([^\s]+)\s*$/);
  return m ? m[1] : undefined;
}

function lineCol(e: unknown): { line?: number; col?: number } {
  const t = (e as { token?: { line?: number; col?: number } }).token;
  return { line: t?.line, col: t?.col };
}

export function classifyParseError(e: unknown): MacroError {
  return { kind: 'parse', message: (e as Error).message, ...lineCol(e) };
}

export function classifyRenderError(e: unknown, elapsedMs: number, limit: number): MacroError {
  const message = (e as Error).message ?? String(e);
  const low = message.toLowerCase();
  if (low.includes('undefined filter')) return { kind: 'unknown-filter', message, name: nameFromMessage(message) };
  if (low.includes('undefined variable')) return { kind: 'unknown-variable', message, name: nameFromMessage(message) };
  if (low.includes('limit') || elapsedMs >= limit) return { kind: 'timeout', message };
  return { kind: 'render', message };
}

export function renderTemplate(
  engine: Liquid,
  template: string,
  context: Record<string, unknown>,
  opts: RenderOptions = {},
): RenderResult {
  const placeholder = opts.placeholder ?? '?';
  let templates: ReturnType<Liquid['parse']>;
  try {
    templates = engine.parse(template);
  } catch (e) {
    return { ok: false, error: classifyParseError(e) };
  }
  const limit = opts.renderLimit ?? DEFAULT_RENDER_LIMIT;
  const renderOpts = opts.renderLimit != null ? { renderLimit: opts.renderLimit } : {};
  const scope = wrapScope(context, placeholder);
  const start = Date.now();
  try {
    const text = engine.renderSync(templates, scope, renderOpts);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: classifyRenderError(e, Date.now() - start, limit) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/macros/render.test.ts`
Expected: PASS. If the timeout case is classified as `render` rather than `timeout`, the LiquidJS limit message differs from `/limit/`; the `elapsedMs >= limit` branch still catches it — confirm the test passes, and if not, widen the message check in `classifyRenderError` to include the actual limit-error substring printed by the failing assertion.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/shared/macros/render.ts tests/unit/macros/render.test.ts
git add src/shared/macros/render.ts tests/unit/macros/render.test.ts
git commit -m "feat(macros): synchronous render with placeholder + error classification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Validation + public surface (`validate.ts`, `index.ts`)

`validateTemplate` parses (catching syntax errors) then dry-renders against the sample context to surface unknown filters/variables distinctly. `index.ts` exposes the core's public surface for the main process.

**Files:**
- Create: `src/shared/macros/validate.ts`, `src/shared/macros/index.ts`
- Test: `tests/unit/macros/validate.test.ts`

**Interfaces:**
- Consumes: `engine.ts`, `manifest.ts` (`buildSampleContext`), `render.ts` (`classifyParseError`, `classifyRenderError`), `types.ts`.
- Produces (from `validate.ts`): `validateTemplate(template: string): ValidateResult`.
- Produces (from `index.ts`): re-exports of `createMacroEngine`, `renderTemplate`, `validateTemplate`, `getManifest`, `buildSampleContext`, and all `types`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/macros/validate.test.ts
import { describe, expect, it } from 'vitest';
import { validateTemplate } from '../../../src/shared/macros/validate';

describe('validateTemplate', () => {
  it('accepts a valid template', () => {
    expect(validateTemplate('hi {{ peer_name }} {{ my_pos | distance: peer_pos | unit }}')).toEqual({ ok: true });
  });
  it('flags a parse error', () => {
    const r = validateTemplate('{% if %}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].kind).toBe('parse');
  });
  it('flags an unknown filter distinctly', () => {
    const r = validateTemplate('{{ peer_name | nope }}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].kind).toBe('unknown-filter');
  });
  it('flags an unknown variable distinctly', () => {
    const r = validateTemplate('{{ definitely_not_a_var }}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].kind).toBe('unknown-variable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/macros/validate.test.ts`
Expected: FAIL — cannot resolve `validate`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/macros/validate.ts
import type { Liquid } from 'liquidjs';
import { createMacroEngine, DEFAULT_RENDER_LIMIT } from './engine';
import { buildSampleContext } from './manifest';
import { classifyParseError, classifyRenderError } from './render';
import type { ValidateResult } from './types';

let cached: Liquid | null = null;
function engine(): Liquid {
  if (!cached) cached = createMacroEngine({ defaultDistanceUnit: 'metric' });
  return cached;
}

export function validateTemplate(template: string): ValidateResult {
  const eng = engine();
  let templates: ReturnType<Liquid['parse']>;
  try {
    templates = eng.parse(template);
  } catch (e) {
    return { ok: false, errors: [classifyParseError(e)] };
  }
  try {
    eng.renderSync(templates, buildSampleContext() as unknown as Record<string, unknown>);
    return { ok: true };
  } catch (e) {
    return { ok: false, errors: [classifyRenderError(e, 0, DEFAULT_RENDER_LIMIT)] };
  }
}
```

```ts
// src/shared/macros/index.ts
export { createMacroEngine, type MacroEngineOptions } from './engine';
export { buildSampleContext, getManifest, MACRO_FILTERS, MACRO_VARIABLES } from './manifest';
export { renderTemplate } from './render';
export { validateTemplate } from './validate';
export * from './types';
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run tests/unit/macros/validate.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/shared/macros/validate.ts src/shared/macros/index.ts tests/unit/macros/validate.test.ts
git add src/shared/macros/validate.ts src/shared/macros/index.ts tests/unit/macros/validate.test.ts
git commit -m "feat(macros): validateTemplate + public core surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Add `AppSettings.distanceUnit`

New setting that feeds the `unit` filter default. Backfilled by the existing `mergeDefaults`.

**Files:**
- Modify: `src/shared/types.ts` (`AppSettings` interface ~317; `DEFAULT_APP_SETTINGS` ~417)
- Test: `tests/integration/macros/distance-unit.test.ts`

**Interfaces:**
- Produces: `AppSettings.distanceUnit: DistanceUnit` (default `'metric'`).
- Consumes: `DistanceUnit` from `./macros/types`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/macros/distance-unit.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';

describe('AppSettings.distanceUnit', () => {
  it('defaults to metric', () => {
    expect(DEFAULT_APP_SETTINGS.distanceUnit).toBe('metric');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/macros/distance-unit.test.ts`
Expected: FAIL — `distanceUnit` does not exist on `DEFAULT_APP_SETTINGS` (and a typecheck error).

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, add the import near the other type imports at the top of the file:

```ts
import type { DistanceUnit } from './macros/types';
```

Add the field to the `AppSettings` interface (next to `quickActions`):

```ts
  quickActions: QuickActionId[];
  distanceUnit: DistanceUnit;
```

Add the default to `DEFAULT_APP_SETTINGS` (next to `quickActions`):

```ts
  quickActions: ['flood', 'gps', 'shareLoc', 'disconnect'],
  distanceUnit: 'metric',
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run tests/integration/macros/distance-unit.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/shared/types.ts tests/integration/macros/distance-unit.test.ts
git add src/shared/types.ts tests/integration/macros/distance-unit.test.ts
git commit -m "feat(macros): add AppSettings.distanceUnit (default metric)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Persistent macro store (`store.ts` + settings wiring)

Adds the `macros.json` store and a CRUD module that validates templates before persisting.

**Files:**
- Modify: `src/main/storage/settings.ts` (`FILES` ~36; `settingsStore` ~110)
- Create: `src/main/macros/store.ts`
- Test: `tests/integration/macros/store.test.ts`

**Interfaces:**
- Consumes: `settingsStore.loadMacros/saveMacros`, `validateTemplate` from `../../shared/macros`, `MacroTemplate`/`MacroScope` from `../../shared/macros/types`.
- Produces:
  - `settingsStore.loadMacros(): MacroTemplate[]`, `settingsStore.saveMacros(v: MacroTemplate[]): void`
  - `class MacroValidationError extends Error { errors: MacroError[] }`
  - `macrosStore.list(): MacroTemplate[]`
  - `macrosStore.add(input: NewMacro): MacroTemplate` where `NewMacro = Omit<MacroTemplate, 'id' | 'createdAt' | 'updatedAt'>`
  - `macrosStore.update(id: string, patch: Partial<NewMacro>): MacroTemplate | null`
  - `macrosStore.remove(id: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/macros/store.test.ts
import { describe, expect, it } from 'vitest';
import { MacroValidationError, macrosStore } from '../../../src/main/macros/store';

describe('macrosStore', () => {
  it('round-trips create, update, list, remove', () => {
    const created = macrosStore.add({ name: 'sig', template: 'rssi {{ rssi }}', scope: 'global' });
    expect(created.id).toBeTruthy();
    expect(macrosStore.list().map((m) => m.id)).toContain(created.id);

    const updated = macrosStore.update(created.id, { name: 'signal' });
    expect(updated?.name).toBe('signal');
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.createdAt);

    expect(macrosStore.remove(created.id)).toBe(true);
    expect(macrosStore.list()).toHaveLength(0);
  });

  it('rejects a template that fails to parse', () => {
    expect(() => macrosStore.add({ name: 'bad', template: '{% if %}', scope: 'global' })).toThrow(MacroValidationError);
    expect(macrosStore.list()).toHaveLength(0);
  });
});
```

> The `integration` project's `tests/integration/setup.ts` already routes settings to a temp dir per test via `useTempUserData()`, so `macros.json` is isolated and cleaned up automatically.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/macros/store.test.ts`
Expected: FAIL — cannot resolve `../../../src/main/macros/store`.

- [ ] **Step 3: Implement settings wiring**

In `src/main/storage/settings.ts`, add to the `FILES` map:

```ts
  blockRules: 'block-rules.json',
  macros: 'macros.json',
} as const;
```

Add the import of the type near the top of `settings.ts`:

```ts
import type { MacroTemplate } from '../../shared/macros/types';
```

Add the load/save pair inside `settingsStore` (next to the `loadBlockRules`/`saveBlockRules` pair):

```ts
  loadMacros: (): MacroTemplate[] => readJson(FILES.macros, [] as MacroTemplate[]),
  saveMacros: (v: MacroTemplate[]): void => writeJson(FILES.macros, v),
```

- [ ] **Step 4: Implement the store**

```ts
// src/main/macros/store.ts
import { randomUUID } from 'node:crypto';
import { validateTemplate } from '../../shared/macros';
import type { MacroError, MacroTemplate } from '../../shared/macros/types';
import { settingsStore } from '../storage/settings';

export type NewMacro = Omit<MacroTemplate, 'id' | 'createdAt' | 'updatedAt'>;

export class MacroValidationError extends Error {
  constructor(public readonly errors: MacroError[]) {
    super('invalid macro template');
    this.name = 'MacroValidationError';
  }
}

function assertValid(template: string): void {
  const v = validateTemplate(template);
  if (!v.ok) throw new MacroValidationError(v.errors);
}

export const macrosStore = {
  list(): MacroTemplate[] {
    return settingsStore.loadMacros();
  },
  add(input: NewMacro): MacroTemplate {
    assertValid(input.template);
    const now = Date.now();
    const macro: MacroTemplate = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    settingsStore.saveMacros([...this.list(), macro]);
    return macro;
  },
  update(id: string, patch: Partial<NewMacro>): MacroTemplate | null {
    if (patch.template != null) assertValid(patch.template);
    const list = this.list();
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    const updated: MacroTemplate = { ...list[idx], ...patch, id, updatedAt: Date.now() };
    settingsStore.saveMacros(list.map((m, i) => (i === idx ? updated : m)));
    return updated;
  },
  remove(id: string): boolean {
    const list = this.list();
    const next = list.filter((m) => m.id !== id);
    if (next.length === list.length) return false;
    settingsStore.saveMacros(next);
    return true;
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/macros/store.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
pnpm biome check --write src/main/storage/settings.ts src/main/macros/store.ts tests/integration/macros/store.test.ts
git add src/main/storage/settings.ts src/main/macros/store.ts tests/integration/macros/store.test.ts
git commit -m "feat(macros): persistent macros.json store with validation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Context builders (`contextBuilder.ts`)

Maps device state into the serializable `MacroContext` for both reply and new-send modes.

**Files:**
- Create: `src/main/macros/contextBuilder.ts`
- Test: `tests/unit/macros/contextBuilder.test.ts`

**Interfaces:**
- Consumes shared types: `Owner`, `DeviceInfo`, `DeviceIdentity`, `Contact`, `Message` from `../../shared/types`; `MacroContext` from `../../shared/macros/types`.
- Produces:
  - `interface SelfState { owner: Owner | null; deviceInfo: DeviceInfo; deviceIdentity: DeviceIdentity }`
  - `buildSendContext(args: { self: SelfState; peerContact: Contact | null; channelName: string | null }): MacroContext`
  - `buildReplyContext(args: { self: SelfState; message: Message; senderContact: Contact | null; channelName: string | null; now?: number }): MacroContext`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/macros/contextBuilder.test.ts
import { describe, expect, it } from 'vitest';
import type { Contact, DeviceIdentity, DeviceInfo, Message, Owner } from '../../../src/shared/types';
import { buildReplyContext, buildSendContext } from '../../../src/main/macros/contextBuilder';

const owner: Owner = { name: 'N0CALL', publicKeyHex: 'aabbccdd', publicKeyShort: 'aabbccdd' };
const deviceInfo = { batteryMv: 4100 } as DeviceInfo;
const deviceIdentity = { lat: 37.7749, lon: -122.4194 } as DeviceIdentity;
const self = { owner, deviceInfo, deviceIdentity };

const alice: Contact = {
  key: 'c:alice', publicKeyHex: 'alicepk', name: 'Alice', kind: 'chat',
  lastSeenMs: 1700000000000, rssi: -80, snr: 7, hops: 1, gpsLat: 37.8, gpsLon: -122.27,
};

describe('buildSendContext', () => {
  it('maps self + peer for a DM and leaves reply fields empty', () => {
    const ctx = buildSendContext({ self, peerContact: alice, channelName: null });
    expect(ctx.my_callsign).toBe('N0CALL');
    expect(ctx.my_pos).toEqual({ lat: 37.7749, lon: -122.4194 });
    expect(ctx.my_battery_v).toBeCloseTo(4.1, 3);
    expect(ctx.peer_name).toBe('Alice');
    expect(ctx.peer_pos).toEqual({ lat: 37.8, lon: -122.27 });
    expect(ctx.message_body).toBeNull();
    expect(ctx.paths).toEqual([]);
  });

  it('nulls peer for a channel broadcast', () => {
    const ctx = buildSendContext({ self, peerContact: null, channelName: 'General' });
    expect(ctx.channel).toBe('General');
    expect(ctx.peer_name).toBeNull();
    expect(ctx.peer_pos).toBeNull();
  });

  it('nulls my_pos when device position is absent', () => {
    const ctx = buildSendContext({ self: { owner, deviceInfo, deviceIdentity: { lat: null, lon: null } as DeviceIdentity }, peerContact: null, channelName: null });
    expect(ctx.my_pos).toBeNull();
  });
});

describe('buildReplyContext', () => {
  const message: Message = {
    id: 'm1', key: 'ch:General', fromPublicKeyHex: 'alicepk', body: 'hi', ts: 1700000000000, state: 'received',
    meta: { rssi: -95, snr: 5.5, hops: 2, timesHeard: 3, paths: [{ id: 'p1', hashMode: 1, finalSnr: 6, hops: [
      { kind: 'origin', shortId: 'aa', name: 'Alice', pk: 'alicepk' },
      { kind: 'sink', shortId: 'bb', name: 'Me', pk: 'aabbccdd' },
    ] }] },
  };

  it('maps message signal, sender, and peer-from-sender on a channel', () => {
    const ctx = buildReplyContext({ self, message, senderContact: alice, channelName: 'General', now: 1700000300000 });
    expect(ctx.message_body).toBe('hi');
    expect(ctx.rssi).toBe(-95);
    expect(ctx.times_heard).toBe(3);
    expect(ctx.sender_name).toBe('Alice');
    expect(ctx.sender_id).toBe('alicepk');
    expect(ctx.peer_name).toBe('Alice'); // peer resolved from the sender, even on a channel
    expect(ctx.received_ago).toBe('5m');
    expect(ctx.paths).toHaveLength(1);
    expect(ctx.paths[0].final_snr).toBe(6);
    expect(ctx.paths[0].hops.map((h) => h.name)).toEqual(['Alice', 'Me']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/macros/contextBuilder.test.ts`
Expected: FAIL — cannot resolve `contextBuilder`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/macros/contextBuilder.ts
import type { MacroContext, MacroPath, MacroPosition } from '../../shared/macros/types';
import type { Contact, DeviceIdentity, DeviceInfo, Message, MessagePath, Owner } from '../../shared/types';

export interface SelfState {
  owner: Owner | null;
  deviceInfo: DeviceInfo;
  deviceIdentity: DeviceIdentity;
}

function pos(lat: number | null | undefined, lon: number | null | undefined): MacroPosition | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { lat, lon };
}

function humanizeAgo(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function mapPaths(paths: MessagePath[] | undefined): MacroPath[] {
  if (!paths) return [];
  return paths.map((p) => ({
    id: p.id,
    length: p.hops.length,
    hash_mode: p.hashMode,
    final_snr: p.finalSnr,
    hops: p.hops.map((h) => ({ kind: h.kind, short_id: h.shortId, name: h.name ?? null, pk: h.pk ?? null })),
  }));
}

function selfFields(self: SelfState) {
  const name = self.owner?.name ?? null;
  const mv = typeof self.deviceInfo?.batteryMv === 'number' ? self.deviceInfo.batteryMv : null;
  return {
    my_name: name,
    my_callsign: name,
    my_id: self.owner?.publicKeyShort ?? null,
    my_pubkey: self.owner?.publicKeyHex ?? null,
    my_pos: pos(self.deviceIdentity?.lat ?? null, self.deviceIdentity?.lon ?? null),
    my_battery_mv: mv,
    my_battery_v: mv == null ? null : mv / 1000,
  };
}

function peerFields(contact: Contact | null) {
  return {
    peer_name: contact?.name ?? null,
    peer_id: contact?.publicKeyHex ?? null,
    peer_pos: pos(contact?.gpsLat, contact?.gpsLon),
    peer_last_seen: contact?.lastSeenMs ?? null,
    peer_rssi: contact?.rssi ?? null,
    peer_snr: contact?.snr ?? null,
    peer_hops: contact?.hops ?? null,
  };
}

function emptyReplyFields() {
  return {
    message_body: null,
    msg_time: null,
    received_ago: null,
    sender_name: null,
    sender_id: null,
    sender_pos: null,
    rssi: null,
    snr: null,
    hops: null,
    times_heard: null,
    paths: [] as MacroPath[],
  };
}

export function buildSendContext(args: {
  self: SelfState;
  peerContact: Contact | null;
  channelName: string | null;
}): MacroContext {
  return {
    ...selfFields(args.self),
    channel: args.channelName,
    ...peerFields(args.peerContact),
    ...emptyReplyFields(),
  };
}

export function buildReplyContext(args: {
  self: SelfState;
  message: Message;
  senderContact: Contact | null;
  channelName: string | null;
  now?: number;
}): MacroContext {
  const now = args.now ?? Date.now();
  const m = args.message;
  return {
    ...selfFields(args.self),
    channel: args.channelName,
    ...peerFields(args.senderContact),
    message_body: m.body,
    msg_time: m.ts,
    received_ago: humanizeAgo(Math.max(0, now - m.ts)),
    sender_name: args.senderContact?.name ?? null,
    sender_id: m.fromPublicKeyHex ?? null,
    sender_pos: pos(args.senderContact?.gpsLat, args.senderContact?.gpsLon),
    rssi: m.meta?.rssi ?? null,
    snr: m.meta?.snr ?? null,
    hops: m.meta?.hops ?? null,
    times_heard: m.meta?.timesHeard ?? null,
    paths: mapPaths(m.meta?.paths),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/macros/contextBuilder.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/main/macros/contextBuilder.ts tests/unit/macros/contextBuilder.test.ts
git add src/main/macros/contextBuilder.ts tests/unit/macros/contextBuilder.test.ts
git commit -m "feat(macros): reply/send context builders from device state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Render service (`service.ts`)

Ties the store, engine, and settings together: resolves a macro id or raw template and renders against a provided context using the engine built from the current `distanceUnit`.

**Files:**
- Create: `src/main/macros/service.ts`
- Test: `tests/integration/macros/service.test.ts`

**Interfaces:**
- Consumes: `createMacroEngine`/`renderTemplate` from `../../shared/macros`, `macrosStore` from `./store`, `settingsStore` from `../storage/settings`, `MacroContext`/`RenderOptions`/`RenderResult` from `../../shared/macros/types`.
- Produces: `renderMacro(idOrTemplate: string, context: MacroContext, opts?: RenderOptions): RenderResult`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/macros/service.test.ts
import { describe, expect, it } from 'vitest';
import { buildSampleContext } from '../../../src/shared/macros';
import { macrosStore } from '../../../src/main/macros/store';
import { renderMacro } from '../../../src/main/macros/service';

const ctx = () => buildSampleContext();

describe('renderMacro', () => {
  it('renders a raw template string', () => {
    const r = renderMacro('hi {{ peer_name }}', ctx());
    expect(r).toEqual({ ok: true, text: 'hi Alice' });
  });
  it('renders a stored macro by id', () => {
    const m = macrosStore.add({ name: 'sig', template: 'rssi {{ rssi }}', scope: 'global' });
    expect(renderMacro(m.id, ctx())).toEqual({ ok: true, text: 'rssi -95' });
  });
  it('returns an error result instead of throwing', () => {
    const r = renderMacro('{{ nope }}', ctx());
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/macros/service.test.ts`
Expected: FAIL — cannot resolve `service`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/macros/service.ts
import type { Liquid } from 'liquidjs';
import { createMacroEngine, renderTemplate } from '../../shared/macros';
import type { DistanceUnit, MacroContext, RenderOptions, RenderResult } from '../../shared/macros/types';
import { settingsStore } from '../storage/settings';
import { macrosStore } from './store';

let cached: { unit: DistanceUnit; engine: Liquid } | null = null;

function engineForUnit(unit: DistanceUnit): Liquid {
  if (!cached || cached.unit !== unit) cached = { unit, engine: createMacroEngine({ defaultDistanceUnit: unit }) };
  return cached.engine;
}

export function renderMacro(idOrTemplate: string, context: MacroContext, opts?: RenderOptions): RenderResult {
  const macro = macrosStore.list().find((m) => m.id === idOrTemplate);
  const template = macro ? macro.template : idOrTemplate;
  const unit = settingsStore.loadAppSettings().distanceUnit;
  const engine = engineForUnit(unit);
  return renderTemplate(engine, template, context as unknown as Record<string, unknown>, opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/macros/service.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/main/macros/service.ts tests/integration/macros/service.test.ts
git add src/main/macros/service.ts tests/integration/macros/service.test.ts
git commit -m "feat(macros): render service binding store + engine + settings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Broadcast wiring (`bus.ts`, `server.ts`, `WsMessage`)

Lets macro-list changes flow to WebSocket clients, mirroring `blockRules`.

**Files:**
- Modify: `src/main/events/bus.ts` (`emit` ~47; `BusEvents` ~85), `src/main/server.ts` (handlers ~216; `bus.on` ~249; `bus.off` ~284), `src/shared/types.ts` (`WsMessage` union ~949)
- Test: `tests/integration/macros/bus.test.ts`

**Interfaces:**
- Consumes: `MacroTemplate` from `../../shared/types` (bus) / local (`WsMessage`).
- Produces: `emit.macros(macros: MacroTemplate[]): void`; `BusEvents.macros`; `WsMessage` variant `{ type: 'macros'; payload: MacroTemplate[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/macros/bus.test.ts
import { describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import type { MacroTemplate } from '../../../src/shared/types';

describe('emit.macros', () => {
  it('emits the macros bus event with the payload', () => {
    const received: MacroTemplate[][] = [];
    const handler = (m: MacroTemplate[]) => received.push(m);
    bus.on('macros', handler);
    emit.macros([{ id: '1', name: 'a', template: 'x', scope: 'global', createdAt: 0, updatedAt: 0 }]);
    bus.off('macros', handler);
    expect(received[0]?.[0]?.id).toBe('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/macros/bus.test.ts`
Expected: FAIL — `emit.macros` is not a function / `'macros'` not a known event.

- [ ] **Step 3: Implement**

In `src/main/events/bus.ts`, add to the `emit` object (next to `blockRules`):

```ts
  macros: (macros: MacroTemplate[]) => bus.emit('macros', macros),
```

Add to the `BusEvents` type (next to `blockRules`):

```ts
  macros: (macros: MacroTemplate[]) => void;
```

> `Message` and other shared types are already imported in `bus.ts`. Add `MacroTemplate` to the existing `import type { ... } from '...shared/types'` list if not present.

In `src/shared/types.ts`, add the import of `MacroTemplate` (it lives in `./macros/types`) near the top, and add the variant to the `WsMessage` union (next to `blockRules`):

```ts
  | { type: 'blockRules'; payload: BlockRule[] }
  | { type: 'macros'; payload: MacroTemplate[] }
```

In `src/main/server.ts`, add the handler (next to `onBlockRules` ~216):

```ts
  const onMacros = (macros: MacroTemplate[]) => broadcast({ type: 'macros', payload: macros });
```

Register and unregister it (next to the `blockRules` registrations ~249 and ~284):

```ts
  bus.on('macros', onMacros);
```
```ts
    bus.off('macros', onMacros);
```

> Add `MacroTemplate` to `server.ts`'s existing `import type { ... } from '...shared/types'` list.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run tests/integration/macros/bus.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/main/events/bus.ts src/main/server.ts src/shared/types.ts tests/integration/macros/bus.test.ts
git add src/main/events/bus.ts src/main/server.ts src/shared/types.ts tests/integration/macros/bus.test.ts
git commit -m "feat(macros): broadcast macro-list changes over websocket

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: HTTP API (`routes.ts`)

CRUD plus `manifest`, `validate`, and `render` endpoints.

**Files:**
- Modify: `src/main/api/routes.ts` (add a `// ----- Macros -----` section near the block-rules section)
- Test: `tests/integration/api/macros.routes.test.ts`

**Interfaces:**
- Consumes: `macrosStore` (`./macros/store`), `renderMacro` (`./macros/service`), `buildReplyContext`/`buildSendContext` (`./macros/contextBuilder`), `getManifest`/`validateTemplate` (`../../shared/macros`), `emit` (`../events/bus`), `stateHolder` (`../state/holder`), `messagesStore` (`../storage/messages`).
- Produces routes: `GET /api/macros`, `POST /api/macros`, `PUT /api/macros/:id`, `DELETE /api/macros/:id`, `GET /api/macros/manifest`, `POST /api/macros/validate`, `POST /api/macros/render`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/api/macros.routes.test.ts
import { describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('macros api', () => {
  it('lists, creates, and deletes macros', async () => {
    expect((await (await app().request('/api/macros')).json()) as unknown[]).toEqual([]);

    const created = await app().request('/api/macros', json({ name: 'sig', template: 'rssi {{ rssi }}', scope: 'global' }));
    expect(created.status).toBeLessThan(400);
    const { macro } = (await created.json()) as { macro: { id: string } };
    expect(macro.id).toBeTruthy();

    const list = (await (await app().request('/api/macros')).json()) as Array<{ id: string }>;
    expect(list.map((m) => m.id)).toContain(macro.id);

    const del = await app().request(`/api/macros/${macro.id}`, { method: 'DELETE' });
    expect(del.status).toBeLessThan(400);
  });

  it('rejects an invalid template on create', async () => {
    const res = await app().request('/api/macros', json({ name: 'bad', template: '{% if %}', scope: 'global' }));
    expect(res.status).toBe(400);
  });

  it('serves the manifest', async () => {
    const body = (await (await app().request('/api/macros/manifest')).json()) as { filters: Array<{ name: string }> };
    expect(body.filters.map((f) => f.name)).toContain('distance');
  });

  it('validates a template', async () => {
    const ok = (await (await app().request('/api/macros/validate', json({ template: '{{ peer_name }}' }))).json()) as { ok: boolean };
    expect(ok.ok).toBe(true);
    const bad = (await (await app().request('/api/macros/validate', json({ template: '{{ x | nope }}' }))).json()) as { ok: boolean };
    expect(bad.ok).toBe(false);
  });

  it('renders a raw template in send mode', async () => {
    const res = await app().request('/api/macros/render', json({ template: 'hi {{ my_callsign }}', mode: 'send' }));
    const body = (await res.json()) as { ok: boolean; text?: string };
    expect(body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/api/macros.routes.test.ts`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Implement**

Add these imports to `src/main/api/routes.ts` (top of file, with the other imports):

```ts
import { getManifest, validateTemplate } from '../../shared/macros';
import { buildReplyContext, buildSendContext } from '../macros/contextBuilder';
import { macrosStore, MacroValidationError } from '../macros/store';
import { renderMacro } from '../macros/service';
import { messagesStore } from '../storage/messages';
```

Add this section inside `createRoutes`, after the block-rules routes (before the closing of the function / `return api`):

```ts
  // ----- Macros -----
  api.get('/api/macros', (c) => c.json(macrosStore.list()));

  api.get('/api/macros/manifest', (c) => c.json(getManifest()));

  api.post('/api/macros/validate', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { template?: string } | null;
    if (!body || typeof body.template !== 'string') return c.json({ error: 'template required' }, 400);
    return c.json(validateTemplate(body.template));
  });

  api.post('/api/macros', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      template?: string;
      scope?: 'global' | 'channel' | 'contact';
      channelKey?: string;
      contactKey?: string;
    } | null;
    if (!body || !body.name || typeof body.template !== 'string' || !body.scope) {
      return c.json({ error: 'name, template, scope required' }, 400);
    }
    try {
      const macro = macrosStore.add({
        name: body.name,
        template: body.template,
        scope: body.scope,
        channelKey: body.channelKey,
        contactKey: body.contactKey,
      });
      emit.macros(macrosStore.list());
      return c.json({ macro });
    } catch (e) {
      if (e instanceof MacroValidationError) return c.json({ error: 'invalid template', errors: e.errors }, 400);
      throw e;
    }
  });

  api.put('/api/macros/:id', async (c) => {
    const id = c.req.param('id');
    const patch = (await c.req.json().catch(() => null)) as Partial<{
      name: string;
      template: string;
      scope: 'global' | 'channel' | 'contact';
      channelKey: string;
      contactKey: string;
    }> | null;
    if (!patch) return c.json({ error: 'invalid body' }, 400);
    try {
      const updated = macrosStore.update(id, patch);
      if (!updated) return c.json({ error: 'not found' }, 404);
      emit.macros(macrosStore.list());
      return c.json({ macro: updated });
    } catch (e) {
      if (e instanceof MacroValidationError) return c.json({ error: 'invalid template', errors: e.errors }, 400);
      throw e;
    }
  });

  api.delete('/api/macros/:id', (c) => {
    const id = c.req.param('id');
    if (!macrosStore.remove(id)) return c.json({ error: 'not found' }, 404);
    emit.macros(macrosStore.list());
    return c.json({ ok: true });
  });

  api.post('/api/macros/render', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      macroId?: string;
      template?: string;
      mode?: 'reply' | 'send';
      messageId?: string;
      contactKey?: string;
      channelKey?: string;
      placeholder?: string;
    } | null;
    if (!body || (!body.macroId && typeof body.template !== 'string')) {
      return c.json({ error: 'macroId or template required' }, 400);
    }
    const holder = stateHolder();
    const self = { owner: holder.getOwner(), deviceInfo: holder.getDeviceInfo(), deviceIdentity: holder.getDeviceIdentity() };
    const channelName = body.channelKey
      ? (holder.getChannels().find((ch) => ch.key === body.channelKey)?.name ?? body.channelKey.replace(/^ch:/, ''))
      : null;

    let context;
    if (body.mode === 'reply') {
      const message = body.messageId ? messagesStore.findById(body.messageId) : null;
      if (!message) return c.json({ error: 'message not found' }, 404);
      const senderContact = message.fromPublicKeyHex
        ? (holder.getContacts().find((ct) => ct.publicKeyHex === message.fromPublicKeyHex) ?? null)
        : null;
      context = buildReplyContext({ self, message, senderContact, channelName });
    } else {
      const peerContact = body.contactKey ? (holder.getContacts().find((ct) => ct.key === body.contactKey) ?? null) : null;
      context = buildSendContext({ self, peerContact, channelName });
    }

    const result = renderMacro(body.macroId ?? (body.template as string), context, { placeholder: body.placeholder });
    return c.json(result);
  });
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run tests/integration/api/macros.routes.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
pnpm biome check --write src/main/api/routes.ts tests/integration/api/macros.routes.test.ts
git add src/main/api/routes.ts tests/integration/api/macros.routes.test.ts
git commit -m "feat(macros): http api for crud, manifest, validate, render

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Renderer plumbing (`api.ts`, `store.ts`, `wsHandlers.ts`)

Client methods + a state slice so the future UI can read macros and stay in sync. No UI components.

**Files:**
- Modify: `src/renderer/lib/api.ts` (add methods to the `api` object), `src/renderer/lib/store.ts` (state field ~241; `applyMacros` declaration ~338; default ~510; mutator ~682), `src/renderer/app/wsHandlers.ts` (add a `case 'macros'`)
- Test: `tests/component/macros-renderer.test.tsx`

**Interfaces:**
- Consumes: `MacroTemplate`, `MacroManifest`, `ValidateResult`, `RenderResult` from `@/../shared/macros/types` (or `../../shared/...`), `ApiClient`/`request` (existing in `api.ts`).
- Produces:
  - `api.getMacros`, `api.getMacroManifest`, `api.addMacro`, `api.updateMacro`, `api.deleteMacro`, `api.validateMacro`
  - store: `macros: MacroTemplate[]` + `applyMacros(macros: MacroTemplate[]): void`
  - ws: `case 'macros'` → `applyMacros`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/component/macros-renderer.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { MacroTemplate } from '../../src/shared/macros/types';

const client = { baseUrl: 'http://x', apiKey: 'k' } as Parameters<typeof api.getMacros>[0];

afterEach(() => vi.unstubAllGlobals());

describe('renderer macro plumbing', () => {
  it('getMacros calls GET /api/macros', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    await api.getMacros(client);
    expect(fetchMock).toHaveBeenCalledWith('http://x/api/macros', expect.objectContaining({}));
  });

  it('applyMacros updates the store slice', () => {
    const macros: MacroTemplate[] = [{ id: '1', name: 'a', template: 'x', scope: 'global', createdAt: 0, updatedAt: 0 }];
    useStore.getState().applyMacros(macros);
    expect(useStore.getState().macros).toEqual(macros);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/macros-renderer.test.tsx`
Expected: FAIL — `api.getMacros` / `applyMacros` / `macros` do not exist.

- [ ] **Step 3: Implement the API client methods**

In `src/renderer/lib/api.ts`, add `import type { MacroManifest, MacroTemplate, RenderResult, ValidateResult } from '../../shared/macros/types';` near the top, then add these to the `api` object:

```ts
  getMacros: (c: ApiClient) => request<MacroTemplate[]>(c, '/api/macros'),
  getMacroManifest: (c: ApiClient) => request<MacroManifest>(c, '/api/macros/manifest'),
  addMacro: (c: ApiClient, input: Pick<MacroTemplate, 'name' | 'template' | 'scope'> & Partial<Pick<MacroTemplate, 'channelKey' | 'contactKey'>>) =>
    request<{ macro: MacroTemplate }>(c, '/api/macros', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.macro),
  updateMacro: (c: ApiClient, id: string, patch: Partial<Pick<MacroTemplate, 'name' | 'template' | 'scope' | 'channelKey' | 'contactKey'>>) =>
    request<{ macro: MacroTemplate }>(c, `/api/macros/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) }).then((r) => r.macro),
  deleteMacro: (c: ApiClient, id: string) =>
    request<{ ok: true }>(c, `/api/macros/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  validateMacro: (c: ApiClient, template: string) =>
    request<ValidateResult>(c, '/api/macros/validate', { method: 'POST', body: JSON.stringify({ template }) }),
  renderMacro: (c: ApiClient, body: { macroId?: string; template?: string; mode: 'reply' | 'send'; messageId?: string; contactKey?: string; channelKey?: string; placeholder?: string }) =>
    request<RenderResult>(c, '/api/macros/render', { method: 'POST', body: JSON.stringify(body) }),
```

- [ ] **Step 4: Implement the store slice**

In `src/renderer/lib/store.ts`:

Add the import near the top: `import type { MacroTemplate } from '../../shared/macros/types';`

Add to the `CoreState` interface (next to `blockRules: BlockRule[];` ~241):

```ts
  macros: MacroTemplate[];
```

Add the mutator declaration (next to `applyBlockRules` ~338):

```ts
  applyMacros: (macros: MacroTemplate[]) => void;
```

Add the default in the initial state (next to `blockRules: [],` ~510):

```ts
  macros: [],
```

Add the mutator implementation (next to `applyBlockRules` ~682):

```ts
  applyMacros: (macros) => set(() => ({ macros })),
```

- [ ] **Step 5: Implement the ws handler case**

In `src/renderer/app/wsHandlers.ts`, add next to the `blockRules` case:

```ts
      case 'macros':
        s.applyMacros(msg.payload);
        break;
```

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm vitest run tests/component/macros-renderer.test.tsx && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
pnpm biome check --write src/renderer/lib/api.ts src/renderer/lib/store.ts src/renderer/app/wsHandlers.ts tests/component/macros-renderer.test.tsx
git add src/renderer/lib/api.ts src/renderer/lib/store.ts src/renderer/app/wsHandlers.ts tests/component/macros-renderer.test.tsx
git commit -m "feat(macros): renderer api client + state slice for future ui

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after Task 13)

- [ ] **Run the full suite + typecheck:**

```bash
pnpm test
pnpm typecheck
pnpm biome check src/shared/macros src/main/macros
```
Expected: all suites pass, typecheck clean, Biome clean on the new directories. Then use `superpowers:finishing-a-development-branch` to decide how to integrate.

---

## Self-Review (against the spec)

**1. Spec coverage**
- §2 architecture (shared core + main authority) → Tasks 1–6 (core), 8–12 (main). ✓
- §3.1 `MacroTemplate` → Task 2 (type) + Task 8 (store). ✓
- §3.2 `MacroContext` (reply/send, serializable) → Task 2 (type) + Task 9 (builders). ✓
- §3.3 manifest types + §8.2 `getManifest` → Task 2. ✓
- §3.4 result/error types → Task 2; classification → Task 5. ✓
- §4.1/4.2 variable sets, §4.3 peer-from-sender rule, §4.4 corrected `paths` → Task 2 (manifest) + Task 9 (builder, with the channel-reply peer test). ✓
- §5.1 engine config → Task 4. §5.2 placeholder/strictVariables contract → Tasks 3 (placeholder), 5 (wrap + render tests). §5.3 never-throw → Task 5/10. ✓
- §6 filters + geo (6371008.8) → Tasks 1, 3. ✓
- §7 `AppSettings.distanceUnit` → Task 7. ✓
- §8.1 store → Task 8. §8.3 service → Task 10. §8.4 routes + broadcast + renderer client → Tasks 11, 12, 13. ✓
- §9 testing → tests present in every task (geo pairs incl. sub-km/antipodal, filter boundaries, paths pipeline, placeholder, unknown-var, prototype block, renderLimit, validate parse/unknown-filter/unknown-variable, store CRUD + reject, builder mapping + null + channel-reply peer). ✓

**2. Placeholder scan:** every code step contains full code; commands have expected output. The one conditional ("if timeout classified as render, widen the message check") is a guarded fallback with a concrete action, not a TODO.

**3. Type consistency:** `MacroContext` field names match between `types.ts` (Task 2), `buildSampleContext` (Task 2), the manifest (Task 2), and the builders (Task 9). `renderTemplate(engine, template, context, opts)` signature is consistent across Tasks 5, 6, 10. `macrosStore.{list,add,update,remove}` consistent across Tasks 8, 10, 12. `emit.macros` / `WsMessage 'macros'` consistent across Tasks 11, 12, 13.

**Known intentional spec refinements (documented):**
- `validateTemplate` parses *and* dry-renders against `buildSampleContext()` to surface `unknown-filter`/`unknown-variable` distinctly (spec said "parses without rendering"; the dry-render is what makes filter/variable detection reliable and doubles as preview-seed infra). Hard guarantees (parse + unknown-filter distinct) are preserved.
- Placeholder is honored per-render via `opts.placeholder` baked into `PlaceholderDrop`s during scope-wrapping; filters propagate those drops, so they need no per-render context access.
