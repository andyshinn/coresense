// Conversation keys address every chat in the app: `ch:<name>` for a channel
// and `c:<publicKeyHex>` for a contact (DM). Build and parse them here rather
// than with hand-rolled prefix checks. 'ch:x'.startsWith('c:') is false, so the
// two predicates are independent of the order they are tested in.

const CHANNEL_PREFIX = 'ch:';
const CONTACT_PREFIX = 'c:';

export type ChannelKey = `ch:${string}`;
export type ContactKey = `c:${string}`;

/** The conversation key for a channel name. */
export function channelKey(name: string): ChannelKey {
  return `${CHANNEL_PREFIX}${name}`;
}

/** The conversation key for a contact's public key. */
export function contactKey(publicKeyHex: string): ContactKey {
  return `${CONTACT_PREFIX}${publicKeyHex}`;
}

/** True iff `key` addresses a channel (`ch:<name>`). */
export function isChannelKey(key: string): key is ChannelKey {
  return key.startsWith(CHANNEL_PREFIX);
}

/** True iff `key` addresses a contact / DM (`c:<publicKeyHex>`). */
export function isContactKey(key: string): key is ContactKey {
  return key.startsWith(CONTACT_PREFIX);
}

/** The public key inside a contact key. Anything without the `c:` prefix (a
 *  bare pubkey a route accepted as-is) is returned unchanged. */
export function pubkeyFromKey(key: string): string {
  return isContactKey(key) ? key.slice(CONTACT_PREFIX.length) : key;
}

/** The channel name inside a channel key. Anything without the `ch:` prefix is
 *  returned unchanged. */
export function channelNameFromKey(key: string): string {
  return isChannelKey(key) ? key.slice(CHANNEL_PREFIX.length) : key;
}

/** Which kind of conversation a key addresses; null for non-conversation keys
 *  (e.g. `tool:*` routes). */
export function conversationKind(key: string): 'channel' | 'dm' | null {
  if (isChannelKey(key)) return 'channel';
  if (isContactKey(key)) return 'dm';
  return null;
}
