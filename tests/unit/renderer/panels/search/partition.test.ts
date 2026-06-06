import { describe, expect, it } from 'vitest';
import { partitionConversations } from '@/panels/search/partition';
import type { ConversationHit } from '../../../../../src/shared/types';

const hit = (over: Partial<ConversationHit>): ConversationHit => ({
  key: 'x',
  kind: 'contact',
  name: 'n',
  score: 0,
  messageMatches: 0,
  ...over,
});

describe('partitionConversations', () => {
  it('splits channels and contacts, preserving order within each bucket', () => {
    const input = [
      hit({ key: 'ch:1', kind: 'channel', name: 'general' }),
      hit({ key: 'c:1', kind: 'contact', name: 'alice', contactKind: 'chat' }),
      hit({ key: 'ch:2', kind: 'channel', name: 'public' }),
      hit({ key: 'c:2', kind: 'contact', name: 'rptr', contactKind: 'repeater' }),
    ];
    const { channels, contacts } = partitionConversations(input);
    expect(channels.map((c) => c.key)).toEqual(['ch:1', 'ch:2']);
    expect(contacts.map((c) => c.key)).toEqual(['c:1', 'c:2']);
  });

  it('returns empty buckets for empty input', () => {
    const { channels, contacts } = partitionConversations([]);
    expect(channels).toEqual([]);
    expect(contacts).toEqual([]);
  });
});
