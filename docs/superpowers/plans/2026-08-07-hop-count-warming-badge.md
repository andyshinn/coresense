# Hop Count Warming Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dim `5h` hop-count text in the message meta line and path rows with a `HopBadge` whose colour warms continuously with distance, normalised against the hop ceiling implied by the message's own path-hash mode.

**Architecture:** One pure module (`lib/hopWarmth.ts`) owns the entire ramp — the ceiling table, the warmth fraction, the CSS `color-mix` strings and the tooltip text — so all of it is unit-testable in Node with no DOM. One thin presentational component (`components/HopBadge.tsx`) consumes it and contributes only markup and Tailwind geometry, mirroring its sibling `PathHashBadge`. Two call sites swap their plain hop text for the badge.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (`@theme` + `--cs-*` CSS custom properties), shadcn `Badge` (cva), Vitest (`unit` = Node, `dom` = jsdom + Testing Library), Biome.

**Spec:** `docs/superpowers/specs/2026-08-07-hop-count-warming-badge-design.md`

**One refinement on the spec:** the spec sketched the `color-mix` string and the
tooltip text as inline expressions in `HopBadge`. This plan moves both into
`hopWarmth.ts` as `hopTint` and `hopTitle`. jsdom's CSS parser silently drops
declarations it cannot parse — `color-mix` among them — so a component-level
assertion on the inline style would pass or fail for reasons unrelated to the
ramp. Built as plain strings in the Node project they are exactly assertable,
and the component is left with nothing but markup. Same rendered output, no
change to any token or to the ramp.

## Global Constraints

- **Design tokens are RGB channel triplets**, not hex: `--cs-hop-far: 245 158 11;`, consumed as `rgb(var(--cs-hop-far))`. This is how every `--cs-*` token in `index.css` works.
- **Dark values live in `:root`; light overrides live in `:root:not(.dark)`.** `applyTheme()` toggles `.dark` on `<html>`. Follow the existing `--cs-hash-*` block exactly.
- **Contrast bar is 4.5:1** against the worst substrate. For this unfilled badge the substrate is the panel itself (`bg`, `bg-2`, `bg-3`) — *not* a tint fill. Do not change the four token values; they were swept and verified.
- **A hash mode is only ever 1, 2 or 3.** Anything else — including `0` and `null` — means "we never observed it" and must produce zero warming.
- **Run tooling through `npx`, not `pnpm <script>`.** In a worktree `pnpm` re-runs its dependency check and reflink-fails. `npx vitest`, `npx tsc`, `npx biome`.
- **Lint scope is `src tests`.** Bare `npx biome check` walks pre-existing `build/`, `dist/` and `out/` artifacts and fails on them.
- **Never delete or reformat an existing explanatory comment** while editing these files. The `PathHashBadge` and `index.css` comments record contrast measurements and regression history.

## Before You Start

This worktree has no `node_modules` yet:

```bash
pnpm install
```

That one command is the exception to the `npx` rule — it is the install itself. Verify the baseline is green before changing anything:

```bash
npx vitest run
```

Expected: all suites pass.

---

### Task 1: The ramp module

Everything about "how a hop count becomes a colour" lives in one pure file. No React, no DOM — so it can be tested in the fast Node project, and so the component that consumes it has nothing left to test but markup.

The CSS strings live here rather than in the component on purpose: jsdom's CSS parser silently drops values it cannot parse, and `color-mix(…)` is one of them, so an inline-style assertion in a jsdom test would be worthless. Built as a plain string in Node, it is exactly assertable.

**Files:**
- Create: `src/renderer/lib/hopWarmth.ts`
- Test: `tests/unit/renderer/lib/hopWarmth.test.ts`

