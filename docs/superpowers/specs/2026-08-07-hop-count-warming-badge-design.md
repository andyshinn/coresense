# Hop Count Badge — Warming — Design

**Date:** 2026-08-07
**Branch:** `worktree-feat-hops-badge`
**Status:** Approved

## Problem

Hop count is how many relays a packet crossed to reach us. Today it renders as
bare dim text — `5h` — built by `formatPathStats` and dropped into the message
meta line beside the tinted `PathHashBadge`:

```
08:51 PM  ·  5h  ·  [2b]
```

Two problems with that. The number carries no magnitude at a glance, so a reader
has to parse every digit to tell a direct message from one that crossed half the
mesh. And the count is displayed without its ceiling: the routing path is a
fixed 64-byte buffer, so the maximum hop count depends on the path-hash mode —
64 hops at 1 byte per hop, 32 at 2 bytes, 21 at 3. `9h` means something very
different in 3-byte mode (nearly at the wall) than in 1-byte mode (barely
started), and nothing in the UI says so.

`PathItem` has the same gap, showing `8 hops` as plain text next to the badge it
pairs with.

## Goal

One reusable component — `HopBadge` — that renders the count as a monospace
badge whose colour warms continuously with distance, normalised against the
ceiling implied by the message's own path-hash mode.

