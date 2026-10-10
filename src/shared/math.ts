/** `v` limited to the inclusive range [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** An untrusted value (e.g. hand-editable persisted settings) floored into the
 *  integer range [lo, hi]; anything that isn't a finite number becomes
 *  `fallback` rather than being clamped into a bound. */
export function clampFiniteInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
