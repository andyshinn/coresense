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
  /** Last time WE genuinely received ANYTHING from this node (our clock), ms.
   *  Advert, DM, ack, path learn, repeater status/telemetry or CLI reply — any
   *  identity-bearing reception. Never a GET_CONTACTS resync (the device just
   *  listing what it stores) and never our own outbound traffic, so committing
   *  a contact to the radio can't bump it. Undefined until first reception.
   *
   *  Widened from "last live advert" in #45: a node we DM daily was showing
   *  "never" because only PUSH_NEW_ADVERT wrote here, and every Last-heard
   *  filter (hour/day/week) drops rows with no value at all. */
  lastHeardMs?: number;
  /** Hops the radio counted on the last advert it actually HEARD from this node
   *  (CMD_GET_ADVERT_PATH → RESP_ADVERT_PATH). This is an INBOUND measurement
   *  and is deliberately a field of its own: `hops` above is derived from
   *  out_path_len, the LEARNED OUTBOUND route we would use to SEND. A mesh is
   *  routinely asymmetric, so the two legitimately differ and neither may
   *  overwrite the other (#45 item 7).
   *
   *  0 is a real measurement — "the advert arrived direct" — not an absence.
   *  Undefined means nobody has measured it yet, which is NOT the same state as
   *  `hops === undefined` ("no stored route → flood"); see formatObservedHops.
   *
   *  The firmware's backing store is a 16-entry RAM ring keyed on a 7-BYTE
   *  pubkey PREFIX (companion_radio `AdvertPath.pubkey_prefix[7]`, compared with
   *  memcmp) and evicted oldest-first, so this is a sample of one recent advert
   *  rather than a durable property of the node — and, being a prefix match, not
   *  full-key fidelity. */
  observedHops?: number;
  /** The path bytes that advert arrived over, hex. Empty for a 0-hop (direct)
   *  reception, which is why `observedHops` — never this — is the presence test. */
  observedPathHex?: string;
  /** When the RADIO received that advert, ms. Its RTC, not our clock and not the
   *  advertising node's clock (see lastHeardMs / lastAdvertMs respectively). A
   *  radio with an unset RTC reports something near the epoch, so treat it as a
   *  hint rather than an authority. */
  observedAtMs?: number;
  /** First time WE heard this pubkey (our clock), ms. Tracked app-side. */
  firstHeardMs: number;
  onRadio: boolean;
  favourite: boolean;
  blocked: boolean;
}

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
  return size === 1 || size === 2 || size === 3 ? (size as PathHashSize) : undefined;
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
 *                                                   or its 16-slot advert-path
 *                                                   ring no longer holds this
 *                                                   node. A fact about us.
 *
 *  Printing "Flood" here would claim we know something about the inbound path
 *  that we do not, and blanking it would re-open the missing-vs-zero confusion
 *  item 8 closed. */
export function formatObservedHops(hops: number | undefined): string {
  return hops == null ? 'not measured' : formatHops(hops);
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
