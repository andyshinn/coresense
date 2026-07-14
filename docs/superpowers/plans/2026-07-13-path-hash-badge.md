# Path Hash Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five ad-hoc path-hash-size treatments (`2-byte` / `2b` / `2B`) with one reusable, mode-tinted `PathHashBadge` component.

**Architecture:** A thin wrapper over the existing shadcn `Badge` renders `{n}b` with a leading lucide `TrendingUpDown` icon, tinted per mode from three new `--cs-hash-*` design tokens. Every read-only display of the per-hop path-hash mode swaps to this component. The message-meta line, which currently joins hops+mode into one string, is refactored so hops stay as text and the mode becomes a badge.

**Tech Stack:** React 19, Tailwind CSS v4 (`@theme` tokens + `cn`/tailwind-merge), class-variance-authority, lucide-react, Vitest (jsdom `dom` project + Node `unit` project), Biome.

## Global Constraints

- **Run tooling via `npx`, not `pnpm <script>`.** In this worktree the `pnpm` script wrapper triggers a pre-run deps check (`pnpm install`) that fails on a sandbox reflink denial (`ERR_PNPM_EPERM`). Use: `npx vitest run --project unit`, `npx vitest run --project dom`, `npx tsc --noEmit`, `npx biome check src tests`, `npx biome format --write <files>`.
- **Biome scope is `src tests` only** — a repo-wide `biome check` trips on pre-existing build/dist artifacts.
- **`git add` / `git commit` need the sandbox disabled** (worktree git restriction). All other commands run sandboxed.
- **Before each commit**, run `npx biome format --write <changed files>` so committed code is formatted.
- **Domain:** `PathHashSize = 1 | 2 | 3` (`src/shared/types.ts:90`). The component accepts `bytes: number` and renders a neutral tone for any value outside 1/2/3.
- **Copy/visual rules (from the handoff):** number leads; lowercase `b` unit at weight 400 / opacity .55; `tabular-nums`; colour is driven by **mode only** (never state, signal, or route); the badge is informational and non-interactive.
- **Baseline:** `npx vitest run --project unit` → 66 files / 330 tests passing before changes.
- **Spec:** `docs/superpowers/specs/2026-07-13-path-hash-badge-design.md`.

---

## File Structure

- **Create** `src/renderer/components/PathHashBadge.tsx` — the badge component (sibling to `RssiChip`).
- **Create** `tests/component/path-hash-badge.test.tsx` — jsdom test for the component.
- **Modify** `src/renderer/index.css` — add three `--cs-hash-*` raw-channel vars + three `--color-cs-hash-*` theme colors.
- **Modify** `src/renderer/lib/messagePath.ts` — repurpose `formatPathStats` to hops-only.
- **Modify** `tests/unit/renderer/lib/messagePath.test.ts` — update `formatPathStats` expectations.
- **Modify** `src/renderer/components/MessageItem.tsx` — render hops text + `PathHashBadge` via a shared local `PathStatsMeta`.
- **Modify** `src/renderer/components/path/PathItem.tsx` — path-viewer meta line.
- **Modify** `src/renderer/shell/leftnav/OwnerCard.tsx` — identity chip.
- **Modify** `src/renderer/shell/rightrail/sections/ContactDetail.tsx` — "Path hash size" row.
- **Modify** `src/renderer/components/path/SetPathEditor.tsx` — mode label (+ remove now-unused `Badge` import).

---

## Task 1: Design tokens

**Files:**
- Modify: `src/renderer/index.css` (`:root` after line 31; second `@theme` block after line 81)

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind utility classes `bg-cs-hash-{1,2,3}`, `text-cs-hash-{1,2,3}`, `border-cs-hash-{1,2,3}` (with `/opacity` modifiers), backed by tokens `--cs-hash-1|2|3`.

- [ ] **Step 1: Add raw-channel vars to `:root`.** In `src/renderer/index.css`, the `:root` block ends at line 41; insert after the `--cs-danger: 220 38 38;` line (31):

