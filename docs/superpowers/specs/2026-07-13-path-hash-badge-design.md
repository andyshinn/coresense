# Path Hash Badge — Design

**Date:** 2026-07-13
**Branch:** `worktree-feat-path-hash-mode-chip`
**Status:** Approved

## Problem

The path-hash mode (bytes-per-hop carried in the routing path — 1, 2, or 3) is
surfaced to the user in several places, each with its own ad-hoc treatment:

- Path viewer meta line — `2-byte path` (dim mono text)
- Owner identity card — `2b` (uncoloured mono pill)
- Message meta line — `2b` (dim text, joined into a stats string)
- Contact detail row — `2-byte` (plain key/value)
- Set-path editor — `2-byte hops · radio default` (generic secondary Badge)

Three different labels for one concept (`2-byte` / `2b` / `2B`), none colour-coded,
so the mode never reads as a consistent, scannable signal.

## Goal

One reusable component — `PathHashBadge` — that renders the mode as a
monospace, mode-tinted badge (`{n}b`) and replaces every read-only display of the
path-hash size. Sourced from the approved Claude Design handoff
`design_handoff_path_hash_badge/Path Hash Badge - Soft Dot.html` (project
`019dff75-…`), variant **"Soft + icon" on the distinct-colour triad**.

## Non-goals

- The interactive radio settings selector (`Experimental.tsx`) keeps its
  descriptive `1-byte (max 64 hops) — legacy` text. The badge is defined as
  informational, non-interactive; it does not belong inside a form control.
- `ContactDetail.tsx:260` (`{outPathHex.length / 2} byte path`) is the **total**
  path byte length, a different quantity from the per-hop mode — left as-is.
- No change to protocol/plumbing (`hashMode` derivation, `setPathHashMode` API,
  hop-splitting). Display layer only.

## Design tokens

The triad hues come from the packet-log field palette. Add to
`src/renderer/index.css`, following the existing two-part token pattern
(raw channels in `:root`, themed color in the `@theme` block):

```css
/* :root — near --cs-danger */
--cs-hash-1: 70 183 174;    /* teal   · 1 byte  (#46B7AE) */
--cs-hash-2: 232 163 61;    /* amber  · 2 bytes (#E8A33D) */
--cs-hash-3: 185 138 224;   /* violet · 3 bytes (#B98AE0) */

/* @theme — near --color-cs-danger */
--color-cs-hash-1: rgb(var(--cs-hash-1));
--color-cs-hash-2: rgb(var(--cs-hash-2));
--color-cs-hash-3: rgb(var(--cs-hash-3));
```

Tailwind `/opacity` modifiers on these resolve via `color-mix`, well-precedented
in the repo (`bg-cs-danger/10`, `border-cs-accent/40`).

## Component

`src/renderer/components/PathHashBadge.tsx` — sibling to the existing `RssiChip`
presentational-chip precedent. A thin wrapper over the shadcn `Badge`.

