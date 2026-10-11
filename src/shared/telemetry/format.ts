// Telemetry display formatting. Design-system rules: a space before units
// ("4.25 V", "1013.4 hPa"), "%" attached ("58.5%"), the Unicode minus "−" in
// display values, metric first with imperial as the secondary line.
//
// Wall-clock times are NOT formatted here: they go through the renderer's
// fmtTime/fmtDateTime (lib/time.ts) so the 12/24-hour preference applies.
// What lives here is the clock-free part: ages and durations ("12 s ago",
// "2 h 14 m"), which lib/time.ts has no form for (fmtAgoShort is minute
// precision and unspaced, "3m ago").

export const MINUS = '−';

/** Narrow no-break space: digit grouping ("48 211") that never wraps. */
export const GROUP_SEP = ' ';

export interface FormatNumberOptions {
  /** Group the integer part in threes once it reaches 1000 (integers only). */
  group?: boolean;
}

/** Fixed-decimal number with the Unicode minus. A value that rounds to zero never shows a sign. */
export function formatNumber(n: number, decimals: number, opts: FormatNumberOptions = {}): string {
  if (!Number.isFinite(n)) return '—';
  let s = Math.abs(n).toFixed(decimals);
  const negative = n < 0 && Number(s) !== 0;
  if (opts.group && decimals === 0 && s.length > 3) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEP);
  return negative ? `${MINUS}${s}` : s;
}

/** Join a formatted value and unit: "%" attaches, everything else takes a space, '' adds nothing. */
export function withUnit(value: string, unit: string): string {
  if (!unit) return value;
  if (unit === '%') return `${value}%`;
  return `${value} ${unit}`;
}

/**
 * Replace a leading ASCII hyphen-minus on numbers with the Unicode minus. A
 * hyphen after a digit, letter or dot is not a sign ("2026-10-10", "BME-680").
 */
export function unicodeMinus(s: string): string {
  return s.replace(/(?<![\w.])-(?=\.?\d)/g, MINUS);
}

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const hPaToInHg = (hPa: number): number => hPa * 0.0295299830714;
export const mToFt = (m: number): number => m / 0.3048;
export const mToIn = (m: number): number => m / 0.0254;

/** "76.3 °F" from °C. */
export function fmtFahrenheit(c: number): string {
  return withUnit(formatNumber(cToF(c), 1), '°F');
}

/** "552 ft" from metres. */
export function fmtFeet(m: number): string {
  return withUnit(formatNumber(mToFt(m), 0, { group: true }), 'ft');
}

// Largest-to-smallest, so ages and durations report the coarsest units first.
const UNITS: ReadonlyArray<readonly [string, number]> = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1_000],
];

/**
 * Duration in the largest non-zero unit and the one below it: "2 h 14 m",
 * "4 d 4 h", "45 s". A zero second unit is dropped ("2 h", not "2 h 0 m";
 * "1 d" for 1 d 0 h 5 m). Under a second → "0 s". Negative input is treated
 * as its magnitude; a non-finite one is "—".
 */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  let rest = Math.floor(Math.abs(ms));
  const parts: string[] = [];
  for (const [unit, size] of UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0 || parts.length > 0) parts.push(`${n} ${unit}`);
    if (parts.length === 2) break;
  }
  if (parts.length === 0) return '0 s';
  if (parts.length === 2 && parts[1].startsWith('0 ')) parts.pop();
  return parts.join(' ');
}

/**
 * Seconds-precision age in the single largest unit: "12 s ago", "4 m ago",
 * "2 h ago", "1 d ago"; under a second → "just now". Future timestamps clamp
 * to "just now" (host/radio clock skew must never read as a negative age).
 */
export function fmtAge(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (!(diff >= 1_000)) return 'just now';
  for (const [unit, size] of UNITS) {
    if (diff >= size) return `${Math.floor(diff / size)} ${unit} ago`;
  }
  return 'just now';
}

/** Round trip and similar short spans: "1.8 s". */
export function fmtSeconds(ms: number): string {
  return withUnit(formatNumber(ms / 1000, 1), 's');
}
