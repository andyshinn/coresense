import type { ConversationHit } from '../../../shared/types';

/** Split combined conversation hits into channel and contact buckets,
 *  preserving the server's (relevance-sorted) order within each bucket. */
export function partitionConversations(conversations: ConversationHit[]): {
  channels: ConversationHit[];
  contacts: ConversationHit[];
} {
  const channels: ConversationHit[] = [];
  const contacts: ConversationHit[] = [];
  for (const hit of conversations) {
    if (hit.kind === 'channel') channels.push(hit);
    else contacts.push(hit);
  }
  return { channels, contacts };
}