**Interfaces:**
- Consumes: `PathHashSize` (`1 | 2 | 3`) from `src/shared/types.ts`.
- Produces:
  - `HOP_CEILING: Record<PathHashSize, number>`
  - `HOP_RAMP_CAP_DIVISOR: number`
  - `HASH_MODE_UNKNOWN: number` (`0`)
  - `isKnownHashMode(hashMode: number | null | undefined): hashMode is PathHashSize`
  - `hopCeiling(hashMode: number | null | undefined): number | null`
  - `hopWarmth(hops: number, hashMode: number | null | undefined): number` — 0→1
  - `hopTint(hops: number, hashMode: number | null | undefined): { color: string; borderColor: string }`
  - `hopTitle(hops: number, hashMode: number | null | undefined): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/hopWarmth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  HASH_MODE_UNKNOWN,
  HOP_CEILING,
  HOP_RAMP_CAP_DIVISOR,
  hopCeiling,
  hopTint,
  hopTitle,
  hopWarmth,
  isKnownHashMode,
} from '../../../../src/renderer/lib/hopWarmth';

describe('isKnownHashMode', () => {
  it.each([1, 2, 3])('accepts the firmware-emittable mode %d', (m) => {
    expect(isKnownHashMode(m)).toBe(true);
  });

  it.each([null, undefined, 0, 4, -1, 1.5, Number.NaN])('rejects %s', (m) => {
    expect(isKnownHashMode(m as number | null)).toBe(false);
  });
});

describe('hopCeiling', () => {
  // 64-byte path buffer / bytes-per-hop.
  it('is 64 hops in 1-byte mode', () => expect(hopCeiling(1)).toBe(64));
  it('is 32 hops in 2-byte mode', () => expect(hopCeiling(2)).toBe(32));
  it('is 21 hops in 3-byte mode', () => expect(hopCeiling(3)).toBe(21));
  it('is null when the mode is unknown', () => expect(hopCeiling(null)).toBeNull());
});

describe('hopWarmth', () => {
  it('is 0 for a direct message in every mode', () => {
    expect(hopWarmth(0, 1)).toBe(0);
    expect(hopWarmth(0, 2)).toBe(0);
    expect(hopWarmth(0, 3)).toBe(0);
  });

  it('reaches 1 exactly at the soft cap (ceiling / divisor)', () => {
    expect(hopWarmth(HOP_CEILING[1] / HOP_RAMP_CAP_DIVISOR, 1)).toBe(1); // 16h
    expect(hopWarmth(HOP_CEILING[2] / HOP_RAMP_CAP_DIVISOR, 2)).toBe(1); // 8h
    expect(hopWarmth(HOP_CEILING[3] / HOP_RAMP_CAP_DIVISOR, 3)).toBe(1); // 5.25h
  });

  it('is half warm at half the cap', () => {
    expect(hopWarmth(8, 1)).toBe(0.5);
    expect(hopWarmth(4, 2)).toBe(0.5);
  });

  // The whole point of the feature: the same count reads hotter the more
  // expensive the hash mode, because the budget it spends is smaller.
  it('warms faster the smaller the ceiling', () => {
    expect(hopWarmth(4, 1)).toBeCloseTo(0.25, 5);
    expect(hopWarmth(4, 2)).toBeCloseTo(0.5, 5);
    expect(hopWarmth(4, 3)).toBeCloseTo(0.7619, 4);
  });

  it('saturates rather than exceeding 1 past the cap', () => {
    expect(hopWarmth(64, 1)).toBe(1);
    expect(hopWarmth(9, 2)).toBe(1);
  });

  it('clamps a count above the ceiling instead of overflowing', () => {
    expect(hopWarmth(9999, 1)).toBe(1);
  });

  it('clamps a negative count to the cool end', () => {
    expect(hopWarmth(-3, 2)).toBe(0);
  });

  it.each([null, undefined, HASH_MODE_UNKNOWN, 4])(
    'stays cool when the mode is %s — no ceiling means no honest distance',
    (mode) => {
      expect(hopWarmth(9, mode as number | null)).toBe(0);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('stays cool for a non-finite count (%s)', (hops) => {
    expect(hopWarmth(hops, 1)).toBe(0);
  });
});

describe('hopTint', () => {
  it('interpolates far→near in oklab at an integer percent', () => {
    expect(hopTint(4, 2)).toEqual({
      color: 'color-mix(in oklab, rgb(var(--cs-hop-far)) 50%, rgb(var(--cs-hop-near)))',
      borderColor:
        'color-mix(in srgb, color-mix(in oklab, rgb(var(--cs-hop-far)) 50%, rgb(var(--cs-hop-near))) 46%, transparent)',
    });
  });

  it('rounds to a whole percent so the emitted string is stable', () => {
    // 1/8 = 12.5% and 3/8 = 37.5% — both must land on an integer.
    expect(hopTint(1, 2).color).toContain(' 13%,');
    expect(hopTint(3, 2).color).toContain(' 38%,');
    // 1 / 5.25 = 19.047…%
    expect(hopTint(1, 3).color).toContain(' 19%,');
  });

  it('sits at 0% for a direct message', () => {
    expect(hopTint(0, 2).color).toContain(' 0%,');
  });

  it('sits at 0% when the mode is unknown, whatever the count', () => {
    expect(hopTint(9, null).color).toContain(' 0%,');
  });
});

describe('hopTitle', () => {
  it('names the ceiling and the mode so the normalisation is discoverable', () => {
    expect(hopTitle(4, 2)).toBe('4 hops · max 32 (2-byte path hash)');
  });

  it('uses the singular for a single hop', () => {
    expect(hopTitle(1, 1)).toBe('1 hop · max 64 (1-byte path hash)');
  });

  it('says "0 hops" for a direct message', () => {
    expect(hopTitle(0, 3)).toBe('0 hops · max 21 (3-byte path hash)');
  });

  it('omits the ceiling clause when the mode is unknown', () => {
    expect(hopTitle(4, null)).toBe('4 hops');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/lib/hopWarmth.test.ts`
