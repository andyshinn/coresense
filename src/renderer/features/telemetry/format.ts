// Presentation helpers shared by the telemetry components: list chips and
// detail lines, day buckets, permission labels. Reading values and units come
// from src/shared/telemetry (describe/format); this file only arranges them.

import { formatHops } from '../../../shared/contacts/discovered';
import { type ChannelGroup, type DescribedReading, describeReading } from '../../../shared/telemetry/describe';
import { fmtAge, fmtSeconds, formatNumber, withUnit } from '../../../shared/telemetry/format';
import type { Reading } from '../../../shared/telemetry/lpp';
import type { PreviousReading, SavedRequestDto } from '../../../shared/telemetry/types';
import type { RepeaterAclRole, TimeFormatPref } from '../../../shared/types';
import { distanceKm } from '../../lib/contactDetail';
import { dayKey, fmtTime } from '../../lib/time';

/** The request fields the list, chips and states read. */
export type RequestSummary = Pick<
  SavedRequestDto,
  'id' | 'requestedAt' | 'outcome' | 'error' | 'roundTripMs' | 'hops' | 'route' | 'aclRole' | 'readings' | 'rawHex'
>;

/**
 * Wall clock with seconds ("21:29:48" / "9:29:48 PM"), honouring the 12/24-hour
 * preference the same way lib/time's fmtTime does. The request log needs the
 * seconds: a retry after a 15 s timeout lands in the same minute.
 */
export function fmtClock(ts: number, pref: TimeFormatPref): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: pref === '12h' ? true : pref === '24h' ? false : undefined,
  });
}

/**
 * "18:42" today, "Oct 5, 18:42" on any other day (plus the year when it isn't
 * this year's): a tile's previous value can be days old.
 */
export function fmtWhen(ts: number, pref: TimeFormatPref, now: number = Date.now()): string {
  if (dayKey(ts) === dayKey(now)) return fmtTime(ts, pref);
  const d = new Date(ts);
  const day = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
  return `${day}, ${fmtTime(ts, pref)}`;
}

/** Day bucket for the request log: "Today", "Yesterday", else "Oct 5" (plus the year when it isn't this year's). */
export function dayLabel(ts: number, now: number = Date.now()): string {
  const key = dayKey(ts);
  if (key === dayKey(now)) return 'Today';
  const n = new Date(now);
  if (key === dayKey(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime())) return 'Yesterday';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric',
  });
}

const ROLE_LABEL: Record<RepeaterAclRole, string> = {
  guest: 'guest',
  readOnly: 'read-only',
  readWrite: 'read-write',
  admin: 'admin',
};

/** "admin", "read-only", … for chips and detail lines. */
export function roleLabel(role: RepeaterAclRole): string {
  return ROLE_LABEL[role];
}

export type ChipTone = 'ok' | 'warn' | 'bad' | 'off';

export interface RequestChip {
  tone: ChipTone;
  text: string;
}

/** "N readings" (neutral; warn for a guest's base-only reply) or the failure outcome (bad). */
export function requestChip(req: Pick<RequestSummary, 'outcome' | 'readings' | 'aclRole'>): RequestChip {
  if (req.outcome !== 'ok') return { tone: 'bad', text: req.outcome };
  const n = req.readings.length;
  return { tone: req.aclRole === 'guest' ? 'warn' : 'off', text: `${n} reading${n === 1 ? '' : 's'}` };
}

/** How the request travelled: "2 hops" / "flood" / "local read", or null when unknown. */
export function routeLabel(req: Pick<RequestSummary, 'hops' | 'route'>): string | null {
  if (req.route === 'local') return 'local read';
  if (req.route === 'flood') return 'flood';
  if (req.hops !== null) return formatHops(req.hops);
  return req.route;
}