Sourced from the approved Claude Design handoff `Hop Count Badge.html` (project
`019dff75-f714-7198-960c-c5a2c63dfd1b`), concept **07 "Warming"**, adapted to the
**outline** variant for the reasons in [Colour](#colour).

## Non-goals

- **Contacts table and contact detail.** `HopChip` in `ContactRows.tsx` and the
  `Hops away` row in `ContactDetail.tsx` describe a contact's stored out-path,
  not a received message. Their ceiling comes from
  `hashSizeFromOutPathLen(out_path_len)` and their `null` means *Flood* — a
  third state distinct from both "0 hops" and "unknown mode". Left as-is.
- **`MessageInfoPopover`.** The `Hops` row is a labelled key/value in a data
  table, not a dense meta line; a plain number reads better there.
- **No protocol or storage change.** Display layer only. `hops` and `hashMode`
  already arrive together at both target call sites.
- **No change to `PathHashBadge`.** It keeps its filled treatment; the hop badge
  is what adapts.

## The ramp

### Ceiling per hash mode

The path buffer is 64 bytes and each hop consumes `hashMode` bytes, so:

| hash mode | ceiling |
|---|---|
| 1 byte | 64 hops |
| 2 bytes | 32 hops |
| 3 bytes | 21 hops |

### Soft cap

The fade completes well before the ceiling — real traffic clusters at the low
end, and a ramp that only saturates at 64 would leave nearly every badge sitting
at the cool end doing no work. The cap is a fixed fraction of the ceiling:

```
cap = ceiling / HOP_RAMP_CAP_DIVISOR      // divisor = 4
warmth = min(hops / cap, 1)               // 0 → 1
```

| hops | 1-byte (cap 16) | 2-byte (cap 8) | 3-byte (cap 5.25) |
|---|---|---|---|
| 0 | 0% | 0% | 0% |
| 1 | 6% | 13% | 19% |
| 2 | 13% | 25% | 38% |
| 3 | 19% | 38% | 57% |
| 4 | 25% | 50% | 76% |
| 6 | 38% | 75% | 100% |
| 8 | 50% | 100% | 100% |
| 16 | 100% | 100% | 100% |

`HOP_RAMP_CAP_DIVISOR` is a named exported constant, not a literal, so the
ramp's reach can be retuned in one edit.

**Accepted consequence:** because the cap scales with the ceiling, the same hop
count reads hotter the more expensive the hash mode. 4 hops is 25% warm in
1-byte mode and 76% in 3-byte mode. This is deliberate — the badge answers *how
far into this mode's budget did the packet travel*, i.e. how much routing
headroom is left, not how many relays in the absolute. The tooltip names the
ceiling so the normalisation is discoverable rather than mysterious.

### Unknown hash mode

`firstPathStats` returns `hashMode: null` for messages with no correlated mesh
observation (e.g. received before the bridge connected). We know the hop count
but not the ceiling, so there is no honest warmth to compute: **warmth is 0 and
the badge renders at the cool end.** It is visually identical to a 0-hop
message; only the digits distinguish them. That is the correct trade — the
alternative is asserting a ceiling we never observed.

Anything outside 1/2/3 — including `0` and `null` — counts as unknown. This
matches `PathHashBadge`'s existing documented contract.

## Colour

The mockup draws Warming as a **soft-filled** pill running sand → brand orange.
Rendered against coresense's real tokens, that fails twice:

1. **Light mode fails AA.** `index.css` requires a tint to clear 4.5:1 against
   *its own 15% fill* composited over the panel, worst substrate `bg-3`
   (`#E6DEC8`). Light-mode brand orange `#B45309` reaches only **3.13:1**; the
   ramp is under AA above roughly 10% of its travel. A sweep of the entire warm
   gamut found that the most saturated amber clearing that bar on a light
   background *is* `#78350F` — already the 2-byte hash tint.
2. **It collides with the badge beside it.** The ramp's hot end is brand amber
   and `PathHashBadge` 2-byte is hash amber. At 6 hops in 2-byte mode the two
   are the same colour (ΔE 0.007 oklab); in light mode, identical.

The mockup could not surface either: its own `2b` sample had no colour bound to
`--c`, so it rendered unstyled.

**Resolution — the outline variant.** Dropping the fill puts the number on the
panel instead of on its own tint, which separates the two badges by *weight*
rather than hue (an unfilled chip beside a filled one is unambiguous at 10px),
and relaxes the contrast substrate enough that light mode can reach a genuinely
orange endpoint — `#96430A` at 5.04:1, which also pulls it off the 2-byte tint
(ΔE 0.053 rather than 0.000).

Colour is never the sole channel: the exact count is always rendered, so the
badge needs no separate colour-blind affordance.

### Tokens

Added to `src/renderer/index.css` beside `--cs-hash-*`, following the same
pattern — dark values in `:root`, light overrides in `:root:not(.dark)`:

```css
/* :root (dark) */
--cs-hop-near: 193 178 145;   /* #C1B291 — 9.46 / 8.84 / 8.15 */
--cs-hop-far:  245 158 11;    /* #F59E0B — 9.21 / 8.60 / 7.93 */

/* :root:not(.dark) */
--cs-hop-near: 92 78 56;      /* #5C4E38 — 7.67 / 7.02 / 6.01 */
--cs-hop-far:  150 67 10;     /* #96430A — 6.43 / 5.88 / 5.04 */
```

Ratios are the tint as text against `bg` / `bg-2` / `bg-3` — measured on the
panel, not on a fill, which is what the outline variant makes the correct
substrate. All four clear 4.5:1 on every substrate, and every interpolated point
between them does too.

No `@theme` entries. Unlike `--cs-hash-*`, these are never consumed by a
Tailwind utility — the ramp is continuous, so the colour can only be an inline
`color-mix`. Raw channels are all that's needed.

`--cs-hop-near` is seeded to the same value as `--cs-text-muted` in both themes,
so a direct message is as quiet as the meta text around it. It is deliberately a
*separate* token: retuning muted body text should not silently move the ramp.

## Components

### `src/renderer/lib/hopWarmth.ts` (new)

Pure, no React, independently testable.

```ts
export const HOP_CEILING: Record<PathHashSize, number> = { 1: 64, 2: 32, 3: 21 };

/** Fade completes at ceiling ÷ this. Raise it to make the ramp reach further. */
export const HOP_RAMP_CAP_DIVISOR = 4;

/** Sentinel for "we never observed the path-hash mode". Outside 1/2/3, so it
 *  already reads as unknown to PathHashBadge. */
export const HASH_MODE_UNKNOWN = 0;

/** 0 (cool) → 1 (hot). Returns 0 when the mode is unknown: without a ceiling
 *  there is no honest distance to claim. */
export function hopWarmth(hops: number, hashMode: number | null): number;

/** Ceiling for a mode, or null when unknown — used for the tooltip. */
export function hopCeiling(hashMode: number | null): number | null;

/** True for 1/2/3. The single place the "is this mode real" question is
 *  answered, shared by HopBadge and by the PathHashBadge render guards. */
export function isKnownHashMode(hashMode: number | null): hashMode is PathHashSize;
```

`hopWarmth` returns `0` for a `hashMode` outside 1/2/3 and for non-finite
`hops`; otherwise it clamps `hops` to `[0, ceiling]` before dividing.

### `src/renderer/components/HopBadge.tsx` (new)

Sibling to `PathHashBadge`: same 10px mono, `tabular-nums`, `leading-none`,
`rounded-sm`, `px-1 py-0.5` geometry, but `variant="outline"` and no icon.

```tsx
export function HopBadge({ hops, hashMode }: {
  hops: number | null;
  hashMode: number | null;
}): JSX.Element | null
```

No `className` prop. Neither call site needs one — both parents space their
children with `gap` — and `PathHashBadge`'s own `className` is unused at all
three of its call sites.

- Returns `null` when `hops == null`.
- Colour cannot be a Tailwind class (it is continuous), so it is an inline
  style:

  ```tsx
  const pct = Math.round(hopWarmth(hops, hashMode) * 100);
  const tint = `color-mix(in oklab, rgb(var(--cs-hop-far)) ${pct}%, rgb(var(--cs-hop-near)))`;
  style={{ color: tint, borderColor: `color-mix(in srgb, ${tint} 46%, transparent)` }}
  ```

  Rounding to an integer percent keeps the emitted string stable to assert
  against. Inline colour from a token is precedented — see
  `PathItem.tsx:73`'s `snrTokenVar`.
- Content is `{hops}<span className="font-normal">h</span>`. The
  de-emphasised unit mirrors `PathHashBadge`'s `b` — the detail that makes the
  two read as one family.
- `title`: `"4 hops · max 32 (2-byte path hash)"`, or `"4 hops"` when the mode is
  unknown. Singular `"1 hop"`. Matches `PathHashBadge`'s `title`-based
  disclosure.

## Call sites

### `MessageItem.tsx`

`PathStatsMeta` replaces the dim hop text with the badge; `PathHashBadge` stays
where it is:

```tsx
<HopBadge hops={stats.hops} hashMode={stats.hashMode} />
{isKnownHashMode(stats.hashMode) && <PathHashBadge bytes={stats.hashMode} />}
```

`formatPathStats` in `lib/messagePath.ts` loses its only consumer and is deleted
along with its tests. `firstPathStats` and `PathStats` are unchanged.

### `PathItem.tsx`

`<span>{hopCount} hops</span>` becomes
`<HopBadge hops={hopCount} hashMode={path.hashMode} />`, and `PathHashBadge`
renders only for a known mode.

### `HeardVia.tsx`

`synthesizeUnnamedPath` currently hardcodes `hashMode: 1`, asserting a 64-hop
ceiling it never observed — the path is synthesized from a bare hop count
precisely because no observation exists. It becomes `HASH_MODE_UNKNOWN`, so a
synthesized path renders unwarmed and its row shows no hash badge.

`MessagePath.hashMode` keeps its `number` type. Widening it to `number | null`
would ripple into `contextBuilder.ts`'s `hash_mode` macro variable — user-facing
template surface, out of scope here — and `0` already reads as unknown under
`PathHashBadge`'s existing contract.

## Testing

**`hopWarmth`** — all three ceilings; the cap boundary (exactly at cap → 1);
0 hops → 0; hops above the ceiling clamp to 1; unknown mode (`null`, `0`, `4`)
→ 0; non-finite hops → 0; the 3-byte fractional cap (5.25) produces the expected
percentages.

**`HopBadge`** — renders `4h` and `1h`; emits the expected `color-mix`
percentage for a given `(hops, hashMode)`; unknown mode emits `0%`;
`hops == null` renders nothing; title text for known, unknown and singular
cases.

**`PathItem`** — renders no `PathHashBadge` when the path's mode is unknown, and
does render one for 1/2/3.

**`messagePath.test.ts`** — drop the `formatPathStats` block; leave the
`firstPathStats` cases untouched.

## Risks

- **The ramp is subtle at 1-byte mode.** 1 hop is 6% warm, barely distinguishable
  from 0. That is inherent to a 64-hop ceiling and is what
  `HOP_RAMP_CAP_DIVISOR` exists to retune once it has been seen against real
  traffic.
- **`--cs-hop-far` is the brand accent in dark mode.** `index.css` otherwise
  keeps `--cs-accent` for action. The unfilled treatment keeps it quiet, and the
  hot end is rare in practice, but it is a deliberate borrowing of the brand hue
  for a non-action signal.
- **Borders fall below 3:1** at `/46` (2.71 dark, 1.97 light). Acceptable: the
  border is decorative and the number carries the information. `PathHashBadge`'s
  `/25` borders are fainter still.
