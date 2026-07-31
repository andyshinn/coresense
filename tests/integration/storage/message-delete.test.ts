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
    expect(messagesStore.remove('ch:General', ['m1'])).toEqual(['m1']);
    expect(messagesStore.findById('m1')).toBeNull();
  });

  it('drops the row from the FTS index', () => {
    messagesStore.insert(msg({ body: 'unmistakable phrase' }));
    expect(searchMessages({ query: 'unmistakable', sort: 'relevance' }, searchOpts).messages).toHaveLength(1);
    messagesStore.remove('ch:General', ['m1']);
    expect(searchMessages({ query: 'unmistakable', sort: 'relevance' }, searchOpts).messages).toHaveLength(0);
  });

  it('writes a tombstone so the id is recorded as deleted', () => {
    messagesStore.insert(msg());
    expect(messagesStore.isDeleted('m1')).toBe(false);
    messagesStore.remove('ch:General', ['m1']);
    expect(messagesStore.isDeleted('m1')).toBe(true);
  });

  it('returns [] and writes no tombstone for an unknown mid', () => {
    expect(messagesStore.remove('ch:General', ['nope'])).toEqual([]);
    expect(messagesStore.isDeleted('nope')).toBe(false);
  });

  it('returns [] for an empty id list', () => {
    expect(messagesStore.remove('ch:General', [])).toEqual([]);
  });

  it('deletes several ids at once and leaves others alone', () => {
    messagesStore.insert(msg({ id: 'a' }));
    messagesStore.insert(msg({ id: 'b' }));
    messagesStore.insert(msg({ id: 'c' }));
    expect(messagesStore.remove('ch:General', ['a', 'c']).sort()).toEqual(['a', 'c']);
    expect(messagesStore.findById('a')).toBeNull();
    expect(messagesStore.findById('b')).not.toBeNull();
    expect(messagesStore.findById('c')).toBeNull();
  });

  it('returns only the ids that existed', () => {
    messagesStore.insert(msg({ id: 'a' }));
    expect(messagesStore.remove('ch:General', ['a', 'ghost'])).toEqual(['a']);
    expect(messagesStore.isDeleted('ghost')).toBe(false);
  });

  // Ownership scoping lives in the DAO, not the route, so a second caller
  // (bulk delete, clear-conversation) cannot lose the check.
  it('ignores an id that belongs to a different conversation', () => {
    messagesStore.insert(msg({ id: 'm1', key: 'ch:Real' }));
    expect(messagesStore.remove('ch:Wrong', ['m1'])).toEqual([]);
    expect(messagesStore.findById('m1')).not.toBeNull();
    expect(messagesStore.isDeleted('m1')).toBe(false);
  });

  it('removes only the in-key ids from a mixed batch', () => {
    messagesStore.insert(msg({ id: 'mine', key: 'ch:Real' }));
    messagesStore.insert(msg({ id: 'theirs', key: 'ch:Other' }));
    expect(messagesStore.remove('ch:Real', ['mine', 'theirs'])).toEqual(['mine']);
    expect(messagesStore.findById('mine')).toBeNull();
    expect(messagesStore.findById('theirs')).not.toBeNull();
    expect(messagesStore.isDeleted('theirs')).toBe(false);
  });
});
