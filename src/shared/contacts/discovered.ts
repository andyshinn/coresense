import type { BlockRule, ContactKind, PathHashSize } from '../types';

/** A node we've heard an advert from. Superset of the on-radio contact list:
 *  `onRadio` marks whether it is currently committed to the radio's store. */
export interface DiscoveredContact {
  key: string; // `c:${publicKeyHex}`
  publicKeyHex: string;
  name: string;
  kind: ContactKind;
  hops?: number;
  outPathHex?: string;
  outPathHashSize?: PathHashSize;
  gpsLat?: number;
  gpsLon?: number;
  /** Last advert time stamped by the NODE's own clock, ms. Unreliable — a node
   *  with a wrong RTC can report a time in the future or far past. Shown as the
   *  secondary "advertised" timestamp, never used for the "last heard" sort. */
  lastAdvertMs?: number;
  /** Last time WE actually heard a live advert (our clock), ms. Set only on a
   *  real PUSH_NEW_ADVERT, never on a GET_CONTACTS resync — so committing a
   *  contact to the radio doesn't bump it. Undefined until first live advert. */
  lastHeardMs?: number;
  /** First time WE heard this pubkey (our clock), ms. Tracked app-side. */
  firstHeardMs: number;
  onRadio: boolean;
  favourite: boolean;
  blocked: boolean;
}

/** Hops away, derived from a contact's stored out_path length. MeshCore stores
 *  the routing path as one 1-byte hash per hop (firmware PATH_HASH_SIZE = 1 in
 *  src/MeshCore.h), so the byte length IS the hop count — do NOT divide by the
 *  on-air path-hash mode. 0xFF (OUT_PATH_UNKNOWN) means no path established yet
 *  → unknown / flood. 0 = direct (zero hops). */
export function hopsFromOutPathLen(outPathLen: number): number | undefined {
  return outPathLen === 0xff ? undefined : outPathLen;
}

/** Evaluate a contact's pubkey/name against the enabled block rules. Mirrors
 *  the message matcher's rule semantics (see shared/blocking/match.ts) but for
 *  a contact identity rather than a message. */
export function contactMatchesAnyBlockRule(
  publicKeyHex: string,
  name: string,
  rules: BlockRule[],
): boolean {
  const pk = publicKeyHex.toLowerCase();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    switch (rule.type) {
      case 'pubkey':
        if (pk === rule.pattern.toLowerCase()) return true;
        break;
      case 'pubkeyPrefix':
        if (pk.startsWith(rule.pattern.toLowerCase())) return true;
        break;
      case 'name':
        if (name === rule.pattern) return true;
        break;
      case 'nameRegex':
        try {
          if (new RegExp(rule.pattern, 'i').test(name)) return true;
        } catch {
          // invalid regex → treat as non-matching (mirrors matcher behavior)
        }
        break;
    }
  }
  return false;
}