Expected: FAIL — `Failed to resolve import ".../src/renderer/lib/hopWarmth"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/lib/hopWarmth.ts`:

```ts
// The hop-count warming ramp: how a relay hop count becomes a colour. Pure and
// DOM-free so every part of it — including the CSS strings — is unit-testable
// in Node. The CSS lives here rather than in HopBadge because jsdom's parser
// silently drops values it can't parse (color-mix among them), which would make
// an inline-style assertion in a component test meaningless.

import type { PathHashSize } from '../../shared/types';

/** Maximum hop count per path-hash mode. The routing path is a fixed 64-byte
 *  buffer and each hop consumes `hashMode` bytes, so the ceiling is
 *  floor(64 / hashMode). */
export const HOP_CEILING: Record<PathHashSize, number> = { 1: 64, 2: 32, 3: 21 };

/** The fade completes at `ceiling / HOP_RAMP_CAP_DIVISOR` hops rather than at
 *  the ceiling itself: real traffic clusters at the low end, and a ramp that
 *  only saturated at 64 would leave nearly every badge sitting cool and doing
 *  no work. This is the tuning knob — raise it to make the ramp reach further
 *  before it maxes out. */
export const HOP_RAMP_CAP_DIVISOR = 4;

/** Stand-in for "we never observed the path-hash mode", used by paths the
 *  renderer synthesizes from a bare hop count. Outside 1/2/3, so it already
 *  reads as unknown to both `hopWarmth` and `PathHashBadge`. */
export const HASH_MODE_UNKNOWN = 0;

/** Narrow a raw hash mode to the 1/2/3 the firmware can actually emit. The one
 *  place the "is this mode real" question is answered. */
export function isKnownHashMode(hashMode: number | null | undefined): hashMode is PathHashSize {
  return hashMode === 1 || hashMode === 2 || hashMode === 3;
}

/** Hop ceiling for a mode, or null when the mode is unknown. */
export function hopCeiling(hashMode: number | null | undefined): number | null {
  return isKnownHashMode(hashMode) ? HOP_CEILING[hashMode] : null;
}

/** How far into this hash mode's hop budget the packet travelled, 0 (cool) to
 *  1 (hot). Returns 0 when the mode is unknown: without a ceiling there is no
 *  honest distance to claim, so the badge stays at the cool end rather than
 *  asserting a reach we never observed. */
export function hopWarmth(hops: number, hashMode: number | null | undefined): number {
  const ceiling = hopCeiling(hashMode);
  if (ceiling == null || !Number.isFinite(hops)) return 0;
  const clamped = Math.min(Math.max(hops, 0), ceiling);
  return Math.min(clamped / (ceiling / HOP_RAMP_CAP_DIVISOR), 1);
}

/** Inline style for the badge — the ramp is continuous, so the colour can't be
 *  a Tailwind class. Percent is rounded to a whole number to keep the emitted
 *  string stable. The border is the same tint at 46%, matching the outline
 *  treatment the design settled on. */
export function hopTint(
  hops: number,
  hashMode: number | null | undefined,
): { color: string; borderColor: string } {
  const pct = Math.round(hopWarmth(hops, hashMode) * 100);
  const color = `color-mix(in oklab, rgb(var(--cs-hop-far)) ${pct}%, rgb(var(--cs-hop-near)))`;
  return { color, borderColor: `color-mix(in srgb, ${color} 46%, transparent)` };
}

/** Tooltip text. Naming the ceiling is what makes the per-mode normalisation
 *  discoverable — without it, "4h" warmer in 3-byte mode than in 1-byte mode
 *  just looks like a bug. */
export function hopTitle(hops: number, hashMode: number | null | undefined): string {
  const count = `${hops} hop${hops === 1 ? '' : 's'}`;
  const ceiling = hopCeiling(hashMode);
  return ceiling == null ? count : `${count} · max ${ceiling} (${hashMode}-byte path hash)`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/lib/hopWarmth.test.ts`
