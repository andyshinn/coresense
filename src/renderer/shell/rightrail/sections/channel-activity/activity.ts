import type { ActivityBand, ActivityWindow, ActivityWindowKey } from '../../../../../shared/types';

/** Rail widths below this drop the section to number + trend + bare sparkline.
 *  Measured against the rail's OUTER width (ui.rightWidth), which is what the
 *  design reference measured. Rail bounds are 240 / 320 default / 640. */
export const COLLAPSE_WIDTH = 304;

export type ActivityMode = 'collapsed' | 'full';

const HOUR_MS = 3_600_000;

/** Percentage change vs the previous equal period, or null when there is no
 *  previous period — a channel's first week has nothing to compare against and
 *  must not render NaN% or Infinity%. */
export function trendPct(total: number, prevTotal: number): number | null {
  if (prevTotal <= 0) return null;
  return Math.round(((total - prevTotal) / prevTotal) * 100);
}

/** Start edge of bucket `i`. Daily windows step calendar days via setDate() so a
 *  DST day stays one bucket; the hourly window is plain ms arithmetic. */
export function bucketStart(win: ActivityWindowKey, startMs: number, i: number): number {
  if (win === '24h') return startMs + i * HOUR_MS;
  const d = new Date(startMs);
  d.setDate(d.getDate() + i);
  return d.getTime();
}

function hour12(h: number): { n: number; ap: 'AM' | 'PM' } {
  const ap: 'AM' | 'PM' = h < 12 ? 'AM' : 'PM';
  const n = h % 12 === 0 ? 12 : h % 12;
  return { n, ap };
}

/** Sparse axis labels, one entry per bucket so they align with the flex-1 bars.
 *  Positions are computed from real bucket edges — hardcoding "M T W T F S S"
 *  would be wrong on any day that is not a Sunday. */
export function axisTicks(win: ActivityWindowKey, startMs: number, len: number): string[] {
  const out = new Array<string>(len).fill('');
  if (win === '24h') {
    for (let i = 0; i < len; i++) {
      const h = new Date(bucketStart(win, startMs, i)).getHours();
      if (h === 0) out[i] = '12a';
      else if (h === 6) out[i] = '6a';
      else if (h === 12) out[i] = '12p';
      else if (h === 18) out[i] = '6p';
    }
  } else if (win === '7d') {
    for (let i = 0; i < len; i++) {
      out[i] = new Date(bucketStart(win, startMs, i)).toLocaleDateString(undefined, { weekday: 'short' }).charAt(0);
    }
    return out;
  } else {
    if (len > 0) out[0] = '30d';
    if (len > 10) out[10] = '20d';
    if (len > 20) out[20] = '10d';
  }
  if (len > 0) out[len - 1] = 'now';
  return out;
}

/** Tooltip bucket name: "6 PM", "Mon", "8d ago", "today". */
export function bucketLabel(win: ActivityWindowKey, startMs: number, i: number, len: number): string {
  const at = new Date(bucketStart(win, startMs, i));
  if (win === '24h') {
    const { n, ap } = hour12(at.getHours());
    return `${n} ${ap}`;
  }
  if (win === '7d') return at.toLocaleDateString(undefined, { weekday: 'short' });
  const back = len - 1 - i;
  return back === 0 ? 'today' : `${back}d ago`;
}

/** "7–10 PM" when both ends share a meridiem, "11 PM–2 AM" when they do not. */
export function fmtBand(band: ActivityBand): string {
  const s = hour12(band.startHour);
  const e = hour12(band.endHour);
  return s.ap === e.ap ? `${s.n}–${e.n} ${s.ap}` : `${s.n} ${s.ap}–${e.n} ${e.ap}`;
}

const WINDOW_PHRASE: Record<ActivityWindowKey, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
};

/** The chart is a role="img" whose bars are decorative, so this label is the
 *  entire read-out for assistive tech — it has to carry the shape, not just
 *  the title. Hover tooltips are a pointer-only enhancement. */
export function chartAriaLabel(win: ActivityWindowKey, data: ActivityWindow): string {
  const unit = win === '24h' ? 'hour' : 'day';
  const head = `Message volume by ${unit}, ${WINDOW_PHRASE[win]}.`;
  if (data.total === 0) return `${head} No messages.`;
  let peak = 0;
  for (let i = 1; i < data.buckets.length; i++) if (data.buckets[i] > data.buckets[peak]) peak = i;
  const at = bucketLabel(win, data.startMs, peak, data.buckets.length);
  return `${head} ${data.total} messages, busiest ${data.buckets[peak]} at ${at}.`;
}
