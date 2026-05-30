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
  /** Last advert time (their clock), ms. */
  lastAdvertMs?: number;
  /** First time WE heard this pubkey (our clock), ms. Tracked app-side. */
  firstHeardMs: number;
  onRadio: boolean;
  favourite: boolean;
  blocked: boolean;
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