Expected: PASS, 35 tests (`it.each` blocks expand — 10 for `isKnownHashMode`, 4 for `hopCeiling`, 13 for `hopWarmth`, 4 each for `hopTint` and `hopTitle`).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check --write src tests`
Expected: no errors; Biome may reorder imports.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/hopWarmth.ts tests/unit/renderer/lib/hopWarmth.test.ts
git commit -m "feat(hops): add the hop-count warming ramp

The ramp normalises a hop count against the ceiling its path-hash mode
implies (64/32/21 hops for 1/2/3 bytes per hop) and fades over a quarter
of that ceiling, so the badge reads as routing headroom spent rather than
absolute relay count. An unknown mode yields zero warmth — without a
ceiling there is no honest distance to claim.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The badge component and its tokens

The component is deliberately thin — all logic landed in Task 1, so what remains is markup, geometry and the two new colour tokens.

**Files:**
- Create: `src/renderer/components/HopBadge.tsx`
- Modify: `src/renderer/index.css` (add tokens after `--cs-hash-3` in `:root`, and inside `:root:not(.dark)`)
- Test: `tests/component/hop-badge.test.tsx`

**Interfaces:**
- Consumes: `hopTint`, `hopTitle` from `src/renderer/lib/hopWarmth.ts` (Task 1); `Badge` from `src/renderer/components/ui/badge.tsx`.
- Produces: `HopBadge({ hops, hashMode }: { hops: number | null; hashMode: number | null })` — returns `null` when `hops` is `null`. No `className` prop.

- [ ] **Step 1: Add the ramp tokens**

In `src/renderer/index.css`, immediately after the `--cs-hash-3:` line inside `:root`, add:

```css
  /* Hop-count warming ramp. HopBadge interpolates near→far in oklab as the hop
     count climbs toward its hash mode's ceiling (see lib/hopWarmth.ts).
     Contrast is the tint as text against the PANEL — bg / bg-2 / bg-3 — not
     against a fill: unlike PathHashBadge this badge is unfilled, so the panel
     is the effective background. Every interpolated point between near and far
     clears 4.5:1 too. Light mode's endpoint is NOT the brand accent: #B45309
     manages only 3.74:1 here, so the far end is a deeper orange that also
     keeps the badge off --cs-hash-2's amber, which it sits beside.
     `near` matches --cs-text-muted so a direct 0-hop message is as quiet as
     the meta text around it, but stays a separate token so retuning muted body
     text doesn't silently move the ramp. */
  --cs-hop-near: 193 178 145; /* #C1B291 — 9.46 / 8.84 / 8.15 */
  --cs-hop-far: 245 158 11; /* #F59E0B — 9.21 / 8.60 / 7.93 */
```

Then inside the existing `:root:not(.dark)` block, after the `--cs-hash-3:` override, add:

```css
  --cs-hop-near: 92 78 56; /* #5C4E38 — 7.67 / 7.02 / 6.01 */
  --cs-hop-far: 150 67 10; /* #96430A — 6.43 / 5.88 / 5.04 */
```

No `@theme` entries. Unlike `--cs-hash-*`, these are never consumed by a Tailwind utility — the ramp is continuous, so the colour can only be an inline `color-mix`. Raw channels are all that is needed.

- [ ] **Step 2: Write the failing test**

Create `tests/component/hop-badge.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HopBadge } from '../../src/renderer/components/HopBadge';

function badgeEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-slot="badge"]');
  if (!el) throw new Error('badge not found');
  return el as HTMLElement;
}

