// Resolving a channel poster to a real identity.
//
// MeshCore's channel messages carry NO sender pubkey on the wire — the library
// stores `name:<n>` in from_pk and says so explicitly. The only name→pubkey
// bridges we have are the saved contact list and the advert-derived discovered
// pool, both matched by exact name equality. That is why the identity colour
// mode exists: 'byKey' admits we often don't know who someone is and greys them
// out; 'byName' colours everyone from the string we do have.

import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type { Contact, IdentityColorMode } from '../../shared/types';

export type IdentitySource = 'contact' | 'discovered' | 'none';

export interface ResolvedIdentity {
  /** Display name, or null for self / 'unknown' (which have none). */
  name: string | null;
  pubkey: string | null;
  /** Route key for the contact page (`c:<pkhex>`), when saved. */
  contactKey: string | null;
  source: IdentitySource;
  /** True when the name matched >1 discovered node — treated as unresolved. */
  ambiguous: boolean;
  blocked: boolean;
}

const NONE: ResolvedIdentity = {
  name: null,
  pubkey: null,
  contactKey: null,
  source: 'none',
  ambiguous: false,
  blocked: false,
};

/** Group discovered rows by display name. `name` has no UNIQUE constraint in
 *  discovered_contacts, so this is genuinely one-to-many. */
export function buildDiscoveredNameIndex(rows: DiscoveredContact[]): Map<string, DiscoveredContact[]> {
  const index = new Map<string, DiscoveredContact[]>();
  for (const row of rows) {
    const bucket = index.get(row.name);
    if (bucket) bucket.push(row);
    else index.set(row.name, [row]);
  }
  return index;
}

// The name index is derived purely from the `discovered` array, and every
// caller passes the same array instance from the store — so a one-entry cache
// keyed on that identity is enough. It matters because useIdentityHash runs
// once per rendered message row: without this, a contact sync rebuilt the whole
// index (rows on screen) x (websocket messages) times.
let cachedRows: readonly DiscoveredContact[] | null = null;
let cachedIndex: Map<string, DiscoveredContact[]> | null = null;

/** Name-keyed index over the discovered pool, memoised on the array identity.
 *  Prefer this over calling buildDiscoveredNameIndex directly in a render. */
export function discoveredNameIndex(rows: DiscoveredContact[]): Map<string, DiscoveredContact[]> {
  if (cachedRows === rows && cachedIndex !== null) return cachedIndex;
  const index = buildDiscoveredNameIndex(rows);
  cachedRows = rows;
  cachedIndex = index;
  return index;
}

/** Find a discovered row by pubkey rather than name. The name-keyed index is
 *  the only structure callers build, so this scans its buckets rather than
 *  asking every call site to also build a pubkey-keyed one. Both branches that
 *  resolve to a known pubkey use it to read `blocked`, since the pubkey is the
 *  only stable join key — display names drift. */
function findDiscoveredByPubkey(
  discoveredByName: Map<string, DiscoveredContact[]>,
  pubkey: string,
): DiscoveredContact | undefined {
  for (const rows of discoveredByName.values()) {
    const hit = rows.find((r) => r.publicKeyHex === pubkey);
    if (hit) return hit;
  }
  return undefined;
}

export function resolveIdentity(
  fromPk: string | null | undefined,
  contacts: Contact[],
  discoveredByName: Map<string, DiscoveredContact[]>,
): ResolvedIdentity {
  if (!fromPk || fromPk === 'unknown') return NONE;

  if (!fromPk.startsWith('name:')) {
    // A raw hex pubkey. Not currently produced for channel posts, but DMs and
    // several other call sites pass one. `blocked` still comes from the
    // discovered pool — every heard node (saved or not) has a row there — not
    // from a hardcoded false, so a blocked saved contact or a blocked node we
    // have no contact for both report correctly.
    const saved = contacts.find((c) => c.publicKeyHex === fromPk);
    const heard = findDiscoveredByPubkey(discoveredByName, fromPk);
    return {
      name: saved?.name ?? null,
      pubkey: fromPk,
      contactKey: saved?.key ?? null,
      source: saved ? 'contact' : 'none',
      ambiguous: false,
      blocked: heard?.blocked ?? false,
    };
  }

  const name = fromPk.slice(5);

  const saved = contacts.find((c) => c.name === name);
  if (saved) {
    // Looked up by PUBKEY, not by the name we just matched on: a locally
    // renamed contact keeps the radio's advertised name in discovered_contacts,
    // so a name-keyed lookup would miss the block. `Contact` carries no blocked
    // field of its own — discovered_contacts is the only carrier, and every
    // on-radio contact has a row there because contactSync upserts the whole
    // radio list with onRadio: true.
    return {
      name,
      pubkey: saved.publicKeyHex,
      contactKey: saved.key,
      source: 'contact',
      ambiguous: false,
      blocked: findDiscoveredByPubkey(discoveredByName, saved.publicKeyHex)?.blocked ?? false,
    };
  }

  const heard = discoveredByName.get(name);
  if (heard && heard.length === 1) {
    return {
      name,
      pubkey: heard[0].publicKeyHex,
      contactKey: null,
      source: 'discovered',
      ambiguous: false,
      blocked: heard[0].blocked,
    };
  }

  // Either never heard, or >1 node advertises this name. Ambiguous is treated
  // exactly as unresolved: the roster re-broadcasts in full on every advert, so
  // "newest wins" would let a stranger flip someone's hue mid-session.
  return { name, pubkey: null, contactKey: null, source: 'none', ambiguous: (heard?.length ?? 0) > 1, blocked: false };
}

/** The string to hash for this identity's ramp slot, or null for a neutral
 *  (hueless) mark. */
export function identityHashInput(r: ResolvedIdentity, mode: IdentityColorMode): string | null {
  if (mode === 'byName') return r.name;
  return r.pubkey;
}