```css
  --cs-danger: 220 38 38;
  --cs-hash-1: 70 183 174; /* teal   · 1 byte  (#46B7AE) */
  --cs-hash-2: 232 163 61; /* amber  · 2 bytes (#E8A33D) */
  --cs-hash-3: 185 138 224; /* violet · 3 bytes (#B98AE0) */
```

- [ ] **Step 2: Add themed colors to the `@theme` block.** In the second `@theme` block (lines 68-84), insert after `--color-cs-danger: rgb(var(--cs-danger));` (line 81):

```css
  --color-cs-danger: rgb(var(--cs-danger));
  --color-cs-hash-1: rgb(var(--cs-hash-1));
  --color-cs-hash-2: rgb(var(--cs-hash-2));
  --color-cs-hash-3: rgb(var(--cs-hash-3));
```

- [ ] **Step 3: Verify the tokens are present.**

Run: `grep -nE 'cs-hash-' src/renderer/index.css`
Expected: six lines (three `--cs-hash-*`, three `--color-cs-hash-*`).

- [ ] **Step 4: Format and commit.**

```bash
npx biome format --write src/renderer/index.css
git add src/renderer/index.css
git commit -m "feat: add --cs-hash-1/2/3 path-hash mode tokens"
```

---

## Task 2: `PathHashBadge` component (TDD)

**Files:**
- Create: `src/renderer/components/PathHashBadge.tsx`
- Test: `tests/component/path-hash-badge.test.tsx`

**Interfaces:**
- Consumes: `Badge` from `./ui/badge`, `cn` from `../lib/utils`, `PathHashSize` from `../../shared/types`, `TrendingUpDown` from `lucide-react`, the `cs-hash-*` classes from Task 1.
- Produces: `export function PathHashBadge({ bytes, className }: { bytes: number; className?: string }): JSX.Element`. Renders a `[data-slot="badge"]` element whose `textContent` is `` `${bytes}b` ``, tone class `text-cs-hash-${bytes}` for bytes ∈ {1,2,3} (else `text-cs-text-dim`), a leading `<svg>`, and `title="Path hash size: N byte(s) per hop"`.

- [ ] **Step 1: Write the failing test.** Create `tests/component/path-hash-badge.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathHashBadge } from '../../src/renderer/components/PathHashBadge';

function badgeEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-slot="badge"]');
  if (!el) throw new Error('badge not found');
  return el as HTMLElement;
}

describe('PathHashBadge', () => {
  it.each([1, 2, 3] as const)('renders %db with the mode tone, an icon, and a title', (bytes) => {
    const { container } = render(<PathHashBadge bytes={bytes} />);
    const badge = badgeEl(container);
    expect(badge.textContent).toBe(`${bytes}b`);
    expect(badge.className).toContain(`text-cs-hash-${bytes}`);
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.getAttribute('title')).toContain('Path hash size');
  });

  it('uses the singular "byte" in the 1-byte title', () => {
    const { container } = render(<PathHashBadge bytes={1} />);
    expect(badgeEl(container).getAttribute('title')).toBe('Path hash size: 1 byte per hop');
  });

  it('uses the plural "bytes" in the 2-byte title', () => {
    const { container } = render(<PathHashBadge bytes={2} />);
    expect(badgeEl(container).getAttribute('title')).toBe('Path hash size: 2 bytes per hop');
  });

  it('falls back to a neutral tone for an out-of-domain value', () => {
    const { container } = render(<PathHashBadge bytes={4} />);
    const badge = badgeEl(container);
    expect(badge.textContent).toBe('4b');
    expect(badge.className).toContain('text-cs-text-dim');
    expect(badge.className).not.toMatch(/text-cs-hash-/);
  });

  it('merges a passed className', () => {
    const { container } = render(<PathHashBadge bytes={2} className="ml-2" />);
    expect(badgeEl(container).className).toContain('ml-2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run --project dom tests/component/path-hash-badge.test.tsx`
Expected: FAIL — cannot resolve `../../src/renderer/components/PathHashBadge`.

