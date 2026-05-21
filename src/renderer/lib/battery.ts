// Single-cell LiPo battery helpers. MeshCore radios report only raw battery
// millivolts (RESP_BATT_AND_STORAGE) — never a percentage — so we estimate one
// from a typical single-cell discharge curve. Companion/handheld radios are
// LiPo-powered; the estimate is meaningless for mains/12V repeaters, but the
// identity card only ever shows the locally-connected radio.

// Resting-voltage (V) → charge (%) anchor points for a single-cell LiPo.
const LIPO_CURVE: ReadonlyArray<readonly [number, number]> = [
  [3.2, 0],
  [3.5, 10],
  [3.7, 30],
  [3.8, 55],
  [3.9, 75],
  [4.0, 88],
  [4.1, 96],
  [4.2, 100],
];

/** Estimate battery charge (0–100) from a millivolt reading, or null when there
 *  is no reading yet (batteryMv 0 = DEFAULT_DEVICE_INFO, never measured). */
export function lipoPercent(mv: number): number | null {
  if (!mv || mv <= 0) return null;
  const v = mv / 1000;
  const first = LIPO_CURVE[0];
  const last = LIPO_CURVE[LIPO_CURVE.length - 1];
  if (v <= first[0]) return 0;
  if (v >= last[0]) return 100;
  for (let i = 1; i < LIPO_CURVE.length; i += 1) {
    const [v0, p0] = LIPO_CURVE[i - 1];
    const [v1, p1] = LIPO_CURVE[i];
    if (v <= v1) {
      const t = (v - v0) / (v1 - v0);
      return Math.round(p0 + t * (p1 - p0));
    }
  }
  return 100;
}

/** Format a millivolt reading as volts, e.g. 4020 → "4.02 V". */
export function formatVoltage(mv: number): string {
  return `${(mv / 1000).toFixed(2)} V`;
}
