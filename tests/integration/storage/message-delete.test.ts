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

const searchOpts = { contacts: [], blockRules: [], regexCache: new Map() };

describe('messagesStore.remove', () => {
  it('deletes the row by mid', () => {
    messagesStore.insert(msg());
    expect(messagesStore.remove(['m1'])).toBe(1);
    expect(messagesStore.findById('m1')).toBeNull();
  });

  it('drops the row from the FTS index', () => {
    messagesStore.insert(msg({ body: 'unmistakable phrase' }));
    expect(searchMessages({ query: 'unmistakable', sort: 'relevance' }, searchOpts).messages).toHaveLength(1);
    messagesStore.remove(['m1']);
    expect(searchMessages({ query: 'unmistakable', sort: 'relevance' }, searchOpts).messages).toHaveLength(0);
  });

  it('writes a tombstone so the id is recorded as deleted', () => {
    messagesStore.insert(msg());
    expect(messagesStore.isDeleted('m1')).toBe(false);
    messagesStore.remove(['m1']);
    expect(messagesStore.isDeleted('m1')).toBe(true);
  });

  it('returns 0 and writes no tombstone for an unknown mid', () => {
    expect(messagesStore.remove(['nope'])).toBe(0);
    expect(messagesStore.isDeleted('nope')).toBe(false);
  });

  it('returns 0 for an empty id list', () => {
    expect(messagesStore.remove([])).toBe(0);
  });

  it('deletes several ids at once and leaves others alone', () => {
    messagesStore.insert(msg({ id: 'a' }));
    messagesStore.insert(msg({ id: 'b' }));
    messagesStore.insert(msg({ id: 'c' }));
    expect(messagesStore.remove(['a', 'c'])).toBe(2);
    expect(messagesStore.findById('a')).toBeNull();
    expect(messagesStore.findById('b')).not.toBeNull();
    expect(messagesStore.findById('c')).toBeNull();
  });

  it('counts only the ids that existed', () => {
    messagesStore.insert(msg({ id: 'a' }));
    expect(messagesStore.remove(['a', 'ghost'])).toBe(1);
    expect(messagesStore.isDeleted('ghost')).toBe(false);
  });
});