describe('HopBadge', () => {
  it('renders the count with a de-emphasised unit', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    expect(badgeEl(container).textContent).toBe('4h');
  });

  it('renders 0h for a direct message rather than nothing', () => {
    const { container } = render(<HopBadge hops={0} hashMode={2} />);
    expect(badgeEl(container).textContent).toBe('0h');
  });

  it('renders nothing when the hop count is unknown', () => {
    const { container } = render(<HopBadge hops={null} hashMode={2} />);
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('still renders the count when only the hash mode is unknown', () => {
    const { container } = render(<HopBadge hops={7} hashMode={null} />);
    expect(badgeEl(container).textContent).toBe('7h');
  });

  it('titles the badge with the ceiling its mode implies', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    expect(badgeEl(container).getAttribute('title')).toBe('4 hops · max 32 (2-byte path hash)');
  });

  it('drops the ceiling clause from the title when the mode is unknown', () => {
    const { container } = render(<HopBadge hops={4} hashMode={null} />);
    expect(badgeEl(container).getAttribute('title')).toBe('4 hops');
  });

  // The unit must be a separate element so it can be weight-de-emphasised, but
  // both must sit inside ONE flex child — badgeVariants ships `gap-1`, which
  // would otherwise render "4 h" instead of "4h". Same trap PathHashBadge hit.
  it('groups the number and unit so the badge gap cannot split "4h"', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    const badge = badgeEl(container);
    const group = Array.from(badge.querySelectorAll('span')).find((s) => s.textContent === '4h');
    expect(group).toBeDefined();
    const unit = group?.querySelector('span');
    expect(unit?.textContent).toBe('h');
    expect(unit?.className).toContain('font-normal');
  });

  // Regression, inherited from PathHashBadge: `text-[10px]` is an arbitrary
  // value, so Tailwind emits font-size only and the badge would inherit a
  // unitless line-height from whichever ancestor it lands under.
  it('pins its own line-height so ancestors cannot inflate it', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    expect(badgeEl(container).className).toContain('leading-none');
  });

  // The badge is unfilled — that is what separates it from the filled
  // PathHashBadge beside it and what makes the panel the contrast substrate.
  it('uses the outline variant so it carries no fill', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    expect(badgeEl(container).getAttribute('data-variant')).toBe('outline');
    // Anchored to a token boundary on purpose: badgeVariants' own outline
    // string carries `[a&]:hover:bg-accent`, so a bare /bg-/ would always
    // match. What must be absent is an UNPREFIXED background utility.
    expect(badgeEl(container).className).not.toMatch(/(^|\s)bg-/);
  });
});
```

Note there is deliberately **no** assertion on the inline `color` here — jsdom drops `color-mix`. That string is covered by `hopTint`'s Node tests in Task 1.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run --project dom tests/component/hop-badge.test.tsx`
Expected: FAIL — `Failed to resolve import ".../src/renderer/components/HopBadge"`.

- [ ] **Step 4: Write the implementation**

Create `src/renderer/components/HopBadge.tsx`:

```tsx
import { hopTint, hopTitle } from '../lib/hopWarmth';
import { Badge } from './ui/badge';

/** Monospace badge for a relay hop count. Sibling to PathHashBadge: same
 *  geometry and the same de-emphasised trailing unit, so `4h` and `2b` read as
 *  one family — but unfilled, which is what keeps the two apart when they sit
 *  side by side in the same meta line. Colour warms with distance; see
 *  lib/hopWarmth.ts for the ramp and index.css for the endpoints.
 *
 *  Renders nothing when `hops` is null. 0 is a real value (direct). */
export function HopBadge({ hops, hashMode }: { hops: number | null; hashMode: number | null }) {
  if (hops == null) return null;
  return (
    <Badge
      variant="outline"
      title={hopTitle(hops, hashMode)}
      // Continuous ramp ⇒ no Tailwind class can express it. Inline colour from
      // a token is precedented here (see path/PathItem.tsx's snrTokenVar).
      style={hopTint(hops, hashMode)}
      // Geometry mirrors PathHashBadge. `leading-none` is load-bearing — see
      // the note there for why an arbitrary text size needs it pinned.
      className="rounded-sm border px-1 py-0.5 font-mono text-[10px] leading-none font-semibold tabular-nums"
    >
      {/* One flex child: badgeVariants ships `gap-1`, so a bare text node beside
          the unit span would render "4 h". Weight alone de-emphasises the unit —
          an opacity knock-down drops it under 3:1, as PathHashBadge found. */}
      <span>
        {hops}
        <span className="font-normal">h</span>
      </span>
    </Badge>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project dom tests/component/hop-badge.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check --write src tests`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/HopBadge.tsx src/renderer/index.css tests/component/hop-badge.test.tsx
git commit -m "feat(hops): add HopBadge and the warming ramp tokens

