# Owner Card redesign + configurable Quick Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the left-nav owner card (identicon + instrument rail + instrument hover popover) and let the user configure up to 4 quick-action buttons via a new settings tab.

**Architecture:** A typed **quick-action catalog** is the single source of truth, consumed by both the card's button block and a new **Quick Actions** settings tab. All persistence rides on the existing `AppSettings` flow (`saveApp` → `putAppSettings` → `mergeDefaults` on load). Genuinely testable logic is isolated into **pure modules** (id sanitizing, identicon cells, slot ops, formatters) with Vitest unit tests; React components are thin wiring verified by typecheck/lint/manual run — matching the repo, which has no component tests.

**Tech Stack:** Electron + React + TypeScript, Zustand store, Tailwind v4 (`cs-*` tokens), shadcn primitives (`popover`, `command`, `hover-card`), lucide-react icons, Vitest (node env, `tests/unit/**`), Biome.

**Spec:** `docs/superpowers/specs/2026-06-05-owner-card-quick-actions-design.md`

---

## Conventions (apply to every task)

- **Branch:** `feat/owner-card-quick-actions` (already exists; the spec is committed there). Work directly in the main checkout — **no worktree** (the branch is already checked out here).
- **Run one test file:** `pnpm exec vitest run <path>`
- **Run all unit tests:** `pnpm test:unit`
- **Typecheck:** `pnpm typecheck`
- **Lint (scoped — repo-wide `biome check` trips on prebuilt artifacts):** `pnpm exec biome check src tests`
- **Commits:** conventional-commit messages shown per task; append the standard `Co-Authored-By: Claude …` trailer.
- Test files live under `tests/unit/**` mirroring `src/**` (e.g. `src/renderer/features/quick-actions/sanitize.ts` → `tests/unit/renderer/features/quick-actions/sanitize.test.ts`). Import source with **relative paths** (matching existing tests).

## File Structure

**New (source):**
- `src/renderer/features/quick-actions/ids.ts` — canonical id list, `QuickActionId` type, defaults, max.
- `src/renderer/features/quick-actions/sanitize.ts` — `sanitizeQuickActionIds()` (drop unknown, dedupe, cap).
- `src/renderer/features/quick-actions/slots.ts` — pure ordered-list ops for the picker.
- `src/renderer/features/quick-actions/identicon-cells.ts` — deterministic pubkey → cell grid.
- `src/renderer/features/quick-actions/Identicon.tsx` — SVG identicon component.
- `src/renderer/features/quick-actions/catalog.tsx` — `QuickActionDef[]` with `run`/`getState`/`confirm`.
- `src/renderer/features/quick-actions/QuickActionButton.tsx` — one button + destructive-confirm popover.
- `src/renderer/features/quick-actions/QuickActions.tsx` — the card's quick-action block.
- `src/renderer/shell/leftnav/ownerFormat.ts` — extracted radio/storage/gps formatters.
- `src/renderer/shell/leftnav/OwnerCardPopover.tsx` — instrument hover popover.
- `src/renderer/panels/settings/quick-actions/QuickActionsTab.tsx` — the settings tab.

**New (tests):**
- `tests/unit/renderer/features/quick-actions/ids.test.ts`
- `tests/unit/renderer/features/quick-actions/sanitize.test.ts`
- `tests/unit/renderer/features/quick-actions/slots.test.ts`
- `tests/unit/renderer/features/quick-actions/identicon-cells.test.ts`
- `tests/unit/renderer/shell/leftnav/ownerFormat.test.ts`

**Modified:**
- `src/shared/types.ts` — `AppSettings.quickActions` + `DEFAULT_APP_SETTINGS`.
- `src/renderer/lib/store.ts` — `SettingsTab` union += `'quickActions'`.
- `src/renderer/panels/settings/routing.ts` — legacy-suffix mapping.
- `src/renderer/panels/settings/SettingsPanel.tsx` — tab registration + render.
- `src/renderer/shell/leftnav/OwnerCard.tsx` — identicon, rail, quick-actions block, popover, formatter imports.

---

## Task 1: `quickActions` setting + canonical id list

**Files:**
- Modify: `src/shared/types.ts` (interface `AppSettings` ~316-404; `DEFAULT_APP_SETTINGS` ~408-442)
- Create: `src/renderer/features/quick-actions/ids.ts`
- Test: `tests/unit/renderer/features/quick-actions/ids.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/features/quick-actions/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUICK_ACTION_IDS,
  MAX_QUICK_ACTIONS,
  QUICK_ACTION_IDS,
} from '../../../../../../src/renderer/features/quick-actions/ids';

describe('quick-action ids', () => {
  it('has unique ids', () => {
    expect(new Set(QUICK_ACTION_IDS).size).toBe(QUICK_ACTION_IDS.length);
  });
  it('caps slots at 4', () => {
    expect(MAX_QUICK_ACTIONS).toBe(4);
  });
  it('defaults are valid, ordered, and within the cap', () => {
    expect(DEFAULT_QUICK_ACTION_IDS).toEqual(['flood', 'gps', 'shareLoc', 'disconnect']);
    expect(DEFAULT_QUICK_ACTION_IDS.length).toBeLessThanOrEqual(MAX_QUICK_ACTIONS);
    for (const id of DEFAULT_QUICK_ACTION_IDS) {
      expect(QUICK_ACTION_IDS).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/features/quick-actions/ids.test.ts`
Expected: FAIL — cannot resolve module `ids` (file does not exist yet).

- [ ] **Step 3: Create the ids module**

Create `src/renderer/features/quick-actions/ids.ts`:

```ts
// Canonical catalog of assignable owner-card quick actions. Kept import-free
// (no store/api/react) so it stays pure and unit-testable, and so the persisted
// settings type can reference QuickActionId without a dependency cycle.
export const QUICK_ACTION_IDS = [
  'flood',
  'direct',
  'gps',
  'shareLoc',
  'copyKey',
  'reboot',
  'disconnect',
] as const;

export type QuickActionId = (typeof QUICK_ACTION_IDS)[number];

/** Owner-card default: primary flood advert + GPS / share-loc toggles + disconnect. */
export const DEFAULT_QUICK_ACTION_IDS: QuickActionId[] = [
  'flood',
  'gps',
  'shareLoc',
  'disconnect',
];

export const MAX_QUICK_ACTIONS = 4;
```

- [ ] **Step 4: Add the persisted setting**

In `src/shared/types.ts`, add the import of the id type near the top of the file (after the existing imports):

```ts
import type { QuickActionId } from '../renderer/features/quick-actions/ids';
```

Then add this field to the `AppSettings` interface, immediately after the `logging` field (before the closing `}` of the interface ~line 403):

```ts
  /** Ordered owner-card quick-action ids (max 4; first renders as the primary
   *  button). Validated against the catalog on read, so unknown/removed ids are
   *  dropped. */
  quickActions: QuickActionId[];
```

And add to `DEFAULT_APP_SETTINGS`, immediately after the `logging:` line (before the closing `}` ~line 441):

```ts
  quickActions: ['flood', 'gps', 'shareLoc', 'disconnect'],
```

