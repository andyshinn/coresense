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

export function resolveIdentity(
  fromPk: string | null | undefined,
  contacts: Contact[],
  discoveredByName: Map<string, DiscoveredContact[]>,
): ResolvedIdentity {
  if (!fromPk || fromPk === 'unknown') return NONE;

  if (!fromPk.startsWith('name:')) {
    // A raw hex pubkey. Not currently produced for channel posts, but DMs and
    // several other call sites pass one.
    const saved = contacts.find((c) => c.publicKeyHex === fromPk);
    return {
      name: saved?.name ?? null,
      pubkey: fromPk,
      contactKey: saved?.key ?? null,
      source: saved ? 'contact' : 'none',
      ambiguous: false,
      blocked: false,
    };
  }

  const name = fromPk.slice(5);

  const saved = contacts.find((c) => c.name === name);
  if (saved) {
    return {
      name,
      pubkey: saved.publicKeyHex,
      contactKey: saved.key,
      source: 'contact',
      ambiguous: false,
      blocked: false,
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
