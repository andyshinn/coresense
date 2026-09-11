import { cellHops, type DiscoveredContact } from '../../shared/contacts/discovered';
import type { CmHeard, CmSortField, CmStateTab, ContactManagerState } from './store';

export interface CmCounts {
  all: number;
  onRadio: number;
  discovered: number;
  blocked: number;
}
export interface CmView {
  rows: DiscoveredContact[];
  counts: CmCounts;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 604_800_000;

function heardWithin(c: DiscoveredContact, heard: CmHeard, nowMs: number): boolean {
  if (heard === 'any') return true;
  // Filter on OUR clock (lastHeardMs); the node's advert timestamp is unreliable
  // and a contact we've never received anything from shouldn't count as "heard
  // recently". Every never-heard row therefore disappears from every window but
  // "Any time" — which is why lastHeardMs has to be bumped from the message /
  // ack / path-learn receipt paths too, not just adverts (#45 item 9).
  if (c.lastHeardMs == null) return false;
  const age = nowMs - c.lastHeardMs;
  if (heard === 'hour') return age <= HOUR_MS;
  if (heard === 'day') return age <= DAY_MS;
  return age <= WEEK_MS;
}

function matchesTab(c: DiscoveredContact, tab: CmStateTab): boolean {
  switch (tab) {
    case 'on-radio':
      return c.onRadio && !c.blocked;
    case 'discovered':
      return !c.onRadio && !c.blocked;
    case 'blocked':
      return c.blocked;
    default:
      return !c.blocked;
  }
}

function compare(a: DiscoveredContact, b: DiscoveredContact, field: CmSortField): number {
  switch (field) {
    case 'firstHeard':
      return b.firstHeardMs - a.firstHeardMs;
    case 'name':
      return a.name.localeCompare(b.name);
    case 'type':
      return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
    case 'hops':
      // Sorts on whatever the cell actually renders — the measured inbound
      // count when there is one, the outbound route otherwise (cellHops). A
      // comparator reading a different field from its own column silently
      // reorders rows the user can see the numbers for.
      //
      // The `?? 0` is unreachable for an unknown-hop row: deriveContactView
      // partitions those out before this runs (see UNKNOWN_LAST). It is a type
      // narrowing, NOT a sort position — the old `?? 99` was the latter, which
      // is the bug.
      return (cellHops(a) ?? 0) - (cellHops(b) ?? 0);
    case 'key':
      return a.publicKeyHex.localeCompare(b.publicKeyHex);
    default:
      // 'lastHeard' — our-clock reception time, newest first. Same story as
      // 'hops': never-heard rows never reach this comparator.
      return (b.lastHeardMs ?? 0) - (a.lastHeardMs ?? 0);
  }
}

/** Sort fields on which a row can legitimately have NO value, and the predicate
 *  that spots one.
 *
 *  Absence is not a magnitude. Sorting these with a sentinel (`hops ?? 99`,
 *  `lastHeardMs ?? 0`) makes "unknown" behave as a hop count of 99 / an epoch
 *  timestamp — and because deriveContactView multiplies the comparator by the
 *  direction, the sentinel rides the flip: one click on Hops buried the
 *  unmeasured rows, the next floated all of them above every measured row (#45
 *  item 8). Rows matching the predicate are pinned AFTER the measured ones in
 *  both directions and ordered by name among themselves, so the flip only ever
 *  reorders rows that actually have a value to compare. */
const UNKNOWN_LAST: Partial<Record<CmSortField, (c: DiscoveredContact) => boolean>> = {
  // Unknown means the CELL has no number — a row with a measured inbound count
  // and no learned outbound route has one, and pinning it with the unmeasured
  // rows would bury the only contacts the Hops column can speak for at all.
  hops: (c) => cellHops(c) == null,
  lastHeard: (c) => c.lastHeardMs == null,
};

/** Counts are computed over the search+type+heard+fav filtered set (NOT the
 *  state-tab), so each tab shows how many rows it would contain. */
export function deriveContactView(discovered: DiscoveredContact[], cm: ContactManagerState, nowMs: number): CmView {
  const q = cm.search.trim().toLowerCase();
  const base = discovered.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q) && !c.publicKeyHex.includes(q)) return false;
    if (cm.types.length > 0 && !cm.types.includes(c.kind)) return false;
    if (!heardWithin(c, cm.heard, nowMs)) return false;
    if (cm.favOnly && !c.favourite) return false;
    return true;
  });

  const counts: CmCounts = {
    all: base.filter((c) => !c.blocked).length,
    onRadio: base.filter((c) => c.onRadio && !c.blocked).length,
    discovered: base.filter((c) => !c.onRadio && !c.blocked).length,
    blocked: base.filter((c) => c.blocked).length,
  };

  const dir: number = cm.sortDir === 'asc' ? 1 : -1;
  const isUnknown = UNKNOWN_LAST[cm.sortField];
  const rows = base
    .filter((c) => matchesTab(c, cm.stateTab))
    .sort((a, b) => {
      if (isUnknown) {
        const ua = isUnknown(a) ? 1 : 0;
        const ub = isUnknown(b) ? 1 : 0;
        // Partition OUTSIDE the `* dir` below, or the pin flips with the arrow.
        if (ua !== ub) return ua - ub;
        if (ua === 1) return a.name.localeCompare(b.name);
      }
      return compare(a, b, cm.sortField) * dir;
    });

  return { rows, counts };
}