> Note: `src/shared/types.ts` importing from `src/renderer/...` is acceptable here because `ids.ts` is import-free. If the project's lint/boundaries object, inline the union instead: `quickActions: ('flood' | 'direct' | 'gps' | 'shareLoc' | 'copyKey' | 'reboot' | 'disconnect')[];` and keep `ids.ts` as the renderer-side source of truth.

- [ ] **Step 5: Run the test to verify it passes + typecheck**

Run: `pnpm exec vitest run tests/unit/renderer/features/quick-actions/ids.test.ts`
Expected: PASS (3 tests).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/features/quick-actions/ids.ts tests/unit/renderer/features/quick-actions/ids.test.ts
git commit -m "feat(quickactions): add quickActions setting + canonical action id list"
```

---

## Task 2: Extract owner-card formatters

**Files:**
- Create: `src/renderer/shell/leftnav/ownerFormat.ts`
- Test: `tests/unit/renderer/shell/leftnav/ownerFormat.test.ts`
- Modify: `src/renderer/shell/leftnav/OwnerCard.tsx` (remove local `fmtFreq`/`fmtBandwidth`/`fmtStorageKb`/`fmtGpsInterval` ~lines 14-29; import them instead)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/shell/leftnav/ownerFormat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  fmtBandwidth,
  fmtFreq,
  fmtFreqMhz,
  fmtGpsInterval,
  fmtStorageKb,
} from '../../../../../src/renderer/shell/leftnav/ownerFormat';

describe('ownerFormat', () => {
  it('formats frequency with and without unit', () => {
    expect(fmtFreqMhz(910_525_000)).toBe('910.525');
    expect(fmtFreq(910_525_000)).toBe('910.525 MHz');
  });
  it('formats bandwidth in kHz', () => {
    expect(fmtBandwidth(62_500)).toBe('62.5 kHz');
  });
  it('formats storage, switching to MB past 1024 KB', () => {
    expect(fmtStorageKb(412)).toBe('412 KB');
    expect(fmtStorageKb(1536)).toBe('1.5 MB');
  });
  it('formats gps interval as minutes on even minutes', () => {
    expect(fmtGpsInterval(300)).toBe('5 min');
    expect(fmtGpsInterval(45)).toBe('45s');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/shell/leftnav/ownerFormat.test.ts`
Expected: FAIL — module `ownerFormat` not found.

- [ ] **Step 3: Create the formatter module**

Create `src/renderer/shell/leftnav/ownerFormat.ts`:

```ts
/** Frequency in Hz as MHz with three decimals, no unit (e.g. "910.525"). */
export function fmtFreqMhz(hz: number): string {
  return (hz / 1e6).toFixed(3);
}
/** Frequency in Hz formatted as MHz with a unit (e.g. "910.525 MHz"). */
export function fmtFreq(hz: number): string {
  return `${fmtFreqMhz(hz)} MHz`;
}
/** Bandwidth in Hz formatted as kHz. */
export function fmtBandwidth(hz: number): string {
  return `${hz / 1000} kHz`;
}
/** Storage in KB formatted as MB once it crosses the threshold. */
export function fmtStorageKb(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}
/** GPS interval seconds formatted as minutes when an even minute. */
export function fmtGpsInterval(sec: number): string {
  return sec % 60 === 0 ? `${sec / 60} min` : `${sec}s`;
}
```

- [ ] **Step 4: Point OwnerCard at the new module**

In `src/renderer/shell/leftnav/OwnerCard.tsx`, **delete** the four local function definitions `fmtFreq`, `fmtBandwidth`, `fmtStorageKb`, `fmtGpsInterval` (the block ~lines 14-29) and add this import alongside the other local imports:

```ts
import { fmtBandwidth, fmtFreq, fmtGpsInterval, fmtStorageKb } from './ownerFormat';
```

(The remaining `RadioDetailsContent` usages of these names now resolve to the imports — no other changes in this task.)

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run tests/unit/renderer/shell/leftnav/ownerFormat.test.ts`
Expected: PASS (4 tests).
Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm exec biome check src tests`
Expected: no errors (no unused-import warnings in OwnerCard).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shell/leftnav/ownerFormat.ts tests/unit/renderer/shell/leftnav/ownerFormat.test.ts src/renderer/shell/leftnav/OwnerCard.tsx
git commit -m "refactor(ownercard): extract radio/format helpers to ownerFormat"
```

---

## Task 3: `sanitizeQuickActionIds`

**Files:**
- Create: `src/renderer/features/quick-actions/sanitize.ts`
- Test: `tests/unit/renderer/features/quick-actions/sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/features/quick-actions/sanitize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sanitizeQuickActionIds } from '../../../../../../src/renderer/features/quick-actions/sanitize';