- [ ] **Step 3: Write the component.** Create `src/renderer/components/PathHashBadge.tsx`:

```tsx
import { TrendingUpDown } from 'lucide-react';
import type { PathHashSize } from '../../shared/types';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

// Distinct triad — soft tint per hue: bg /15, text 100%, border /25. Colour is
// driven by mode only (never state or signal). Hues come from the packet-log
// field palette (see --cs-hash-* in index.css).
const MODE: Record<PathHashSize, string> = {
  1: 'bg-cs-hash-1/15 text-cs-hash-1 border-cs-hash-1/25',
  2: 'bg-cs-hash-2/15 text-cs-hash-2 border-cs-hash-2/25',
  3: 'bg-cs-hash-3/15 text-cs-hash-3 border-cs-hash-3/25',
};

const NEUTRAL = 'bg-cs-bg-3 text-cs-text-dim border-cs-border';

/** Monospace badge for the path-hash mode (bytes-per-hop). Renders `{n}b` tinted
 *  per mode. `bytes` is widened to `number` because call sites hold a raw
 *  `hashMode`; anything outside 1/2/3 renders a neutral chip. */
export function PathHashBadge({ bytes, className }: { bytes: number; className?: string }) {
  const tone = MODE[bytes as PathHashSize] ?? NEUTRAL;
  return (
    <Badge
      variant="secondary"
      title={`Path hash size: ${bytes} byte${bytes === 1 ? '' : 's'} per hop`}
      className={cn(
        'gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
        tone,
        className,
      )}
    >
      <TrendingUpDown className="size-3" aria-hidden />
      {bytes}
      <span className="font-normal opacity-55">b</span>
    </Badge>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run --project dom tests/component/path-hash-badge.test.tsx`
Expected: PASS (6 tests: 3 parameterized + 3 named).

- [ ] **Step 5: Format and commit.**

```bash
npx biome format --write src/renderer/components/PathHashBadge.tsx tests/component/path-hash-badge.test.tsx
git add src/renderer/components/PathHashBadge.tsx tests/component/path-hash-badge.test.tsx
git commit -m "feat: add PathHashBadge component"
```

---

## Task 3: Repurpose `formatPathStats` to hops-only (TDD)

**Files:**
- Modify: `src/renderer/lib/messagePath.ts:34-44`
- Test: `tests/unit/renderer/lib/messagePath.test.ts:57-76`

**Interfaces:**
- Consumes: `PathStats` (`{ hops: number | null; hashMode: number | null }`), already exported from `messagePath.ts`.
- Produces: `formatPathStats(stats: PathStats): string` now returns only the hop label — `"2h"`, `"0h"`, or `""` — no `b` segment. `firstPathStats` is unchanged.

- [ ] **Step 1: Update the test to the new contract.** In `tests/unit/renderer/lib/messagePath.test.ts`, replace the whole `describe('formatPathStats', ...)` block (lines 57-76) with:

```ts
describe('formatPathStats (hops label)', () => {
  it('formats the hop count, ignoring hash mode (now shown as a badge)', () => {
    expect(formatPathStats({ hops: 2, hashMode: 1 })).toBe('2h');
  });

  it('formats hops even when the hash mode is null', () => {
    expect(formatPathStats({ hops: 3, hashMode: null })).toBe('3h');
  });

  it('returns empty when hops is null regardless of hash mode', () => {
    expect(formatPathStats({ hops: null, hashMode: 2 })).toBe('');
  });

  it('returns empty when both are null', () => {
    expect(formatPathStats({ hops: null, hashMode: null })).toBe('');
  });

  it('keeps a 0-hop (direct) message as 0h', () => {
    expect(formatPathStats({ hops: 0, hashMode: 1 })).toBe('0h');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run --project unit tests/unit/renderer/lib/messagePath.test.ts`
Expected: FAIL — current `formatPathStats` still returns `"2h · 1b"`, so `toBe('2h')` fails.

- [ ] **Step 3: Update the implementation.** In `src/renderer/lib/messagePath.ts`, replace the `formatPathStats` function and its doc comment (lines 34-44) with:

