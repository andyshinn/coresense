import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type { Contact, RepeaterNeighbour } from '../../shared/types';

// 'protocol' is reserved for a future firmware that returns the neighbour's name
// in the response; current firmware sends only the key prefix, so resolveNeighbours
// emits only 'contacts' or 'unknown' today.
export type NeighbourNameSource = 'protocol' | 'contacts' | 'unknown';

export interface ResolvedNeighbour {
  pubKeyPrefixHex: string;
  heardSecsAgo: number;
  snrDb: number;
  name: string;
  nameSource: NeighbourNameSource;
  contactKey: string | null;
  lat: number | null;
  lon: number | null;
  located: boolean;
  ambiguous: boolean;
}

const UNKNOWN_NAME = 'Unknown repeater';

// Normalized match candidate drawn from either the on-radio contact list or the
// discovered list. `heardMs` is "when WE last heard it" for the recency tie-break.
interface Candidate {
  key: string;
  publicKeyHex: string;
  name: string;
  lat: number | null;
  lon: number | null;
  located: boolean;
  heardMs: number;
}

// Both coords present, not the 0/0 "no GPS" sentinel, and within WGS84 range
// (mirrors hasValidFix, but works on the looser DiscoveredContact too).
function coordsValid(lat: number | undefined, lon: number | undefined): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    (lat !== 0 || lon !== 0) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function contactCandidate(c: Contact): Candidate {
  const located = coordsValid(c.gpsLat, c.gpsLon);
  return {
    key: c.key,
    publicKeyHex: c.publicKeyHex.toLowerCase(),
    name: c.name,
    lat: located ? (c.gpsLat as number) : null,
    lon: located ? (c.gpsLon as number) : null,
    located,
    heardMs: c.lastSeenMs ?? 0,
  };
}

function discoveredCandidate(d: DiscoveredContact): Candidate {
  const located = coordsValid(d.gpsLat, d.gpsLon);
  return {
    key: d.key,
    publicKeyHex: d.publicKeyHex.toLowerCase(),
    name: d.name,
    lat: located ? (d.gpsLat as number) : null,
    lon: located ? (d.gpsLon as number) : null,
    located,
    heardMs: d.lastHeardMs ?? d.firstHeardMs ?? 0,
  };
}

// Merge on-radio + discovered, de-duped by publicKeyHex — the on-radio contact
// wins (it's the committed record).
function buildCandidates(contacts: Contact[], discovered: DiscoveredContact[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const d of discovered) byKey.set(d.publicKeyHex.toLowerCase(), discoveredCandidate(d));
  for (const c of contacts) byKey.set(c.publicKeyHex.toLowerCase(), contactCandidate(c));
  return [...byKey.values()];
}

// Best of several prefix matches: a located match wins; tie-break by recency.
function pickBest(matches: Candidate[]): Candidate {
  return [...matches].sort((a, b) => {
    if (a.located !== b.located) return a.located ? -1 : 1;
    return b.heardMs - a.heardMs;
  })[0] as Candidate;
}

export function resolveNeighbours(
  raw: RepeaterNeighbour[],
  contacts: Contact[],
  discovered: DiscoveredContact[],
): ResolvedNeighbour[] {
  const candidates = buildCandidates(contacts, discovered);
  return raw.map((n) => {
    const prefix = n.pubKeyPrefixHex.toLowerCase();
    const matches = candidates.filter((c) => c.publicKeyHex.startsWith(prefix));
    if (matches.length === 0) {
      return {
        pubKeyPrefixHex: n.pubKeyPrefixHex,
        heardSecsAgo: n.heardSecsAgo,
        snrDb: n.snrDb,
        name: UNKNOWN_NAME,
        nameSource: 'unknown',
        contactKey: null,
        lat: null,
        lon: null,
        located: false,
        ambiguous: false,
      };
    }
    const best = matches.length === 1 ? (matches[0] as Candidate) : pickBest(matches);
    return {
      pubKeyPrefixHex: n.pubKeyPrefixHex,
      heardSecsAgo: n.heardSecsAgo,
      snrDb: n.snrDb,
      name: best.name,
      nameSource: 'contacts',
      contactKey: best.key,
      lat: best.lat,
      lon: best.lon,
      located: best.located,
      ambiguous: matches.length > 1,
    };
  });
}

/** Resolve a single neighbour key prefix to its best-matching contact's
 *  publicKeyHex (or null if unmatched), reusing resolveNeighbours' best-match
 *  selection. Used to point the rail's contact card at the selected neighbour. */
export function resolveNeighbourPublicKey(
  prefix: string,
  contacts: Contact[],
  discovered: DiscoveredContact[],
): string | null {
  const [resolved] = resolveNeighbours(
    [{ pubKeyPrefixHex: prefix, heardSecsAgo: 0, snrDb: 0 }],
    contacts,
    discovered,
  );
  // contactKey is `c:<publicKeyHex>`; strip the prefix for ContactDetail.
  return resolved?.contactKey ? resolved.contactKey.slice(2) : null;
}

// ── Client-side sorting ────────────────────────────────────────────────
export type NeighbourSortKey = 'snr-desc' | 'snr-asc' | 'recent' | 'oldest' | 'name';

export const NEIGHBOUR_SORTS: Record<
  NeighbourSortKey,
  { label: string; cmp: (a: ResolvedNeighbour, b: ResolvedNeighbour) => number }
> = {
  'snr-desc': { label: 'Strongest SNR', cmp: (a, b) => b.snrDb - a.snrDb },
  'snr-asc': { label: 'Weakest SNR', cmp: (a, b) => a.snrDb - b.snrDb },
  recent: { label: 'Most recent', cmp: (a, b) => a.heardSecsAgo - b.heardSecsAgo },
  oldest: { label: 'Oldest', cmp: (a, b) => b.heardSecsAgo - a.heardSecsAgo },
  name: { label: 'Name (A–Z)', cmp: (a, b) => a.name.localeCompare(b.name) },
};

export function sortNeighbours(
  list: ResolvedNeighbour[],
  key: NeighbourSortKey,
): ResolvedNeighbour[] {
  const sort = NEIGHBOUR_SORTS[key] ?? NEIGHBOUR_SORTS['snr-desc'];
  return [...list].sort(sort.cmp);
}
