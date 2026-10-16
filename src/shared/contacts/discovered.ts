import { type BlockRule, type ContactKind, type DiscoveredContact, isPathHashSize, type PathHashSize } from '../types';

// The type lives with the other domain records in shared/types; re-exported
// here for the modules that import it alongside these helpers.
export type { DiscoveredContact };

/** Hops away, derived from a contact's stored out_path_len. This is the packed
 *  MeshCore path-length byte, NOT a raw byte count: bits 5-0 hold the hop count
 *  and bits 7-6 hold hashSize-1 (firmware Packet::setPathHashSizeAndCount /
 *  getPathByteLen). The real path occupies hops × hashSize bytes. So a direct
 *  2-byte-mode contact stores 0x40 (hop count 0, hashSize 2) — its hop count is
 *  0, not 64. 0xFF (OUT_PATH_UNKNOWN) means no path established yet → flood. */
export function hopsFromOutPathLen(outPathLen: number): number | undefined {
  return outPathLen === 0xff ? undefined : outPathLen & 0x3f;
}

/** Bytes-per-hop for a contact's stored path, derived from the same packed
 *  out_path_len byte (bits 7-6 + 1). Lets callers split a learned out_path into
 *  hops using the contact's OWN hash size rather than assuming the radio's
 *  current path-hash mode. 0xFF (OUT_PATH_UNKNOWN) → undefined (no path). The
 *  top bit-pair only encodes hashSize 1/2/3 (firmware never emits 0b11 → 4), so
 *  a 4 means a malformed byte — return undefined rather than leak an invalid
 *  PathHashSize into the hop-splitting logic. */
export function hashSizeFromOutPathLen(outPathLen: number): PathHashSize | undefined {
  if (outPathLen === 0xff) return undefined;
  const size = (outPathLen >> 6) + 1;
  return isPathHashSize(size) ? size : undefined;
}

/** The one rendering of a contact's hop state, shared by every surface so the
 *  table, the list rows, the contact rail and the repeater login label can't
 *  drift apart again (#45 item 8 — they were showing "—", "Flood" and "Direct"
 *  for the same three states).
 *
 *  All three states stay VISIBLE and distinguishable:
 *    undefined → the radio has no learned route (out_path_len 0xFF) and will
 *                flood. That is a real, meaningful state, not missing data —
 *                never render it as a blank cell.
 *    0         → a known direct route. Zero is a value, not an absence.
 *    N         → N relay hops.
 *
 *  The single `direct` override exists for one surface with its own established
 *  vocabulary, not as a general escape hatch: the repeater login button mirrors
 *  meshcore_py's `effective`, where a known 0-hop route reads "Direct". There is
 *  deliberately no override for the unknown case — "Flood" is the whole point of
 *  having one formatter, and a second wording for it would re-open exactly the
 *  drift this replaced. */
export function formatHops(hops: number | undefined, opts?: { direct?: string }): string {
  if (hops == null) return 'Flood';
  if (hops === 0) return opts?.direct ?? '0 hops';
  return `${hops} hop${hops === 1 ? '' : 's'}`;
}

/** Render an OBSERVED (inbound) hop count — what the radio counted on the last
 *  advert it heard from a node.
 *
 *  This is not a fourth wording for the state formatHops already owns, and it
 *  must not become one: the hop COUNT itself is still formatted by formatHops,
 *  so 0 stays "0 hops" and N stays "N hops" on every surface. Only the absent
 *  case differs, because it is a genuinely different absence:
 *
 *    formatHops(undefined)         → "Flood"        no stored OUTBOUND route, so
 *                                                   a send is flooded. A fact
 *                                                   about routing.
 *    formatObservedHops(undefined) → "not measured" nobody has asked the radio,
 *                                                   its 16-slot advert-path
 *                                                   ring no longer holds this
 *                                                   node, or it holds it with
 *                                                   no path cached (path_len
 *                                                   0xFF). A fact about us.
 *
 *  Printing "Flood" here would claim we know something about the inbound path
 *  that we do not, and blanking it would re-open the missing-vs-zero confusion
 *  item 8 closed. */
export function formatObservedHops(hops: number | undefined): string {
  return hops == null ? 'not measured' : formatHops(hops);
}

/** The single hop count a DIRECTION-LESS surface should show — the Contact
 *  Manager's "Hops" column in both layouts, and the sort behind it.
 *
 *  The measured INBOUND value wins when there is one. The column exists to
 *  answer "how far away is this node", and out_path_len — the only thing it
 *  ever showed — is 0xFF ("Flood") for the overwhelming majority of a real
 *  pool, so for those rows a measurement is the only number that exists at all
 *  (#45 item 7). The rail still shows both, labelled, because that surface has
 *  the room to; this one has a single cell and has to choose.
 *
 *  `??`, not `||`: 0 is a real measurement on both sides. */
export function cellHops(c: { hops?: number; observedHops?: number }): number | undefined {
  return c.observedHops ?? c.hops;
}

/** Render that cell. The inbound value carries an explicit "in" marker, because
 *  a bare number in a column that is sometimes outbound and sometimes inbound
 *  would be exactly the silent direction-swap this item was raised about. The
 *  outbound fallback is left unmarked and unchanged — "Flood" is already a
 *  statement about sending. `hopsCellTitle` spells both out on hover. */
export function formatHopsCell(c: { hops?: number; observedHops?: number }): string {
  return c.observedHops == null ? formatHops(c.hops) : `${formatHops(c.observedHops)} in`;
}

/** Hover text for that cell: both directions, always, whichever one is showing. */
export function hopsCellTitle(c: { hops?: number; observedHops?: number }): string {
  return `Heard (inbound): ${formatObservedHops(c.observedHops)} · Path (outbound): ${formatHops(c.hops)}`;
}

/** The one rendering of "when did we last receive anything from this node",
 *  shared for the same reason formatHops is: the Contact Manager's table said
 *  "—", its list layout said "never" and the contact rail said "not heard yet",
 *  for one identical state — and the table/list pair sits behind a layout toggle,
 *  so the word changed under the user on the same row (#45 item 8).
 *
 *  Takes the relative formatter rather than importing one: `fmtRelative` is
 *  renderer-side (Intl.RelativeTimeFormat plus the app's thresholds) and this
 *  module is shared with the main process. */
export function formatLastHeard(lastHeardMs: number | undefined, relative: (ms: number) => string): string {
  return lastHeardMs == null ? 'never' : relative(lastHeardMs);
}

/** Map a MeshCore ADV_TYPE byte (1 chat, 2 repeater, 3 room, 4 sensor) to the
 *  app's ContactKind. Shared by the protocol contacts feature and the
 *  discovered-contact store so the mapping lives in exactly one place. */
export function advTypeToKind(type: number): ContactKind {
  switch (type) {
    case 2:
      return 'repeater';
    case 3:
      return 'room';
    case 4:
      return 'sensor';
    default:
      return 'chat';
  }
}

/** Evaluate a contact's pubkey/name against the enabled block rules. Mirrors
 *  the message matcher's rule semantics (see shared/blocking/match.ts) but for
 *  a contact identity rather than a message. */
export function contactMatchesAnyBlockRule(publicKeyHex: string, name: string, rules: BlockRule[]): boolean {
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
