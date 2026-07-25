// Pure model for the channel People rail. No React, no store, no DOM — every
// decision the section makes lives here so it can be tested at the boundaries.
//
// Keep this module store-free: its tests run in the `unit` project under
// environment: 'node'.

import type { DiscoveredContact } from '../../../../shared/contacts/discovered';
import type { ChannelSenderStat, Contact, PeopleFilter, PeopleSort } from '../../../../shared/types';
import { buildDiscoveredNameIndex, type IdentitySource, resolveIdentity } from '../../../lib/identity';

export type BucketId = 'today' | 'yesterday' | 'week' | 'earlier';

export interface RosterRow {
  /** The raw from_pk. Unique — it is a GROUP BY key. */
  id: string;
  name: string;
  pubkey: string | null;
  contactKey: string | null;
  source: IdentitySource;
  ambiguous: boolean;
  blocked: boolean;
  inContacts: boolean;
  /** Messages seen in THIS channel, not globally. */
  msgCount: number;
  lastSeenAt: number;
}

export interface Bucket {
  id: BucketId;
  label: string;
  rows: RosterRow[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const BUCKET_LABELS: Record<BucketId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

const BUCKET_ORDER: BucketId[] = ['today', 'yesterday', 'week', 'earlier'];

/** Map the raw roster to rows, dropping self (`null`) and the `'unknown'`
 *  aggregate — neither has a name to search or sort, a key, or an action, and
 *  `distinctSenders` already excludes both. */
export function toRosterRows(
  roster: ChannelSenderStat[],
  contacts: Contact[],
  discovered: DiscoveredContact[],
): RosterRow[] {
  const index = buildDiscoveredNameIndex(discovered);
  const rows: RosterRow[] = [];
  for (const entry of roster) {
    if (!entry.fromPk || entry.fromPk === 'unknown') continue;
    const id = resolveIdentity(entry.fromPk, contacts, index);
    if (id.name === null) continue;
    rows.push({
      id: entry.fromPk,
      name: id.name,
      pubkey: id.pubkey,
      contactKey: id.contactKey,
      source: id.source,
      ambiguous: id.ambiguous,
      blocked: id.blocked,
      inContacts: id.source === 'contact',
      msgCount: entry.count,
      lastSeenAt: entry.lastTs,
    });
  }
  return rows;
}

/** Compact age: now · 12m · 3h · 2d · 3w. Never prints "ago", "hours" or
 *  "days" — that is what the tooltip is for. Distinct from `time.ts`'s
 *  `fmtAgoShort` (which prints "3m ago" / "5h ago", has no weeks rung, and
 *  has no `—` sentinel) — that formatter is for the Activity section's
 *  looser layout; this one is for the People rail's fixed-width age column. */
export function fmtAge(ts: number, now: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  // Node RTCs are unreliable and can report the future; clamp rather than
  // rendering a negative age.
  const elapsed = Math.max(0, now - ts);
  if (elapsed < MIN) return 'now';
  const mins = Math.floor(elapsed / MIN);
  if (mins < 60) return `${mins}m`;
  if (elapsed < DAY) {
    // Math.round(1439/60) is 24, which belongs to the next rung — clamp.
    return `${Math.min(23, Math.round(mins / 60))}h`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** At most three characters — SF Mono is 0.618em/char, so a fourth overflows
 *  the 26px count track at 11px. */
export function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  return `${Math.min(99, Math.floor(n / 1000))}k`;
}

function localMidnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar-relative, not rolling. Math.round (not floor) so 23- and 25-hour
 *  DST days still land on whole day counts. */
export function bucketFor(ts: number, now: number): BucketId {
  const days = Math.round((localMidnight(now) - localMidnight(ts)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 7) return 'week';
  return 'earlier';
}

/** Sort key with leading non-alphanumerics stripped, so an emoji or punctuation
 *  prefix sorts by the first real character. */
function nameSortKey(name: string): string {
  return name.replace(/^[^\p{L}\p{N}]+/u, '') || name;
}

export function sortRoster(rows: RosterRow[], sort: PeopleSort): RosterRow[] {
  const out = [...rows];
  switch (sort) {
    case 'recent':
      out.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      break;
    case 'loud':
      out.sort(
        (a, b) =>
          b.msgCount - a.msgCount ||
          b.lastSeenAt - a.lastSeenAt ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      break;
    case 'name':
      out.sort((a, b) => nameSortKey(a.name).localeCompare(nameSortKey(b.name), undefined, { sensitivity: 'base' }));
      break;
  }
  return out;
}

export function filterRoster(rows: RosterRow[], filter: PeopleFilter, query: string): RosterRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === 'contacts' && !r.inContacts) return false;
    if (q && !r.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Buckets in fixed order, empty ones omitted. Row order within a bucket is
 *  preserved, so the caller's sort survives. */
export function groupByBucket(rows: RosterRow[], now: number): Bucket[] {
  const byId = new Map<BucketId, RosterRow[]>();
  for (const r of rows) {
    const id = bucketFor(r.lastSeenAt, now);
    const bucket = byId.get(id);
    if (bucket) bucket.push(r);
    else byId.set(id, [r]);
  }
  return BUCKET_ORDER.filter((id) => byId.has(id)).map((id) => ({
    id,
    label: BUCKET_LABELS[id],
    rows: byId.get(id) as RosterRow[],
  }));
}

/** Loudest row in the CURRENT set, so bars answer "who's loud here" and
 *  re-normalise when a filter or search changes the set. */
export function maxCount(rows: RosterRow[]): number {
  let max = 0;
  for (const r of rows) if (r.msgCount > max) max = r.msgCount;
  return max;
}

export function volumeWidth(count: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.max(6, (count / max) * 100)}%`;
}
