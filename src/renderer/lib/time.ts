import type { TimeFormatPref } from '../../shared/types';

// All timestamp rendering flows through here so the user's 12/24-hour
// preference is honored consistently. Electron ships full ICU, so the native
// Intl APIs cover everything — no date library needed.

// 'auto' → undefined lets the locale's own clock convention win; the explicit
// values force a 12- or 24-hour clock.
function hour12Of(pref: TimeFormatPref): boolean | undefined {
  if (pref === '12h') return true;
  if (pref === '24h') return false;
  return undefined;
}

// Wall-clock HH:MM (e.g. "14:05" or "2:05 PM").
export function fmtTime(ts: number, pref: TimeFormatPref): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: hour12Of(pref),
  });
}

// HH:MM:SS.mmm — millisecond precision for the raw packet log.
export function fmtTimePrecise(ts: number, pref: TimeFormatPref): string {
  const d = new Date(ts);
  const hms = d.toLocaleTimeString(undefined, { hour12: hour12Of(pref) });
  return `${hms}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

// Full date + time — shown in hover tooltips behind relative labels.
export function fmtDateTime(ts: number, pref: TimeFormatPref): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: hour12Of(pref),
  });
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

// Largest-to-smallest so we report in the coarsest unit that fits. 'numeric:
// auto' turns the obvious values into words ("yesterday", "last week").
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

// Human-readable "2 minutes ago" / "in 3 hours" / "yesterday".
export function fmtRelative(ts: number, now: number = Date.now()): string {
  const diff = ts - now; // negative = past, positive = future
  const abs = Math.abs(diff);
  if (abs < 45_000) return 'just now';
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return RELATIVE.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}
