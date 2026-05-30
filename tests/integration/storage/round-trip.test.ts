import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import { searchMessages } from '../../../src/main/storage/search';
import type { Message } from '../../../src/shared/types';

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  key: 'ch:General',
  ts: 1_700_000_000_000,
  body: 'hello world',
  state: 'received',
  ...over,
});

describe('messagesStore round-trip', () => {
  it('inserts and reads back by key', () => {
    messagesStore.insert(msg());
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'm1', body: 'hello world', state: 'received' });
  });

  it('upserts idempotently on mid', () => {
    messagesStore.insert(msg({ body: 'first' }));
    messagesStore.insert(msg({ body: 'second' }));
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe('second');
  });

  it('updates state via markState', () => {
    messagesStore.insert(msg({ id: 'm2', key: 'c:aabb', body: 'dm', state: 'sending' }));
    messagesStore.markState('m2', 'ack');
    expect(messagesStore.findById('m2')?.state).toBe('ack');
  });

  it('bounds history with trimPerKey', () => {
    for (let i = 0; i < 5; i++) {
      messagesStore.insert(msg({ id: `k${i}`, ts: 1_700_000_000_000 + i, body: `b${i}` }));
    }
    messagesStore.trimPerKey('ch:General', 2);
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.body)).toEqual(['b3', 'b4']);
  });

  it('finds messages via FTS search', () => {
    messagesStore.insert(msg({ id: 's1', body: 'the quick brown fox' }));
    // searchMessages takes a SearchOptions object; sort is required.
    // MessageHit.id maps from the DB mid column, which equals Message.id.
    const results = searchMessages({ query: 'quick', sort: 'relevance' });
    expect(results.messages.some((r) => r.id === 's1')).toBe(true);
  });
});