Unfilled sibling to PathHashBadge. Dropping the fill is what lets the two
badges sit together — they separate by weight rather than hue — and it
moves the contrast substrate to the panel, which is what lets light mode
reach a real orange at 5.04:1 instead of the 3.74:1 the brand accent
manages there.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Message meta line

Swap the dim hop text for the badge, and retire the string formatter it leaves behind.

**Files:**
- Modify: `src/renderer/components/MessageItem.tsx` (imports at line 6; `TrailingMeta` ~line 181; `PathStatsMeta` ~line 193)
- Modify: `src/renderer/lib/messagePath.ts` (delete `formatPathStats`)
- Test: `tests/unit/renderer/lib/messagePath.test.ts` (delete its `formatPathStats` block)
- Test: `tests/component/message-item-path-stats.test.tsx` (create)

**Interfaces:**
- Consumes: `HopBadge` (Task 2); `isKnownHashMode` (Task 1); existing `firstPathStats` / `PathStats` from `lib/messagePath.ts`.
- Produces: nothing new. `formatPathStats` is **removed** from `lib/messagePath.ts`; `firstPathStats` and the `PathStats` interface are untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/component/message-item-path-stats.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import { useStore } from '@/lib/store';
import type { Message, MessageHop, MessageStyle } from '../../src/shared/types';

const hop = (kind: MessageHop['kind'], shortId = 'xx'): MessageHop => ({ kind, shortId });

function msg(meta: Message['meta']): Message {
  return { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'name:nodey', body: 'hi', ts: 0, state: 'received', meta };
}

function renderItem(meta: Message['meta'], style: MessageStyle = 'rich') {
  return render(
    <MessageItem message={msg(meta)} isSelf={false} style={style} senderName="nodey" timeFormat="24h" />,
  );
}

function badgeTexts(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-slot="badge"]')).map((b) => b.textContent);
}

beforeEach(() => {
  useStore.setState({ contacts: [], discovered: [] });
});

describe('MessageItem path stats', () => {
  it('renders the hop count as a badge, not as bare text', () => {
    const { container } = renderItem({
      paths: [{ id: 'p', hashMode: 2, finalSnr: 0, hops: [hop('origin'), hop('hop'), hop('hop'), hop('sink')] }],
    });
    expect(badgeTexts(container)).toContain('2h');
  });

  it('pairs the hop badge with the path-hash badge', () => {
    const { container } = renderItem({
      paths: [{ id: 'p', hashMode: 2, finalSnr: 0, hops: [hop('origin'), hop('hop'), hop('sink')] }],
    });
    expect(badgeTexts(container)).toContain('1h');
    expect(badgeTexts(container)).toContain('2b');
  });

  it('shows the hop badge but no hash badge when the mode was never observed', () => {
    const { container } = renderItem({ hops: 3 });
    expect(badgeTexts(container)).toContain('3h');
    expect(badgeTexts(container).some((t) => t?.endsWith('b'))).toBe(false);
  });

  it('renders no hop badge at all when there is no path data', () => {
    const { container } = renderItem(undefined);
    expect(badgeTexts(container).some((t) => t?.endsWith('h'))).toBe(false);
  });

  // The compact density reaches PathStatsMeta through TrailingMeta's own
  // `hasPath` gate, so it needs covering separately from rich.
  it('renders the badge in the compact density too', () => {
    const { container } = renderItem(
      { paths: [{ id: 'p', hashMode: 3, finalSnr: 0, hops: [hop('origin'), hop('hop'), hop('sink')] }] },
      'compact',
    );
    expect(badgeTexts(container)).toContain('1h');
    expect(badgeTexts(container)).toContain('3b');
  });
});
```

`MessageItemProps` requires exactly `message`, `isSelf`, `style`, `senderName` and `timeFormat`; everything else is optional. `style="rich"` reaches `PathStatsMeta` directly (MessageItem.tsx:130); `style="compact"` reaches it through `TrailingMeta` (line 108), which is why both are covered.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project dom tests/component/message-item-path-stats.test.tsx`
Expected: FAIL — the hop count still renders as bare text, so no badge has textContent `2h`.

- [ ] **Step 3: Update `MessageItem.tsx`**

Change the import on line 6 from:

```tsx
import { firstPathStats, formatPathStats, type PathStats } from '../lib/messagePath';
```

to:

```tsx
import { isKnownHashMode } from '../lib/hopWarmth';
import { firstPathStats, type PathStats } from '../lib/messagePath';
```

and add `import { HopBadge } from './HopBadge';` alongside the other local component imports. Biome will sort them in Step 6.

