// The hop-count warming ramp: how a relay hop count becomes a colour. Pure and
// DOM-free so every part of it — including the CSS strings — is unit-testable
// in Node. The CSS lives here rather than in HopBadge because pure string
// construction belongs in the pure module: it runs in the fast Node project,
// and it matches the existing precedent in lib/contactColor.ts, which builds
// its own color-mix strings the same way.

import type { PathHashSize } from '../../shared/types';

/** Maximum hop count per path-hash mode: min(63, floor(64 / hashMode)). The
 *  64-byte path buffer bounds it, and the 6-bit hop-count field (bits 5-0 of
 *  the packed path-length byte — see src/shared/contacts/discovered.ts) caps
 *  it at 63. That 63 wall only binds in 1-byte mode; 2-byte (32) and 3-byte
 *  (21) already sit below it. */
export const HOP_CEILING: Record<PathHashSize, number> = { 1: 63, 2: 32, 3: 21 };

/** The fade completes at `ceiling / HOP_RAMP_CAP_DIVISOR` hops rather than at
 *  the ceiling itself: real traffic clusters at the low end, and a ramp that
 *  only saturated at 63 would leave nearly every badge sitting cool and doing
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
  // The ceiling clamp has no observable effect at the current divisor: the
  // Math.min(…, 1) below already saturates at that same point, since the cap
  // (ceiling / HOP_RAMP_CAP_DIVISOR) never exceeds the ceiling while the
  // divisor is ≥ 1. It's forward defence, not dead code — if the divisor were
  // ever tuned below 1, the cap would exceed the ceiling and this is what
  // would still stop hops above the ceiling from reading hotter than max.
  // Math.max(hops, 0) is the only clamp that's load-bearing today.
  const clamped = Math.min(Math.max(hops, 0), ceiling);
  return Math.min(clamped / (ceiling / HOP_RAMP_CAP_DIVISOR), 1);
}

/** Inline style for the badge — the ramp is continuous, so the colour can't be
 *  a Tailwind class. Percent is rounded to a whole number to keep the emitted
 *  string stable. The border is the same tint at 46%, matching the outline
 *  treatment the design settled on. */
export function hopTint(hops: number, hashMode: number | null | undefined): { color: string; borderColor: string } {
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