```tsx
import { TrendingUpDown } from 'lucide-react';
import type { PathHashSize } from '../../shared/types';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

// Distinct triad — soft tint: bg /15, text 100%, border /25.
const MODE: Record<PathHashSize, string> = {
  1: 'bg-cs-hash-1/15 text-cs-hash-1 border-cs-hash-1/25',
  2: 'bg-cs-hash-2/15 text-cs-hash-2 border-cs-hash-2/25',
  3: 'bg-cs-hash-3/15 text-cs-hash-3 border-cs-hash-3/25',
};

export function PathHashBadge({ bytes, className }: { bytes: number; className?: string }) {
  const tone = MODE[bytes as PathHashSize] ?? 'bg-cs-bg-3 text-cs-text-dim border-cs-border';
  return (
    <Badge
      variant="secondary"
      title={`Path hash size: ${bytes} byte${bytes > 1 ? 's' : ''} per hop`}
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

Design decisions:

- **`bytes: number`, not `1 | 2 | 3`.** Call sites hold `hashMode: number` /
  `PathHashSize`. The `?? neutral` fallback renders a muted chip for any
  out-of-domain value rather than crashing or rendering blank.
- **`title` for accessibility.** The visible `{n}b` is terse; `title` spells out
  "Path hash size: 2 bytes per hop". The icon is `aria-hidden`.
- **twMerge overrides** the base `Badge`'s `rounded-full` / `px-2` / `text-xs` /
  `border-transparent`, landing on the spec geometry: rounded-md (6px), px-1.5,
  11px JetBrains Mono, weight 600 (unit 400 @ opacity .55), 1px border, gap-1,
  12px icon, tabular-nums.

## Integration sites (5)

| File | Before | After |
| --- | --- | --- |
| `components/path/PathItem.tsx:57` | `<span>{path.hashMode}-byte path</span>` | `<PathHashBadge bytes={path.hashMode} /><span>path</span>` |
| `shell/leftnav/OwnerCard.tsx:56-61` | custom `{pathHashMode}b` span | `<PathHashBadge bytes={pathHashMode} />` |
| `components/MessageItem.tsx` (meta) | joined `"2h · 1b"` string | `{hops}h` text + `<PathHashBadge />` (see below) |
| `shell/rightrail/sections/ContactDetail.tsx:248` | `KeyValueRow value={`${n}-byte`} mono` | `KeyValueRow value={<PathHashBadge bytes={rc.outPathHashSize} />}` (drop `mono`) |
| `components/path/SetPathEditor.tsx:176` | `<Badge>{hashSize}-byte hops · radio default</Badge>` | `<PathHashBadge bytes={hashSize} /><span>hops · radio default</span>` |

`KeyValueRow`'s `value` is already `ReactNode`, so a badge element drops in.

## Message-meta refactor

`src/renderer/lib/messagePath.ts::formatPathStats` currently returns the whole
label (`"2h · 1b"`), rendered as text in two spots
(`MessageItem.tsx:130` rich, `:175` `TrailingMeta`). The `b` segment becomes a
badge, so:

1. **Repurpose** `formatPathStats(stats)` → a hops-only string helper returning
   `"2h"` / `"0h"` / `""` (drop the `hashMode` branch).
2. Render the badge from `stats.hashMode` (when non-null) next to the hops text.
3. **Extract** a small shared `PathStatsMeta` element (hops text + optional
   `PathHashBadge`) so both render spots stay DRY, rather than passing a
   pre-joined `pathLabel: string`.

`firstPathStats` is unchanged (still yields `{ hops, hashMode }`).

## Testing

- **New** `tests/.../PathHashBadge.test.tsx` (dom project):
  - renders `{n}b` and the icon for each of modes 1/2/3;
  - applies the correct `text-cs-hash-{n}` tone class per mode;
  - exposes an accessible `title`;
  - falls back to the neutral tone for an out-of-domain value (e.g. `4`).
- **Update** `tests/unit/renderer/lib/messagePath.test.ts`: `formatPathStats`
  cases lose the `· {n}b` segment (`'2h · 1b'` → `'2h'`, `'2b'` → `''`,
  `'0h · 1b'` → `'0h'`); `firstPathStats` cases unchanged.
- **Final verification:** drive the packaged app (per the e2e verification
  recipe — Playwright + Electron, `FAKE_TRANSPORT`, seeded messages.db) and
  screenshot the badge in the message list, owner card, and contact detail path
  viewer to confirm colour/geometry match the handoff.

## Files touched

New: `components/PathHashBadge.tsx`, `PathHashBadge.test.tsx`.
Edit: `index.css`, `components/path/PathItem.tsx`, `shell/leftnav/OwnerCard.tsx`,
`components/MessageItem.tsx`, `lib/messagePath.ts`,
`tests/unit/renderer/lib/messagePath.test.ts`,
`shell/rightrail/sections/ContactDetail.tsx`,
`components/path/SetPathEditor.tsx`.

## Baseline

`npx vitest run --project unit` — 66 files / 330 tests passing before changes.
(The `pnpm test:unit` wrapper fails on a sandbox reflink denial in the worktree;
use `npx vitest` directly.)
