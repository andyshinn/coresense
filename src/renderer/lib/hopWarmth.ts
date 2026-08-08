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