/** Whole seconds for "no reply in 15 s". */
function waitedLabel(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))} s`;
}

/**
 * The log row's second line. A reply: round trip · route · role ("1.8 s ·
 * 0 hops · admin"; a guest adds "base only"). A failure: its reason · route
 * ("no reply in 15 s · flood").
 */
export function requestDetail(req: RequestSummary): string {
  const route = routeLabel(req);
  if (req.outcome === 'ok') {
    const parts = [
      req.roundTripMs !== null ? fmtSeconds(req.roundTripMs) : null,
      route,
      req.aclRole === 'guest' ? 'guest · base only' : req.aclRole ? roleLabel(req.aclRole) : null,
    ];
    return parts.filter(Boolean).join(' · ');
  }
  const reason =
    req.outcome === 'timeout'
      ? req.roundTripMs !== null
        ? `no reply in ${waitedLabel(req.roundTripMs)}`
        : 'no reply'
      : (req.error ?? 'error');
  return [reason, route].filter(Boolean).join(' · ');
}

/**
 * The compare-mode second line: age and role ("2 h ago · admin"; a guest's
 * "guest · base only"), or for a failure, why ("no reply in 15 s · flood").
 */
export function compareDetail(req: RequestSummary, now: number = Date.now()): string {
  if (req.outcome !== 'ok') return requestDetail(req);
  const role = req.aclRole === 'guest' ? 'guest · base only' : req.aclRole ? roleLabel(req.aclRole) : null;
  return [fmtAge(req.requestedAt, now), role].filter(Boolean).join(' · ');
}

/** Payload size in bytes (padding included), or 0 with no reply. */
export function payloadBytes(req: Pick<RequestSummary, 'rawHex'>): number {
  return req.rawHex ? req.rawHex.length / 2 : 0;
}

/** "N bytes · M readings", the inspector's and header's size line. */
export function sizeLine(bytes: number, readings: number): string {
  return `${bytes} byte${bytes === 1 ? '' : 's'} · ${readings} reading${readings === 1 ? '' : 's'}`;
}

/**
 * The selected request's header meta: "12 s ago · 1.8 s round trip · 0 hops ·
 * 42 bytes · 9 readings". A failure keeps age and route.
 */
export function requestMetaLine(req: RequestSummary, now: number = Date.now()): string {
  const route = routeLabel(req);
  if (req.outcome !== 'ok') return [fmtAge(req.requestedAt, now), route].filter(Boolean).join(' · ');
  return [
    fmtAge(req.requestedAt, now),
    req.roundTripMs !== null ? `${fmtSeconds(req.roundTripMs)} round trip` : null,
    route,
    sizeLine(payloadBytes(req), req.readings.length),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "3 h old" for the older-request chip. */
export function ageOld(ts: number, now: number = Date.now()): string {
  return fmtAge(ts, now).replace(/ ago$/, ' old');
}

/**
 * Which permissions a channel's readings fall under, for the group header
 * chip: ch 1 is Base, plus Location when it carries GPS and Environment when
 * it carries a sensor (a T1000-E's luminosity and temperature); every other
 * channel is Environment (MeshCore's TELEM_PERM_* split).
 */
export function channelPermission(group: Pick<ChannelGroup, 'ch' | 'readings'>): string {
  if (group.ch !== 1) return 'Environment';
  const parts = ['Base'];
  if (group.readings.some((d) => d.kind === 'gps')) parts.push('Location');
  if (group.readings.some((d) => d.kind !== 'battery' && d.kind !== 'mcuTemp' && d.kind !== 'gps')) {
    parts.push('Environment');
  }
  return parts.join(' · ');
}

/** "2 m" / "1.4 km" between two positions, for "N m from advertised". */
export function fmtGap(a: { lat: number; lon: number }, b: { lat: number; lon: number }): string {
  const km = distanceKm(a.lat, a.lon, b.lat, b.lon);
  return km < 1 ? `${Math.round(km * 1000)} m` : `${formatNumber(km, 1)} km`;
}

/**
 * An earlier value of `d`'s reading in `d`'s display unit ("4.22 V", "48 211 Ω").
 * The previous reading is described on its own, so where describe() took the
 * unit from the channel's field set (BME680 Ω, RAK12035 calibration) the
 * current tile's unit wins; current keeps its own mA/A choice.
 */
export function previousText(d: DescribedReading, previous: Reading): string {
  const p = describeReading(previous, [previous]);
  return withUnit(p.value, d.baseUnit === p.baseUnit ? p.unit : d.unit);
}

/** Index a request's `previous` lookups (aligned with its readings) by reading offset, for groups and tiles. */
export function previousByOffset(
  readings: readonly Reading[],
  previous: ReadonlyArray<PreviousReading | null>,
): ReadonlyMap<number, PreviousReading> {
  const out = new Map<number, PreviousReading>();
  readings.forEach((r, i) => {
    const p = previous[i];
    if (p) out.set(r.offset, p);
  });
  return out;
}
