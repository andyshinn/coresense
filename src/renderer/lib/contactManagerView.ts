import type { DiscoveredContact } from '../../shared/contacts/discovered';
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
  // and a contact we've never heard live shouldn't count as "heard recently".
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
      return (a.hops ?? 99) - (b.hops ?? 99);
    case 'key':
      return a.publicKeyHex.localeCompare(b.publicKeyHex);
    default:
      // 'lastHeard' — our-clock reception time; never-heard rows sort oldest.
      return (b.lastHeardMs ?? 0) - (a.lastHeardMs ?? 0);
  }
}

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
  const rows = base.filter((c) => matchesTab(c, cm.stateTab)).sort((a, b) => compare(a, b, cm.sortField) * dir);

  return { rows, counts };
}