describe('sanitizeQuickActionIds', () => {
  it('keeps known ids in order', () => {
    expect(sanitizeQuickActionIds(['flood', 'gps', 'disconnect'])).toEqual([
      'flood',
      'gps',
      'disconnect',
    ]);
  });
  it('drops unknown ids', () => {
    expect(sanitizeQuickActionIds(['flood', 'sendLoc', 'bogus', 'gps'])).toEqual(['flood', 'gps']);
  });
  it('drops duplicates, keeping the first', () => {
    expect(sanitizeQuickActionIds(['gps', 'gps', 'flood'])).toEqual(['gps', 'flood']);
  });
  it('caps at 4', () => {
    expect(
      sanitizeQuickActionIds(['flood', 'direct', 'gps', 'shareLoc', 'copyKey', 'reboot']),
    ).toEqual(['flood', 'direct', 'gps', 'shareLoc']);
  });
  it('returns an empty array for empty input', () => {
    expect(sanitizeQuickActionIds([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/features/quick-actions/sanitize.test.ts`
Expected: FAIL — module `sanitize` not found.

- [ ] **Step 3: Implement**

Create `src/renderer/features/quick-actions/sanitize.ts`:

```ts
import { MAX_QUICK_ACTIONS, QUICK_ACTION_IDS, type QuickActionId } from './ids';

const VALID = new Set<string>(QUICK_ACTION_IDS);

/** Normalize persisted quick-action ids: keep only known ids, drop duplicates,
 *  preserve order, and cap at MAX_QUICK_ACTIONS. Defensive so older or
 *  hand-edited settings never crash the card. */
export function sanitizeQuickActionIds(ids: readonly string[]): QuickActionId[] {
  const out: QuickActionId[] = [];
  for (const id of ids) {
    if (!VALID.has(id)) continue;
    const known = id as QuickActionId;
    if (out.includes(known)) continue;
    out.push(known);
    if (out.length >= MAX_QUICK_ACTIONS) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/features/quick-actions/sanitize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/quick-actions/sanitize.ts tests/unit/renderer/features/quick-actions/sanitize.test.ts
git commit -m "feat(quickactions): sanitize persisted quick-action ids"
```

---

## Task 4: Identicon (cells + component)

**Files:**
- Create: `src/renderer/features/quick-actions/identicon-cells.ts`
- Create: `src/renderer/features/quick-actions/Identicon.tsx`
- Test: `tests/unit/renderer/features/quick-actions/identicon-cells.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/features/quick-actions/identicon-cells.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { identiconCells } from '../../../../../../src/renderer/features/quick-actions/identicon-cells';

const HEX = '1a3d3c9f2b7e4a10c8d5f6029ab14e7c3d8f5a21b9e0c4d7f6a3b2c1908e7d6f5';

describe('identiconCells', () => {
  it('returns a 25-cell grid (col*5 + row)', () => {
    expect(identiconCells(HEX)).toHaveLength(25);
  });
  it('is deterministic for the same hex', () => {
    expect(identiconCells(HEX)).toEqual(identiconCells(HEX));
  });
  it('is horizontally mirrored (col 0 == col 4, col 1 == col 3)', () => {
    const cells = identiconCells(HEX);
    for (let row = 0; row < 5; row++) {
      expect(cells[0 * 5 + row]).toBe(cells[4 * 5 + row]);
      expect(cells[1 * 5 + row]).toBe(cells[3 * 5 + row]);
    }
  });
  it('differs for different keys', () => {
    const a = identiconCells(HEX);
    const b = identiconCells('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/features/quick-actions/identicon-cells.test.ts`
Expected: FAIL — module `identicon-cells` not found.

- [ ] **Step 3: Implement the cell generator (ported from the design prototype)**

Create `src/renderer/features/quick-actions/identicon-cells.ts`:

```ts
// Deterministic 5x5 horizontally-mirrored identicon derived from a public-key
// hex string. Ported from the design prototype (owc-card.jsx). Returns 25
// booleans in column-major order: index = col*5 + row, col 0..4, row 0..4.
export function identiconCells(hex: string): boolean[] {
  // Generate the left 3 columns from the key, then mirror to 5.
  const base: boolean[] = [];
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      const i = col * 5 + row;
      const start = (i * 2) % hex.length;
      const b = parseInt(hex.slice(start, start + 2), 16) || hex.charCodeAt(i % hex.length);
      base.push(b % 7 < 3);
    }
  }
  const out: boolean[] = [];
  for (let col = 0; col < 5; col++) {
    const srcCol = col < 3 ? col : 4 - col;
    for (let row = 0; row < 5; row++) {
      out.push(base[srcCol * 5 + row]);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/features/quick-actions/identicon-cells.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the component**

Create `src/renderer/features/quick-actions/Identicon.tsx`:

```tsx
import { identiconCells } from './identicon-cells';

/** Amber-on-dark deterministic identicon for a radio's public key. */
export function Identicon({ hex, size = 32 }: { hex: string; size?: number }) {
  const cells = identiconCells(hex);
  const pad = 5;
  const cell = (size - pad * 2) / 5;
  const rects: React.ReactNode[] = [];
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      if (!cells[col * 5 + row]) continue;
      rects.push(
        <rect
          key={`${col}-${row}`}
          x={pad + col * cell}
          y={pad + row * cell}
          width={cell + 0.5}
          height={cell + 0.5}
          rx={0.8}
          fill="currentColor"
        />,
      );
    }
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-cs-border bg-cs-bg-3 text-cs-accent"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {rects}
      </svg>
    </div>
  );
}
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck` (expected: no errors). Run: `pnpm exec biome check src tests` (expected: no errors).

```bash
git add src/renderer/features/quick-actions/identicon-cells.ts src/renderer/features/quick-actions/Identicon.tsx tests/unit/renderer/features/quick-actions/identicon-cells.test.ts
git commit -m "feat(quickactions): public-key identicon component"
```

---

## Task 5: Quick-action catalog

**Files:**
- Create: `src/renderer/features/quick-actions/catalog.tsx`

This module wires each action to real `api`/store/clipboard calls. It's data+wiring (touches the store/api), so per repo convention it gets **no unit test** — `pnpm typecheck` enforces the `id`/type correctness against `ids.ts`.

- [ ] **Step 1: Create the catalog**

Create `src/renderer/features/quick-actions/catalog.tsx`:

```tsx
import {
  KeyRound,
  LocateFixed,
  type LucideIcon,
  MapPin,
  Megaphone,
  PowerOff,
  Radio,
  RotateCcw,
} from 'lucide-react';
import type { Owner } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import type { QuickActionId } from './ids';

type StoreState = ReturnType<typeof useStore.getState>;

export interface QuickActionCtx {
  client: ApiClient | null;
  owner: Owner | null;
}

export interface QuickActionDef {
  id: QuickActionId;
  /** Full label — primary button + picker menu. */
  label: string;
  /** Compact label — secondary buttons / a11y. */
  short: string;
  icon: LucideIcon;
  kind: 'action' | 'toggle' | 'danger';
  /** Disabled + dimmed when not connected. `copyKey` is false (needs only an owner). */
  requiresConnection: boolean;
  /** Toggles only — live on/off read from the store for the state dot. */
  getState?: (s: StoreState) => boolean;
  /** When set, the button confirms via a shadcn Popover before running. */
  confirm?: { title: string; body?: string; confirmLabel: string };
  run: (ctx: QuickActionCtx) => void | Promise<void>;
}

const ok = (msg: string) => () => notify.success(msg);
const fail = (label: string) => (err: unknown) =>
  notify.error(`${label} failed: ${(err as Error).message}`, err);

export const QUICK_ACTIONS: QuickActionDef[] = [
  {
    id: 'flood',
    label: 'Flood advert',
    short: 'Flood',
    icon: Megaphone,
    kind: 'action',
    requiresConnection: true,
    run: ({ client }) => {
      if (!client) return;
      return api.sendAdvert(client, true).then(ok('Flood advert sent'), fail('Flood advert'));
    },
  },
  {
    id: 'direct',
    label: 'Direct advert',
    short: 'Direct',
    icon: Radio,
    kind: 'action',
    requiresConnection: true,
    run: ({ client }) => {
      if (!client) return;
      return api.sendAdvert(client, false).then(ok('Direct advert sent'), fail('Direct advert'));
    },
  },
  {
    id: 'gps',
    label: 'Toggle GPS',
    short: 'GPS',
    icon: LocateFixed,
    kind: 'toggle',
    requiresConnection: true,
    getState: (s) => s.gpsConfig.enabled,
    run: ({ client }) => {
      if (!client) return;
      const gps = useStore.getState().gpsConfig;
      return api
        .putGpsConfig(client, { ...gps, enabled: !gps.enabled })
        .then(ok(gps.enabled ? 'GPS turned off' : 'GPS turned on'), fail('Toggle GPS'));
    },
  },
  {
    id: 'shareLoc',
    label: 'Share location in advert',
    short: 'Adv loc',
    icon: MapPin,
    kind: 'toggle',
    requiresConnection: true,
    getState: (s) => s.deviceIdentity.sharePositionInAdvert,
    run: ({ client }) => {
      if (!client) return;
      const cur = useStore.getState().deviceIdentity.sharePositionInAdvert;
      return api
        .putDeviceIdentity(client, { sharePositionInAdvert: !cur })
        .then(
          ok(cur ? 'Location no longer shared in advert' : 'Location shared in advert'),
          fail('Update share-location'),
        );
    },
  },
  {
    id: 'copyKey',
    label: 'Copy public key',
    short: 'Key',
    icon: KeyRound,
    kind: 'action',
    requiresConnection: false,
    run: ({ owner }) => {
      if (!owner) return;
      return navigator.clipboard
        .writeText(owner.publicKeyHex)
        .then(ok('Public key copied'), fail('Copy'));
    },
  },
  {
    id: 'reboot',
    label: 'Reboot radio',
    short: 'Reboot',
    icon: RotateCcw,
    kind: 'action',
    requiresConnection: true,
    confirm: {
      title: 'Reboot radio?',
      body: 'The radio will be unavailable for a few seconds.',
      confirmLabel: 'Reboot',
    },
    run: ({ client }) => {
      if (!client) return;
      return api.rebootDevice(client).then(ok('Reboot requested'), fail('Reboot'));
    },
  },
  {
    id: 'disconnect',
    label: 'Disconnect',
    short: 'Unplug',
    icon: PowerOff,
    kind: 'danger',
    requiresConnection: true,
    confirm: { title: 'Disconnect radio?', confirmLabel: 'Disconnect' },
    run: ({ client }) => {
      if (!client) return;
      return api.disconnect(client).then(ok('Disconnected'), fail('Disconnect'));
    },
  },
];

export const QUICK_ACTIONS_BY_ID: Record<QuickActionId, QuickActionDef> = Object.fromEntries(
  QUICK_ACTIONS.map((a) => [a.id, a]),
) as Record<QuickActionId, QuickActionDef>;
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: no errors (every `id` must be a `QuickActionId`; `Record<QuickActionId, …>` ensures full coverage).
Run: `pnpm exec biome check src tests`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/features/quick-actions/catalog.tsx
git commit -m "feat(quickactions): quick-action catalog with run/getState/confirm"
```

---

## Task 6: `QuickActionButton` (with destructive-confirm popover)

**Files:**
- Create: `src/renderer/features/quick-actions/QuickActionButton.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/features/quick-actions/QuickActionButton.tsx`:

```tsx
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import type { QuickActionCtx, QuickActionDef } from './catalog';

interface Props {
  def: QuickActionDef;
  ctx: QuickActionCtx;
  variant: 'primary' | 'secondary';
  enabled: boolean;
}

/** One owner-card quick action. Toggles show a live state dot; actions with a
 *  `confirm` open a small anchored popover before firing. */
export function QuickActionButton({ def, ctx, variant, enabled }: Props) {
  const [open, setOpen] = useState(false);
  const on = useStore((s) => (def.getState ? def.getState(s) : false));
  const Icon = def.icon;
  const isToggle = def.kind === 'toggle';
  const isDanger = def.kind === 'danger';

  const fire = () => {
    void def.run(ctx);
  };

  const className = cn(
    'relative flex items-center justify-center gap-1.5 rounded-md border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    variant === 'primary' ? 'h-8 w-full px-2' : 'h-7 flex-1 px-0',
    isToggle && on
      ? 'border-cs-accent/30 bg-cs-accent-soft/15 text-cs-text'
      : 'border-cs-border bg-cs-bg-3 text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text',
    isDanger && 'hover:border-cs-danger/40 hover:bg-cs-danger/10 hover:text-cs-danger',
  );

  const inner = (
    <>
      <Icon aria-hidden className={cn('size-3.5 shrink-0', isToggle && on && 'text-cs-accent')} />
      {variant === 'primary' && <span>{def.label}</span>}
      {isToggle && (
        <span
          aria-hidden
          className={cn(
            'absolute right-1 top-1 size-1.5 rounded-full',
            on ? 'bg-cs-online' : 'bg-cs-text-dim',
          )}
        />
      )}
    </>
  );

  if (!def.confirm) {
    return (
      <button
        type="button"
        onClick={fire}
        disabled={!enabled}
        title={def.label}
        aria-label={def.label}
        className={className}
      >
        {inner}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!enabled}
          title={def.label}
          aria-label={def.label}
          className={className}
        >
          {inner}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-56 p-3">
        <p className="text-[12px] font-medium text-cs-text">{def.confirm.title}</p>
        {def.confirm.body && <p className="mt-1 text-[11px] text-cs-text-muted">{def.confirm.body}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-cs-border px-2.5 py-0.5 text-[12px] text-cs-text-muted hover:text-cs-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              fire();
            }}
            className="rounded border border-cs-danger bg-cs-danger px-2.5 py-0.5 text-[12px] font-medium text-cs-bg hover:bg-cs-danger/90"
          >
            {def.confirm.confirmLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck` (expected: no errors). Run: `pnpm exec biome check src tests` (expected: no errors).

> If `PopoverContent` in `src/renderer/components/ui/popover.tsx` does not accept a `side` prop, drop `side="top"` (Radix defaults to bottom) — confirm the prop set by opening that file; do not invent props.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/features/quick-actions/QuickActionButton.tsx
git commit -m "feat(quickactions): QuickActionButton with destructive-confirm popover"
```

---

## Task 7: `QuickActions` block

**Files:**
- Create: `src/renderer/features/quick-actions/QuickActions.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/features/quick-actions/QuickActions.tsx`:

```tsx
import { Settings2 } from 'lucide-react';
import type { Owner } from '../../../shared/types';
import type { ApiClient } from '../../lib/api';
import { useStore } from '../../lib/store';
import { QUICK_ACTIONS_BY_ID, type QuickActionDef } from './catalog';
import { DEFAULT_QUICK_ACTION_IDS, type QuickActionId } from './ids';
import { QuickActionButton } from './QuickActionButton';
import { sanitizeQuickActionIds } from './sanitize';

interface Props {
  owner: Owner | null;
  client: ApiClient | null;
  /** Override the persisted ids (used by the settings-tab live preview). */
  idsOverride?: QuickActionId[];
}

/** The owner-card quick-action block: a primary button + up to three secondary
 *  icon buttons, rendered from the user's configured ids. */
export function QuickActions({ owner, client, idsOverride }: Props) {
  const persisted = useStore((s) => s.appSettings.quickActions);
  const connected = useStore((s) => s.transportState === 'connected');
  const setActiveKey = useStore((s) => s.setActiveKey);

  const ids = idsOverride ?? persisted ?? DEFAULT_QUICK_ACTION_IDS;
  const defs = sanitizeQuickActionIds(ids).map((id) => QUICK_ACTIONS_BY_ID[id]);
  const ctx = { client, owner };
  const hasOwner = !!owner;
  const enabledOf = (d: QuickActionDef) => (d.requiresConnection ? connected : hasOwner);

  return (
    <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wide text-cs-text-dim">
          Quick actions
        </span>
        <button
          type="button"
          title="Configure quick actions"
          aria-label="Configure quick actions"
          onClick={() => setActiveKey('tool:settings:quickActions')}
          className="text-cs-text-dim transition-colors hover:text-cs-text"
        >
          <Settings2 className="size-3" aria-hidden />
        </button>
      </div>

      {defs.length === 0 ? (
        <button
          type="button"
          onClick={() => setActiveKey('tool:settings:quickActions')}
          className="rounded-md border border-dashed border-cs-border px-2 py-1.5 text-[11px] text-cs-text-dim transition-colors hover:text-cs-text"
        >
          Configure quick actions…
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <QuickActionButton def={defs[0]} ctx={ctx} variant="primary" enabled={enabledOf(defs[0])} />
          {defs.length > 1 && (
            <div className="flex gap-1.5">
              {defs.slice(1).map((d) => (
                <QuickActionButton
                  key={d.id}
                  def={d}
                  ctx={ctx}
                  variant="secondary"
                  enabled={enabledOf(d)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck` (expected: no errors). Run: `pnpm exec biome check src tests` (expected: no errors).

```bash
git add src/renderer/features/quick-actions/QuickActions.tsx
git commit -m "feat(quickactions): owner-card quick-actions block"
```

---

## Task 8: Pure slot operations (for the picker)

**Files:**
- Create: `src/renderer/features/quick-actions/slots.ts`
- Test: `tests/unit/renderer/features/quick-actions/slots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/features/quick-actions/slots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addSlot,
  availableToAdd,
  moveSlot,
  removeSlot,
  setSlot,
} from '../../../../../../src/renderer/features/quick-actions/slots';

describe('slot operations', () => {
  it('availableToAdd returns catalog ids not already used', () => {
    expect(availableToAdd(['flood', 'gps'])).toEqual([
      'direct',
      'shareLoc',
      'copyKey',
      'reboot',
      'disconnect',
    ]);
  });
  it('addSlot appends, ignoring duplicates and the 4-slot cap', () => {
    expect(addSlot(['flood'], 'gps')).toEqual(['flood', 'gps']);
    expect(addSlot(['flood'], 'flood')).toEqual(['flood']);
    expect(addSlot(['flood', 'direct', 'gps', 'shareLoc'], 'copyKey')).toEqual([
      'flood',
      'direct',
      'gps',
      'shareLoc',
    ]);
  });
  it('removeSlot removes by index', () => {
    expect(removeSlot(['flood', 'gps', 'disconnect'], 1)).toEqual(['flood', 'disconnect']);
  });
  it('setSlot replaces the id at an index', () => {
    expect(setSlot(['flood', 'gps'], 1, 'disconnect')).toEqual(['flood', 'disconnect']);
  });
  it('moveSlot reorders and clamps out-of-range moves', () => {
    expect(moveSlot(['flood', 'gps', 'disconnect'], 2, 1)).toEqual(['flood', 'disconnect', 'gps']);
    expect(moveSlot(['flood', 'gps'], 0, -1)).toEqual(['flood', 'gps']);
    expect(moveSlot(['flood', 'gps'], 1, 2)).toEqual(['flood', 'gps']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/features/quick-actions/slots.test.ts`
Expected: FAIL — module `slots` not found.

- [ ] **Step 3: Implement**

Create `src/renderer/features/quick-actions/slots.ts`:

```ts
import { MAX_QUICK_ACTIONS, QUICK_ACTION_IDS, type QuickActionId } from './ids';

/** Catalog ids not yet assigned to a slot, in catalog order. */
export function availableToAdd(slots: readonly QuickActionId[]): QuickActionId[] {
  return QUICK_ACTION_IDS.filter((id) => !slots.includes(id));
}

/** Append an id unless it's a duplicate or the cap is reached. */
export function addSlot(slots: readonly QuickActionId[], id: QuickActionId): QuickActionId[] {
  if (slots.includes(id) || slots.length >= MAX_QUICK_ACTIONS) return [...slots];
  return [...slots, id];
}

/** Remove the slot at `index`. */
export function removeSlot(slots: readonly QuickActionId[], index: number): QuickActionId[] {
  return slots.filter((_, i) => i !== index);
}

/** Replace the id at `index`. (Caller only offers unassigned ids, so no dedupe.) */
export function setSlot(
  slots: readonly QuickActionId[],
  index: number,
  id: QuickActionId,
): QuickActionId[] {
  return slots.map((cur, i) => (i === index ? id : cur));
}

/** Move the slot at `from` to `to`; out-of-range moves return the list unchanged. */
export function moveSlot(
  slots: readonly QuickActionId[],
  from: number,
  to: number,
): QuickActionId[] {
  if (from < 0 || from >= slots.length || to < 0 || to >= slots.length) return [...slots];
  const next = [...slots];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/features/quick-actions/slots.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/quick-actions/slots.ts tests/unit/renderer/features/quick-actions/slots.test.ts
git commit -m "feat(quickactions): pure slot-list operations for the picker"
```

---

## Task 9: Quick Actions settings tab (component + registration)

**Files:**
- Create: `src/renderer/panels/settings/quick-actions/QuickActionsTab.tsx`
- Modify: `src/renderer/lib/store.ts` (`SettingsTab` union, line ~142)
- Modify: `src/renderer/panels/settings/routing.ts` (`LEGACY_SUFFIX_TO_TAB`)
- Modify: `src/renderer/panels/settings/SettingsPanel.tsx` (`TAB_SECTIONS`, `pillTabs`, tab render, imports)

- [ ] **Step 1: Widen the `SettingsTab` union**

In `src/renderer/lib/store.ts` (line ~142) change:

```ts
export type SettingsTab = 'app' | 'radio' | 'blocked' | 'extra';
```
to:
```ts
export type SettingsTab = 'app' | 'quickActions' | 'radio' | 'blocked' | 'extra';
```

- [ ] **Step 2: Map the deep-link suffix**

In `src/renderer/panels/settings/routing.ts`, add to the `LEGACY_SUFFIX_TO_TAB` record:

```ts
  quickActions: 'quickActions',
```

(So `setActiveKey('tool:settings:quickActions')` → `tabFromActiveKey` → `'quickActions'`.)

- [ ] **Step 3: Create the tab component**

Create `src/renderer/panels/settings/quick-actions/QuickActionsTab.tsx`:

```tsx
import { ChevronDown, ChevronUp, Pencil, Plus, X, Zap } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { QUICK_ACTIONS_BY_ID, type QuickActionDef } from '../../../features/quick-actions/catalog';
import { MAX_QUICK_ACTIONS, type QuickActionId } from '../../../features/quick-actions/ids';
import { QuickActions } from '../../../features/quick-actions/QuickActions';
import { sanitizeQuickActionIds } from '../../../features/quick-actions/sanitize';
import {
  addSlot,
  availableToAdd,
  moveSlot,
  removeSlot,
  setSlot,
} from '../../../features/quick-actions/slots';
import { useStore } from '../../../lib/store';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from '../app/shared';
import type { SectionProps } from '../radio/shared';

const eqQuickActions = (a: AppSettingsType, b: AppSettingsType) =>
  a.quickActions.length === b.quickActions.length &&
  a.quickActions.every((id, i) => id === b.quickActions[i]);

/** Searchable picker popover (reuses the command-palette cmdk primitives). */
function ActionPicker({
  available,
  onPick,
  trigger,
}: {
  available: QuickActionDef[];
  onPick: (id: QuickActionId) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Search actions…" />
          <CommandList>
            <CommandEmpty>No actions left.</CommandEmpty>
            <CommandGroup>
              {available.map((d) => {
                const Icon = d.icon;
                return (
                  <CommandItem
                    key={d.id}
                    value={d.label}
                    onSelect={() => {
                      onPick(d.id);
                      setOpen(false);
                    }}
                  >
                    <Icon className="size-3.5 text-cs-text-muted" aria-hidden />
                    <span>{d.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function QuickActionsTab({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const owner = useStore((s) => s.owner);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'quickActions-actions',
    saved,
    eq: eqQuickActions,
    onSave: (d) => saveApp(client, { quickActions: d.quickActions }, 'Quick actions saved'),
  });

  const slots = sanitizeQuickActionIds(draft.quickActions);
  const setSlots = (next: QuickActionId[]) => setDraft((s) => ({ ...s, quickActions: next }));
  const available = availableToAdd(slots).map((id) => QUICK_ACTIONS_BY_ID[id]);

  return (
    <SettingsSection
      id="quickActions-actions"
      icon={Zap}
      title="Owner Card Quick Actions"
      description="Choose up to 4 actions for the owner card. The first is the large primary button."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <div className="flex flex-col gap-1.5">
        {slots.map((id, i) => {
          const def = QUICK_ACTIONS_BY_ID[id];
          const Icon = def.icon;
          return (
            <div
              key={id}
              className="flex items-center gap-2 rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1.5"
            >
              <Icon className="size-4 shrink-0 text-cs-text-muted" aria-hidden />
              <span className="flex-1 text-[12px] text-cs-text">{def.label}</span>
              {i === 0 && (
                <span className="rounded-sm bg-cs-accent-soft/30 px-1 font-mono text-[9px] uppercase tracking-wide text-cs-accent">
                  Primary
                </span>
              )}
              {def.kind === 'toggle' && (
                <span className="font-mono text-[9px] uppercase tracking-wide text-cs-text-dim">
                  Toggle
                </span>
              )}
              {def.kind === 'danger' && (
                <span className="font-mono text-[9px] uppercase tracking-wide text-cs-danger">
                  Danger
                </span>
              )}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => setSlots(moveSlot(slots, i, i - 1))}
                  className="rounded p-1 text-cs-text-dim hover:text-cs-text disabled:opacity-30"
                >
                  <ChevronUp className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === slots.length - 1}
                  onClick={() => setSlots(moveSlot(slots, i, i + 1))}
                  className="rounded p-1 text-cs-text-dim hover:text-cs-text disabled:opacity-30"
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                </button>
                <ActionPicker
                  available={available}
                  onPick={(picked) => setSlots(setSlot(slots, i, picked))}
                  trigger={
                    <button
                      type="button"
                      aria-label="Change action"
                      className="rounded p-1 text-cs-text-dim hover:text-cs-text"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                  }
                />
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => setSlots(removeSlot(slots, i))}
                  className="rounded p-1 text-cs-text-dim hover:text-cs-danger"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {slots.length < MAX_QUICK_ACTIONS && available.length > 0 && (
        <ActionPicker
          available={available}
          onPick={(picked) => setSlots(addSlot(slots, picked))}
          trigger={
            <button
              type="button"
              className="mt-1 flex items-center gap-1.5 rounded-md border border-dashed border-cs-border px-2 py-1.5 text-[12px] text-cs-text-muted hover:text-cs-text"
            >
              <Plus className="size-3.5" aria-hidden />
              Add action
            </button>
          }
        />
      )}

      <div className="mt-4">
        <span className="font-mono text-[9px] uppercase tracking-wide text-cs-text-dim">Preview</span>
        <div className="mt-1.5 w-56 rounded-lg border border-cs-border bg-cs-bg-2 p-2">
          <div className="pointer-events-none">
            <QuickActions owner={owner} client={client} idsOverride={slots} />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
```

Add the missing React import at the top of the file:

```tsx
import { useState } from 'react';
```

- [ ] **Step 4: Register the tab in `SettingsPanel.tsx`**

In `src/renderer/panels/settings/SettingsPanel.tsx`:

(a) Add `Zap` to the lucide import on line 1:
```ts
import { Cog, Radio, Settings, ShieldOff, Wrench, Zap } from 'lucide-react';
```

(b) Import the tab (with the other tab imports near the top):
```ts
import { QuickActionsTab } from './quick-actions/QuickActionsTab';
```

(c) Add a `quickActions` entry to `TAB_SECTIONS` (after the `app:` block, before `radio:`):
```ts
  quickActions: [{ id: 'quickActions-actions', title: 'Owner Card Quick Actions', tab: 'quickActions' }],
```

(d) Add the pill to `pillTabs` (after the `app` entry):
```ts
    { id: 'quickActions', label: 'Quick Actions', icon: Zap },
```

(e) Add the tab render (after the `{activeTab === 'app' && …}` line):
```tsx
        {activeTab === 'quickActions' && <QuickActionsTab client={client} />}
```

- [ ] **Step 5: Typecheck and fix any union-exhaustiveness fallout**

Run: `pnpm typecheck`
Expected: clean — but widening `SettingsTab` can surface non-exhaustive `Record<SettingsTab, …>` / `switch` errors elsewhere (e.g. `StatusPill`). If any appear, add the `quickActions` case there (mirror the `app` tab's handling). Re-run until clean.

- [ ] **Step 6: Lint + manual verification**

Run: `pnpm exec biome check src tests` (expected: no errors).
Manual: launch the app (`pnpm start`), open Settings → **Quick Actions** tab; add/remove/reorder/change actions; confirm the preview updates and **Save** persists (reopen Settings to confirm). Also click the owner-card gear and confirm it lands on this tab.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/panels/settings/quick-actions/QuickActionsTab.tsx src/renderer/lib/store.ts src/renderer/panels/settings/routing.ts src/renderer/panels/settings/SettingsPanel.tsx
git commit -m "feat(settings): Quick Actions settings tab"
```

---

## Task 10: OwnerCard integration (identicon + rail + quick actions)

**Files:**
- Modify: `src/renderer/shell/leftnav/OwnerCard.tsx`

- [ ] **Step 1: Update imports**

In `src/renderer/shell/leftnav/OwnerCard.tsx`:

- **Remove** now-unused imports: `Megaphone`, `User` (from lucide), `useCallback`, `useState`, and the `api` import (`import { type ApiClient, api } from '../../lib/api';` → keep only the type: `import type { ApiClient } from '../../lib/api';`).
- **Add**:
```ts
import { Radio } from 'lucide-react';
import { Identicon } from '../../features/quick-actions/Identicon';
import { QuickActions } from '../../features/quick-actions/QuickActions';
import { fmtFreqMhz, fmtGpsInterval } from './ownerFormat';
```
  (Keep the existing `Copy` import and the `fmtBandwidth, fmtFreq, fmtGpsInterval, fmtStorageKb` import added in Task 2 — note `fmtGpsInterval` is now used by both `RadioDetailsContent` and the rail, so import it once.)
- **Remove** the now-unused `TRANSPORT_LABEL` and `TRANSPORT_DOT` constants (~lines 31-45).

- [ ] **Step 2: Replace the `OwnerCard` component body**

Replace the entire exported `OwnerCard` function (the `export function OwnerCard(...) { … }` block) with:

```tsx
/** Header identity card — identicon, name, battery, instrument rail, and the
 *  user's configured quick actions. Hovering the header reveals full radio detail. */
export function OwnerCard({ owner, client }: { owner: Owner | null; client: ApiClient | null }) {
  const deviceInfo = useStore((s) => s.deviceInfo);
  const radio = useStore((s) => s.radioSettings);
  const identity = useStore((s) => s.deviceIdentity);
  const gps = useStore((s) => s.gpsConfig);
  const transport = useStore((s) => s.transportState);
  const pathHashMode = radio.pathHashMode;
  const connected = transport === 'connected';

  const battMv = deviceInfo.batteryMv;
  const battPct = lipoPercent(battMv);
  const battText =
    battMv > 0 ? `${formatVoltage(battMv)}${battPct !== null ? ` · ${battPct}%` : ''}` : '—';

  return (
    <SidebarMenu>
      <SidebarMenuItem className="p-1 group-data-[collapsible=icon]:p-0">
        <HoverCard openDelay={200} closeDelay={120}>
          <div className="flex flex-col gap-2">
            {/* Hovering this top row reveals the full radio details. */}
            <HoverCardTrigger asChild>
              <div className="flex items-center gap-2">
                {owner ? (
                  <Identicon hex={owner.publicKeyHex} size={32} />
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cs-border bg-cs-bg-3 text-cs-text-dim">
                    <Radio className="size-4" aria-hidden />
                  </div>
                )}
                <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                  <span data-testid="owner-name" className="truncate text-sm font-medium text-cs-text">
                    {owner?.name ?? 'No identity'}
                  </span>
                  {owner ? (
                    <div className="flex w-fit items-center gap-1.5">
                      <CopyButton
                        value={owner.publicKeyHex}
                        title="Copy full public key"
                        className="flex items-center gap-1 rounded font-mono text-[10px] tracking-wide text-cs-text-dim hover:text-cs-text"
                      >
                        <span className="truncate">{owner.publicKeyHex.slice(0, 6)}</span>
                        <Copy aria-hidden="true" className="size-2.5 shrink-0" />
                      </CopyButton>
                      <span
                        title={`Path hash size: ${pathHashMode} byte${pathHashMode > 1 ? 's' : ''} per hop`}
                        className="rounded-sm bg-cs-bg-3 px-1 font-mono text-[9px] uppercase tracking-wide text-cs-text-dim"
                      >
                        {pathHashMode}b
                      </span>
                    </div>
                  ) : (
                    <span className="truncate font-mono text-[10px] tracking-wide text-cs-text-dim">
                      configure to send adverts
                    </span>
                  )}
                </div>
              </div>
            </HoverCardTrigger>

            {/* Detail block — hidden when the sidebar is icon-collapsed */}
            <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
              {/* Battery — grays out and prompts to connect when offline */}
              <div className={cn('transition-opacity', !connected && 'opacity-50')}>
                {connected ? (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-cs-text-dim">Battery</span>
                    <span className="font-mono tabular-nums text-cs-text-muted">{battText}</span>
                  </div>
                ) : (
                  <div className="text-[10px] text-cs-text-dim">Connect to show battery</div>
                )}
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-cs-bg-3">
                  <div
                    className="h-full bg-cs-accent transition-[width] duration-300"
                    style={{ width: `${connected ? (battPct ?? 0) : 0}%` }}
                  />
                </div>
              </div>

              {/* Instrument rail — radio state at a glance */}
              <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
                <RailCell k="FREQ" v={fmtFreqMhz(radio.frequencyHz)} accent />
                <RailCell k="SF" v={String(radio.spreadingFactor)} />
                <RailCell k="TX" v={`${radio.txPowerDbm}dB`} />
                <RailCell
                  k="GPS"
                  v={gps.enabled ? fmtGpsInterval(gps.intervalSec) : 'off'}
                  accent={gps.enabled}
                />
                <RailCell
                  k="ADV·LOC"
                  v={identity.sharePositionInAdvert ? 'on' : 'off'}
                  accent={identity.sharePositionInAdvert}
                />
                <RailCell k="RPT" v={radio.repeatMode ? 'on' : 'off'} />
              </div>

              {/* Configurable quick actions */}
              <QuickActions owner={owner} client={client} />
            </div>
          </div>
          <HoverCardContent align="start" side="right" sideOffset={8} className="w-64 p-3">
            <RadioDetailsContent owner={owner} />
          </HoverCardContent>
        </HoverCard>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** One cell of the instrument rail (label over mono value). */
function RailCell({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[8.5px] uppercase tracking-wide text-cs-text-dim">{k}</span>
      <span className={cn('font-mono text-[11px]', accent ? 'text-cs-accent' : 'text-cs-text')}>
        {v}
      </span>
    </div>
  );
}
```

(Leave `RadioDetailsContent` unchanged — Task 11 replaces it.)

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck`
Expected: no errors. If any unused-symbol errors remain (e.g. a leftover `TransportState` import only used by the removed constants), remove those imports too.
Run: `pnpm exec biome check src tests`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Launch the app (`pnpm start`): the owner card shows the identicon (no avatar/online dot), the instrument rail, and the configured quick-action buttons. Toggle buttons (GPS/share-loc) show the state dot and flip on click; **Disconnect**/**Reboot** open the confirm popover; offline disables connection-only actions. Change the actions in Settings → Quick Actions and confirm the card reflects it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/leftnav/OwnerCard.tsx
git commit -m "feat(ownercard): identicon + instrument rail + configurable quick actions"
```

---

## Task 11: Instrument hover popover

**Files:**
- Create: `src/renderer/shell/leftnav/OwnerCardPopover.tsx`
- Modify: `src/renderer/shell/leftnav/OwnerCard.tsx` (swap `RadioDetailsContent` for `OwnerCardPopover`; remove the now-dead `RadioDetailsContent` + its unique imports)

- [ ] **Step 1: Create the instrument popover**

Create `src/renderer/shell/leftnav/OwnerCardPopover.tsx`:

```tsx
import { MapPin } from 'lucide-react';
import type { Owner } from '../../../shared/types';
import { lipoPercent } from '../../lib/battery';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { fmtBandwidth, fmtFreqMhz, fmtGpsInterval, fmtStorageKb } from './ownerFormat';

function Ring({
  pct,
  label,
  sub,
  tone = 'accent',
}: {
  pct: number;
  label: string;
  sub: string;
  tone?: 'accent' | 'dim' | 'online';
}) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const stroke =
    tone === 'online'
      ? 'rgb(var(--cs-online))'
      : tone === 'dim'
        ? 'rgb(var(--cs-accent-soft))'
        : 'rgb(var(--cs-accent))';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative size-11">
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(var(--cs-bg-3))" strokeWidth="4" />
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={off}
            transform="rotate(-90 22 22)"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-cs-text">
          {label}
        </div>
      </div>
      <span className="font-mono text-[8.5px] uppercase tracking-wide text-cs-text-dim">{sub}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-cs-text-dim">
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-cs-text-muted">{k}</span>
      <span className={cn('font-mono text-[11px]', accent ? 'text-cs-accent' : 'text-cs-text')}>
        {v}
      </span>
    </div>
  );
}

function CapBar({ k, used, max, value }: { k: string; used: number; max: number; value: string }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-14 text-[11px] text-cs-text-muted">{k}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-cs-bg-3">
        <div className="h-full rounded-full bg-cs-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right font-mono text-[10px] text-cs-text">{value}</span>
    </div>
  );
}

function MiniStat({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        'flex-1 rounded border px-1.5 py-1 text-center font-mono text-[9.5px]',
        on
          ? 'border-cs-accent/25 bg-cs-accent-soft/15 text-cs-text'
          : 'border-cs-border bg-cs-bg-3 text-cs-text-dim',
      )}
    >
      {label}
    </span>
  );
}

/** Instrument-style hover popover: gauges, radio grid, capacity bars, position. */
export function OwnerCardPopover(_props: { owner: Owner | null }) {
  const deviceInfo = useStore((s) => s.deviceInfo);
  const radio = useStore((s) => s.radioSettings);
  const identity = useStore((s) => s.deviceIdentity);
  const gps = useStore((s) => s.gpsConfig);
  const contactCount = useStore((s) => s.contacts.length);
  const channelCount = useStore((s) => s.channels.length);

  const battPct = lipoPercent(deviceInfo.batteryMv) ?? 0;
  const maxContacts = deviceInfo.maxContacts || 0;
  const maxChannels = deviceInfo.maxChannels || 0;
  const storageTotal = deviceInfo.storageTotalKb || 0;
  const storagePct = storageTotal > 0 ? (deviceInfo.storageUsedKb / storageTotal) * 100 : 0;
  const hasLocation = identity.lat !== null && identity.lon !== null;

  return (
    <div className="flex flex-col gap-3">
      {/* Gauges */}
      <div className="flex justify-around">
        <Ring pct={battPct} label={`${battPct}`} sub="Battery %" />
        <Ring
          pct={storagePct}
          label={fmtStorageKb(deviceInfo.storageUsedKb).replace(/ (KB|MB)$/, '')}
          sub="Storage"
          tone="dim"
        />
        <Ring
          pct={maxContacts > 0 ? (contactCount / maxContacts) * 100 : 0}
          label={`${contactCount}`}
          sub="Contacts"
          tone="online"
        />
      </div>

      <Group title="Radio">
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <KV k="Freq" v={`${fmtFreqMhz(radio.frequencyHz)} MHz`} accent />
          <KV k="BW" v={fmtBandwidth(radio.bandwidthHz)} />
          <KV k="SF" v={`${radio.spreadingFactor}`} />
          <KV k="CR" v={`4/${radio.codingRate}`} />
          <KV k="TX" v={`${radio.txPowerDbm} dBm`} />
          <KV k="Repeat" v={radio.repeatMode ? 'On' : 'Off'} />
        </div>
      </Group>

      <Group title="Capacity">
        <CapBar
          k="Contacts"
          used={contactCount}
          max={maxContacts}
          value={`${contactCount} / ${maxContacts || '—'}`}
        />
        <CapBar
          k="Channels"
          used={channelCount}
          max={maxChannels}
          value={`${channelCount} / ${maxChannels || '—'}`}
        />
        <CapBar
          k="Storage"
          used={deviceInfo.storageUsedKb}
          max={storageTotal}
          value={
            storageTotal > 0
              ? `${fmtStorageKb(deviceInfo.storageUsedKb)} / ${fmtStorageKb(storageTotal)}`
              : '—'
          }
        />
      </Group>

      <Group title="Position">
        <div className="flex items-center gap-2">
          <MapPin
            className={cn('size-3.5', identity.sharePositionInAdvert ? 'text-cs-accent' : 'text-cs-text-dim')}
            aria-hidden
          />
          <span className="font-mono text-[11px] text-cs-text">
            {hasLocation ? `${identity.lat?.toFixed(5)}, ${identity.lon?.toFixed(5)}` : 'Not set'}
          </span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <MiniStat
            on={gps.enabled}
            label={gps.enabled ? `GPS ${fmtGpsInterval(gps.intervalSec)}` : 'GPS off'}
          />
          <MiniStat
            on={identity.sharePositionInAdvert}
            label={identity.sharePositionInAdvert ? 'shared in advert' : 'not shared'}
          />
        </div>
      </Group>
    </div>
  );
}
```

- [ ] **Step 2: Swap the popover in `OwnerCard.tsx`**

In `src/renderer/shell/leftnav/OwnerCard.tsx`:

(a) Replace the hover content usage:
```tsx
          <HoverCardContent align="start" side="right" sideOffset={8} className="w-72 p-3">
            <OwnerCardPopover owner={owner} />
          </HoverCardContent>
```
(b) **Delete** the entire `RadioDetailsContent` function (~lines 168-260 of the original file).
(c) Add the import:
```ts
import { OwnerCardPopover } from './OwnerCardPopover';
```
(d) **Remove** imports now only used by the deleted `RadioDetailsContent`: `KeyValueGroup`, `KeyValueRow` (the `'./ui/KeyValueRow'`/`KeyValueRow` import line) and the `fmtBandwidth`, `fmtFreq`, `fmtStorageKb` names from the `./ownerFormat` import (the card itself now only uses `fmtFreqMhz` and `fmtGpsInterval`). Keep whatever `OwnerCardPopover` doesn't need out of `OwnerCard`.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck`
Expected: no errors. Fix any remaining unused-import errors flagged for `OwnerCard.tsx`.
Run: `pnpm exec biome check src tests`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Launch (`pnpm start`): hover the owner-card header → the instrument popover shows three gauges (battery/storage/contacts), the radio grid, capacity bars, and position with GPS/share mini-stats. Values match the radio's current state.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/leftnav/OwnerCardPopover.tsx src/renderer/shell/leftnav/OwnerCard.tsx
git commit -m "feat(ownercard): instrument hover popover"
```

---

## Final verification (after all tasks)

- [ ] Run the full unit suite: `pnpm test:unit` — expected: all pass (including the 5 new pure-logic test files).
- [ ] `pnpm typecheck` — expected: clean.
- [ ] `pnpm exec biome check src tests` — expected: clean.
- [ ] Manual smoke (`pnpm start`): owner card (identicon + rail + quick actions), confirm popovers on Disconnect/Reboot, toggle state dots, offline disabling, the instrument hover popover, and the Settings → Quick Actions tab (add/remove/reorder/change/save + gear deep-link).

## Self-Review (completed during planning)

- **Spec coverage:** Identicon (Task 4, 10) · instrument rail (Task 10) · configurable quick actions / catalog / `requiresConnection` / toggle state / danger confirm (Tasks 5-7, 10) · `sendLoc` excluded (catalog omits it, Task 5) · shadcn Popover confirm (Task 6) · instrument popover (Task 11) · Quick Actions settings tab with ordered slots + command-menu picker + live preview (Task 9) · persistence via `AppSettings.quickActions` + `mergeDefaults` (Task 1) · gear deep-link (Tasks 7, 9) · `resolveQuickActions`→ implemented as `sanitizeQuickActionIds` (Task 3) drop-unknown + cap-4. All spec sections map to a task.
- **Testing deviation (intentional):** the spec listed component/render tests; the repo has no component-test infra (`@testing-library/react` absent), so testable logic is isolated into pure modules with real TDD unit tests, and React wiring is verified by typecheck/lint/manual run — consistent with the repo's existing tests.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code.
- **Type consistency:** `QuickActionId`, `QuickActionDef`, `QuickActionCtx`, `QUICK_ACTIONS_BY_ID`, `sanitizeQuickActionIds`, the slot ops, and `fmtFreqMhz`/`fmtGpsInterval` are defined once and referenced consistently across tasks. `SettingsTab` union widening is handled in `TAB_SECTIONS` and flagged for any other exhaustive switch (Task 9 Step 5).