```ts
/**
 * Compact hop label for the meta row: e.g. "2h" | "0h" | "". The path-hash mode
 * is no longer part of this string — it renders as a <PathHashBadge> alongside.
 * Uses `!= null` so a direct (0-hop) message renders "0h" rather than "".
 */
export function formatPathStats(stats: PathStats): string {
  return stats.hops != null ? `${stats.hops}h` : '';
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run --project unit tests/unit/renderer/lib/messagePath.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit.**

```bash
npx biome format --write src/renderer/lib/messagePath.ts tests/unit/renderer/lib/messagePath.test.ts
git add src/renderer/lib/messagePath.ts tests/unit/renderer/lib/messagePath.test.ts
git commit -m "refactor: formatPathStats returns hops only (mode moves to badge)"
```

---

## Task 4: Message-meta integration

**Files:**
- Modify: `src/renderer/components/MessageItem.tsx` (import line 3; add import; line 65; line 94; line 130; `TrailingMeta` at 170-178; add `PathStatsMeta`)

**Interfaces:**
- Consumes: `PathHashBadge` (Task 2), `formatPathStats`/`firstPathStats`/`PathStats` (Task 3), the existing `StateChip`.
- Produces: local `PathStatsMeta({ stats }: { stats: PathStats })`; `TrailingMeta` now takes `{ message, stats }` instead of `{ message, pathLabel }`.

- [ ] **Step 1: Update imports.** In `src/renderer/components/MessageItem.tsx`, change the `messagePath` import (line 3) to also import the type, and add the badge import right after it:

```tsx
import { firstPathStats, formatPathStats, type PathStats } from '../lib/messagePath';
import { PathHashBadge } from './PathHashBadge';
```

- [ ] **Step 2: Replace the `pathLabel` derivation.** Change line 65 from:

```tsx
  const pathLabel = formatPathStats(firstPathStats(message));
```
to:
```tsx
  const stats = firstPathStats(message);
```

- [ ] **Step 3: Update the compact `TrailingMeta` call.** Change line 94 from:

```tsx
        <TrailingMeta message={message} pathLabel={pathLabel} />
```
to:
```tsx
        <TrailingMeta message={message} stats={stats} />
```

- [ ] **Step 4: Update the rich meta row.** In the rich content block, change line 130 from:

```tsx
            {pathLabel && <span className="tabular-nums">{pathLabel}</span>}
```
to:
```tsx
            <PathStatsMeta stats={stats} />
```

- [ ] **Step 5: Rewrite `TrailingMeta` and add `PathStatsMeta`.** Replace the whole `TrailingMeta` function (lines 167-178, including its doc comment) with:

```tsx
/** Trailing meta for the compact one-line layout: state + path stats (the
 *  timestamp leads the line, so it isn't repeated here). Renders nothing when
 *  there's neither a non-received state nor path data. */
function TrailingMeta({ message, stats }: { message: Message; stats: PathStats }) {
  const hasPath = stats.hops != null || stats.hashMode != null;
  if (message.state === 'received' && !hasPath) return null;
  return (
    <div className="flex shrink-0 flex-row items-center gap-2 font-mono text-[10px] text-cs-text-dim">
      <StateChip message={message} />
      <PathStatsMeta stats={stats} />
    </div>
  );
}

/** Hop count as text plus the path-hash mode as a badge. Renders nothing when
 *  neither hops nor mode is known. */