Replace the body of `TrailingMeta`'s first line:

```tsx
  const hasPath = stats.hops != null || isKnownHashMode(stats.hashMode);
```

Replace `PathStatsMeta` entirely:

```tsx
/** Hop count and path-hash mode as a badge pair. Renders nothing when neither
 *  is known. The hop badge is unfilled and the hash badge filled, which is what
 *  keeps them legible side by side. */
function PathStatsMeta({ stats }: { stats: PathStats }) {
  if (stats.hops == null && !isKnownHashMode(stats.hashMode)) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <HopBadge hops={stats.hops} hashMode={stats.hashMode} />
      {isKnownHashMode(stats.hashMode) && <PathHashBadge bytes={stats.hashMode} />}
    </span>
  );
}
```

Switching both guards from `!= null` to `isKnownHashMode` is behaviour-preserving today — `firstPathStats` only ever yields `null` or 1/2/3 — but it keeps the two guards from drifting apart, and it is what makes Task 4's synthesized unknown mode safe.

- [ ] **Step 4: Delete `formatPathStats`**

In `src/renderer/lib/messagePath.ts`, remove the `formatPathStats` function and its doc comment. `MessageItem` was its only consumer. Leave `firstPathStats`, the `PathStats` interface and the module header comment intact.

In `tests/unit/renderer/lib/messagePath.test.ts`, delete the whole `describe('formatPathStats (hops label)', …)` block and drop `formatPathStats` from the import on line 2. Leave every `firstPathStats` case untouched.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project dom tests/component/message-item-path-stats.test.tsx && npx vitest run --project unit tests/unit/renderer/lib/messagePath.test.ts`
Expected: both PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check --write src tests`
Expected: no errors. `tsc` here is what proves nothing else referenced `formatPathStats`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/MessageItem.tsx src/renderer/lib/messagePath.ts tests/component/message-item-path-stats.test.tsx tests/unit/renderer/lib/messagePath.test.ts
git commit -m "feat(hops): warm the hop count in the message meta line

Replaces the dim 5h text with HopBadge beside the existing path-hash
badge. formatPathStats had no other consumer and goes with it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Path rows, and an honest unknown mode

`PathItem` gets the same treatment. This task also fixes a small existing lie: when no mesh observation exists, `HeardVia` synthesizes a path from a bare hop count and stamps `hashMode: 1` on it — asserting a 64-hop ceiling it never observed. Left alone, that would make a synthesized path render *warmed* against a fabricated ceiling.

**Files:**
- Modify: `src/renderer/components/path/PathItem.tsx:55-69`
- Modify: `src/renderer/shell/rightrail/sections/HeardVia.tsx:43`
- Test: `tests/component/path-item-hops.test.tsx` (create)

**Interfaces:**
- Consumes: `HopBadge` (Task 2); `isKnownHashMode`, `HASH_MODE_UNKNOWN` (Task 1).
- Produces: nothing new. `MessagePath.hashMode` keeps its `number` type — widening it to `number | null` would ripple into `contextBuilder.ts`'s `hash_mode` macro variable, which is user-facing template surface and out of scope.

- [ ] **Step 1: Write the failing test**

Create `tests/component/path-item-hops.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathItem } from '../../src/renderer/components/path/PathItem';
import { HASH_MODE_UNKNOWN } from '../../src/renderer/lib/hopWarmth';
import type { MessageHop, MessagePath } from '../../src/shared/types';

const hop = (kind: MessageHop['kind'], shortId = 'xx'): MessageHop => ({ kind, shortId });

function path(hashMode: number, hopCount: number): MessagePath {
  return {
    id: 'p',
    hashMode,
    finalSnr: 0,
    hops: [hop('origin'), ...Array.from({ length: hopCount }, () => hop('hop')), hop('sink')],
  };
}

function renderRow(p: MessagePath) {
  return render(<PathItem path={p} knownRepeaters={[]} open={false} onToggle={() => {}} />);
}

function badges(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-slot="badge"]')).map((b) => b.textContent);
}

describe('PathItem hop count', () => {
  it('renders the hop count as a badge instead of "N hops" text', () => {
    const { container } = renderRow(path(2, 3));
    expect(badges(container)).toContain('3h');
    expect(container.textContent).not.toContain('3 hops');
  });

  it('pairs it with the path-hash badge for a known mode', () => {
    const { container } = renderRow(path(2, 3));
    expect(badges(container)).toContain('2b');
  });

  it('renders no hash badge for a synthesized path with no observed mode', () => {
    const { container } = renderRow(path(HASH_MODE_UNKNOWN, 3));
    expect(badges(container)).toContain('3h');
    expect(badges(container)).not.toContain('0b');
    expect(container.textContent).not.toContain('0b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project dom tests/component/path-item-hops.test.tsx`
