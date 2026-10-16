// A message's sender is carried in one overloaded field (`fromPublicKeyHex` on
// Message, `fromPublicKeyHex`/`fromPk` on search and stats rows):
//   null / undefined → we sent it (self)
//   'name:<name>'    → a channel post. Channel messages carry no pubkey, so the
//                      protocol layer encodes the poster's display name instead
//                      (see the channel-message decode in @andyshinn/meshcore-ts,
//                      bridged via protocol/adapterEvents.ts)
//   'unknown'        → a sender we could not identify
//   anything else    → the sender's hex public key (or key prefix)
// Decode it here so main and the renderer agree on the encoding.

/** Prefix that marks a name-only (channel) sender. */
export const SENDER_NAME_PREFIX = 'name:';

/** Sentinel for a sender we could not identify. */
export const UNKNOWN_SENDER = 'unknown';

export type ParsedSender =
  | { kind: 'self' }
  | { kind: 'name'; name: string }
  | { kind: 'unknown' }
  | { kind: 'pubkey'; pk: string };

/** Decode a raw sender field. An empty string is treated as unknown. */
export function parseSender(raw: string | null | undefined): ParsedSender {
  if (raw == null) return { kind: 'self' };
  if (raw === '' || raw === UNKNOWN_SENDER) return { kind: 'unknown' };
  if (raw.startsWith(SENDER_NAME_PREFIX)) return { kind: 'name', name: raw.slice(SENDER_NAME_PREFIX.length) };
  return { kind: 'pubkey', pk: raw };
}

/** Short display label for a sender: the bare name for a channel poster, an
 *  8-char pubkey prefix + ellipsis for a keyed sender, and '' when there is no
 *  usable name (self, or an unidentified sender). */
export function senderDisplayName(raw: string | null | undefined): string {
  const s = parseSender(raw);
  if (s.kind === 'name') return s.name;
  if (s.kind === 'pubkey') return `${s.pk.slice(0, 8)}…`;
  return '';
}

/** True iff the raw sender field holds an actual public key (not self, a
 *  channel name or the unknown sentinel). */
export function isRealPubkey(raw: string | null | undefined): boolean {
  return parseSender(raw).kind === 'pubkey';
}