function PathStatsMeta({ stats }: { stats: PathStats }) {
  const hopsLabel = formatPathStats(stats);
  if (!hopsLabel && stats.hashMode == null) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {hopsLabel && <span className="tabular-nums">{hopsLabel}</span>}
      {stats.hashMode != null && <PathHashBadge bytes={stats.hashMode} />}
    </span>
  );
}
```

- [ ] **Step 6: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors (in particular, no "`pathLabel` is not defined" — all four references are replaced).

- [ ] **Step 7: Run the dom suite.**

Run: `npx vitest run --project dom`
Expected: PASS (any existing MessageItem component tests still pass).

- [ ] **Step 8: Format and commit.**

```bash
npx biome format --write src/renderer/components/MessageItem.tsx
git add src/renderer/components/MessageItem.tsx
git commit -m "feat: show path-hash mode as a badge in the message meta row"
```

---

## Task 5: Path viewer, owner card, and contact-detail row

**Files:**
- Modify: `src/renderer/components/path/PathItem.tsx` (import; line 57)
- Modify: `src/renderer/shell/leftnav/OwnerCard.tsx` (import; lines 56-61)
- Modify: `src/renderer/shell/rightrail/sections/ContactDetail.tsx` (import; line 248)

**Interfaces:**
- Consumes: `PathHashBadge` (Task 2). `path.hashMode: number`, `pathHashMode: PathHashSize`, `rc.outPathHashSize: PathHashSize` — all accepted by the `bytes: number` prop.
- Produces: nothing new.

- [ ] **Step 1: Path viewer.** In `src/renderer/components/path/PathItem.tsx`, add the import after the existing `cn` import (line 4):

```tsx
import { PathHashBadge } from '../PathHashBadge';
```
Then replace line 57:
```tsx
            <span title="Bytes of each hop's pubkey carried in the routing path">{path.hashMode}-byte path</span>
```
with:
```tsx
            <PathHashBadge bytes={path.hashMode} />
            <span>path</span>
```

- [ ] **Step 2: Owner card.** In `src/renderer/shell/leftnav/OwnerCard.tsx`, add the import after the `CopyButton` import (line 3):

```tsx
import { PathHashBadge } from '../../components/PathHashBadge';
```
Then replace the mode span (lines 56-61):
```tsx
                      <span
                        title={`Path hash size: ${pathHashMode} byte${pathHashMode > 1 ? 's' : ''} per hop`}
                        className="rounded-sm bg-cs-bg-3 px-1 font-mono text-[9px] uppercase tracking-wide text-cs-text-dim"
                      >
                        {pathHashMode}b
                      </span>
```
with:
```tsx
                      <PathHashBadge bytes={pathHashMode} />
```

- [ ] **Step 3: Contact-detail row.** In `src/renderer/shell/rightrail/sections/ContactDetail.tsx`, add the import next to the other component imports (after line 5, `SetPathEditor`):

```tsx
import { PathHashBadge } from '../../../components/PathHashBadge';
```
Then replace line 248:
```tsx
        {rc.outPathHashSize != null && <KeyValueRow label="Path hash size" value={`${rc.outPathHashSize}-byte`} mono />}
```
with:
```tsx
        {rc.outPathHashSize != null && (
          <KeyValueRow label="Path hash size" value={<PathHashBadge bytes={rc.outPathHashSize} />} />
        )}
```

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors. (If OwnerCard now has an unused `pathHashMode > 1` expression warning — there isn't one; `pathHashMode` is still read by the badge prop.)

- [ ] **Step 5: Format and commit.**

```bash
npx biome format --write src/renderer/components/path/PathItem.tsx src/renderer/shell/leftnav/OwnerCard.tsx src/renderer/shell/rightrail/sections/ContactDetail.tsx
git add src/renderer/components/path/PathItem.tsx src/renderer/shell/leftnav/OwnerCard.tsx src/renderer/shell/rightrail/sections/ContactDetail.tsx
git commit -m "feat: use PathHashBadge in path viewer, owner card, contact detail"
```

---

## Task 6: Set-path editor mode label

**Files:**
- Modify: `src/renderer/components/path/SetPathEditor.tsx` (remove `Badge` import at line 25; add `PathHashBadge` import; lines 175-177)

**Interfaces:**
- Consumes: `PathHashBadge` (Task 2). `hashSize: PathHashSize`.
- Produces: nothing new.

- [ ] **Step 1: Swap the import.** In `src/renderer/components/path/SetPathEditor.tsx`, replace the `Badge` import (line 25):

```tsx
import { Badge } from '../ui/badge';
```
with:
```tsx
import { PathHashBadge } from '../PathHashBadge';
```
(`Badge` is used only at the label below, so its import is removed.)

- [ ] **Step 2: Replace the label.** Replace the `<Badge>` block (lines 175-177):

```tsx
        <Badge variant="secondary" className="font-mono">
          {hashSize}-byte hops · radio default
        </Badge>