Expected: FAIL — the row still renders `3 hops` as text, and a mode of 0 still renders a `0b` chip.

- [ ] **Step 3: Update `PathItem.tsx`**

Add `import { HopBadge } from '../HopBadge';` and `import { isKnownHashMode } from '../../lib/hopWarmth';` to the imports.

Replace the meta line (currently lines 55-69) with:

```tsx
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-cs-text-dim">
            <HopBadge hops={hopCount} hashMode={path.hashMode} />
            {isKnownHashMode(path.hashMode) && (
              <>
                <span aria-hidden>·</span>
                <PathHashBadge bytes={path.hashMode} />
                <span>path</span>
              </>
            )}
            {conflictCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5 text-cs-warn">
                  <AlertTriangle size={10} aria-hidden />
                  {conflictCount}
                </span>
              </>
            )}
          </div>
```

The `·` separator and the trailing `path` word belong to the hash badge, so they move inside its guard — otherwise an unknown-mode row would render a dangling `· path`.

- [ ] **Step 4: Update `HeardVia.tsx`**

Add `import { HASH_MODE_UNKNOWN } from '../../../lib/hopWarmth';` and, in `synthesizeUnnamedPath`'s return object, change:

```tsx
    hashMode: 1,
```

to:

```tsx
    // Synthesized from a bare hop count precisely because no observation
    // exists — so we never saw the hash mode either. Claiming 1 here would
    // assert a 64-hop ceiling and warm the badge against a number we invented.
    hashMode: HASH_MODE_UNKNOWN,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project dom tests/component/path-item-hops.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check --write src tests`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/path/PathItem.tsx src/renderer/shell/rightrail/sections/HeardVia.tsx tests/component/path-item-hops.test.tsx
git commit -m "feat(hops): warm the hop count in path rows

Also stops HeardVia's synthesized path claiming hashMode 1. That path is
built from a bare hop count precisely because no observation exists, so
the mode was never seen either — asserting 1 would have warmed the badge
against an invented 64-hop ceiling.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none modified — this task only runs gates.

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, every project. Nothing should be skipped and no suite should have shrunk except `messagePath.test.ts`, which intentionally lost its `formatPathStats` block.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Lint**

Run: `npx biome check src tests`
Expected: no diagnostics. Scope to `src tests` — a bare `biome check` walks pre-existing `build/`, `dist/` and `out/` artifacts and fails on them.

- [ ] **Step 4: Confirm no stale references remain**

Run: `grep -rn "formatPathStats" src tests`
Expected: no matches.

Run: `grep -rn "hashMode: 1," src`
Expected: no matches (the only one was `HeardVia`'s synthesized path).

- [ ] **Step 5: Look at it in the running app**

Run: `npx electron-forge start`

Check the message list and the Heard-via rail section: a 0-hop message should be the quietest thing on the meta line, and hop count should visibly warm with distance. Toggle the theme in Settings → Appearance and confirm the light ramp is legible at both ends and still distinguishable from the `2b` badge beside it.

If no radio is available, drive it through the existing replay fixture instead — see `tests/e2e/connect-replay.spec.ts` and the `CORESENSE_FAKE_TRANSPORT` / `CORESENSE_USER_DATA` env vars it sets.

- [ ] **Step 6: Commit anything the gates changed**

If Steps 1-3 produced no file changes, skip this. Otherwise:

```bash
git add -A
git commit -m "chore(hops): verification fixups

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Do not retune the four token values.** They came out of a sweep of the warm gamut against every panel substrate in both themes. `#B45309` (the light brand accent) specifically does **not** clear the bar here.
- **`HOP_RAMP_CAP_DIVISOR` is the knob**, and it is expected to be retuned once the ramp has been seen against real traffic — at 1-byte mode, 1 hop is only 6% warm. That is a known, accepted starting point, not a bug to fix mid-implementation.
- **The badge must stay unfilled.** The fill is what would collide it with `PathHashBadge` (identical amber at 6 hops in 2-byte mode) and what would push light mode under AA. If a reviewer suggests adding `bg-*`, point them at the spec's Colour section.