```
with:
```tsx
        <div className="flex items-center gap-1.5">
          <PathHashBadge bytes={hashSize} />
          <span className="font-mono text-[11px] text-cs-text-dim">hops · radio default</span>
        </div>
```

- [ ] **Step 3: Typecheck (catches a lingering `Badge` reference).**

Run: `npx tsc --noEmit`
Expected: no errors — confirms `Badge` is no longer referenced anywhere in the file.

- [ ] **Step 4: Lint (catches an unused import).**

Run: `npx biome check src/renderer/components/path/SetPathEditor.tsx`
Expected: no errors — confirms the `Badge` import was fully removed.

- [ ] **Step 5: Format and commit.**

```bash
npx biome format --write src/renderer/components/path/SetPathEditor.tsx
git add src/renderer/components/path/SetPathEditor.tsx
git commit -m "feat: use PathHashBadge in the set-path editor label"
```

---

## Task 7: Full verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: green typecheck, lint, unit + dom suites, and a visual confirmation.

- [ ] **Step 1: Typecheck the whole project.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint the changed scope.**

Run: `npx biome check src tests`
Expected: no errors.

- [ ] **Step 3: Run the unit suite.**

Run: `npx vitest run --project unit`
Expected: PASS — 66 files / 330 tests (messagePath assertions updated in Task 3).

- [ ] **Step 4: Run the dom suite.**

Run: `npx vitest run --project dom`
Expected: PASS, including `tests/component/path-hash-badge.test.tsx`.

- [ ] **Step 5: Visual confirmation in the real app.** Use the `verify` skill (project e2e recipe: `pnpm package` → Playwright + Electron with `CORESENSE_USER_DATA` + `FAKE_TRANSPORT`, seed a multi-day conversation into `messages.db`). Screenshot and confirm the badge renders with the correct per-mode tint and `{n}b` label in: (a) the message-list meta line, (b) the owner card identity row, and (c) the contact-detail path viewer ("N hops · ⇅ Nb path"). Confirm no remaining `-byte` / `2b` / `2B` plain-text treatments survive at those spots.

- [ ] **Step 6: Confirm no stray old treatments remain.**

Run: `grep -rnE '[0-9]-byte|\{[a-zA-Z.]*[Hh]ashMode\}b|\{[a-zA-Z.]*[Hh]ashSize\}-byte' src/renderer --include=*.tsx`
Expected: only intentional survivors — the interactive `Experimental.tsx` selector labels (`1-byte (max 64 hops)…`) and non-mode strings. No path-hash **mode** display should still render as plain `-byte`/`Nb` text.

---

## Self-Review

**Spec coverage:**
- Tokens → Task 1. ✓
- `PathHashBadge` component (props, fallback, geometry, title, icon) → Task 2. ✓
- Message-meta refactor (`formatPathStats` hops-only, `PathStatsMeta`, both render spots) → Tasks 3-4. ✓
- Path viewer / owner card / contact-detail row swaps → Task 5. ✓
- Set-path editor swap (+ unused-import removal) → Task 6. ✓
- Non-goals (Experimental selector, `ContactDetail:260` total-bytes line) → untouched; confirmed by Task 7 Step 6. ✓
- Component test + messagePath test update + app visual verification → Tasks 2, 3, 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. ✓

**Type consistency:** `PathHashBadge({ bytes: number, className?: string })` used identically in Tasks 4-6. `formatPathStats(stats: PathStats): string` (hops-only) defined in Task 3 and consumed in Task 4. `TrailingMeta({ message, stats })` and `PathStatsMeta({ stats })` names match between their definition (Task 4 Step 5) and call sites (Task 4 Steps 3-4). `PathStats` imported as a type in Task 4 Step 1. ✓
