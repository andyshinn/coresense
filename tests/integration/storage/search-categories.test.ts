import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import { rebuildConversationsIndex, searchMessages } from '../../../src/main/storage/search';
import type { Channel, Contact, Message, SearchCategory } from '../../../src/shared/types';

const CTX = { contacts: [], blockRules: [], regexCache: new Map() };
const pk = (prefix: string, suffix: string): string => prefix + '0'.repeat(64 - prefix.length - suffix.length) + suffix;

const ALICE_PK = pk('a1ce', 'face');
const REPEATER_PK = pk('77aa', '0001');

// Seed: channel "Alpha", chat contact "AlphaBot" (with a DM), repeater
// "Alpha Relay". The query "alpha" matches all three conversation names plus a
// channel message body and a DM message body.
function seed(): void {
  rebuildConversationsIndex({
    channels: [{ key: 'ch:Alpha', name: 'Alpha', kind: 'hashtag' } as Channel],
    contacts: [
      { key: `c:${ALICE_PK}`, publicKeyHex: ALICE_PK, name: 'AlphaBot', kind: 'chat' } as Contact,
      {
        key: `c:${REPEATER_PK}`,
        publicKeyHex: REPEATER_PK,
        name: 'Alpha Relay',
        kind: 'repeater',
      } as Contact,
    ],
  });
  messagesStore.insert({
    id: 'chan1',
    key: 'ch:Alpha',
    body: 'alpha signal',
    ts: 1_700_000_000_000,
    state: 'received',
  } as Message);
  messagesStore.insert({
    id: 'dm1',
    key: `c:${ALICE_PK}`,
    fromPublicKeyHex: ALICE_PK,
    body: 'alpha ping',
    ts: 1_700_000_000_001,
    state: 'received',
  } as Message);
}

const run = (categories?: SearchCategory[]) => searchMessages({ query: 'alpha', sort: 'relevance', categories }, CTX);

describe('search — category filters', () => {
  it('contact only → contact conversation hits, no channel hits, no messages', () => {
    seed();
    const r = run(['contact']);
    expect(r.conversations.every((c) => c.kind === 'contact')).toBe(true);
    expect(r.conversations.map((c) => c.name).sort()).toEqual(['Alpha Relay', 'AlphaBot']);
    expect(r.messages).toEqual([]);
    expect(r.total.messages).toBe(0);
  });

  it('channel only → channel conversation hit + channel messages, no contacts, no DMs', () => {
    seed();
    const r = run(['channel']);
    expect(r.conversations.map((c) => c.name)).toEqual(['Alpha']);
    expect(r.conversations.every((c) => c.kind === 'channel')).toBe(true);
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages.every((m) => m.key.startsWith('ch:'))).toBe(true);
  });

  it('dm only → DM messages, no conversation sections', () => {
    seed();
    const r = run(['dm']);
    expect(r.conversations).toEqual([]);
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages.every((m) => m.key.startsWith('c:'))).toBe(true);
  });

  it('dm only → name-matched contact still sender-expands their DMs (Contacts section hidden)', () => {
    seed();
    // A DM whose body does NOT contain 'alpha'; it can only surface via sender
    // expansion (its sender AlphaBot matched the query by name). Confirms the
    // expansion stays active even though 'contact' is not in the categories.
    messagesStore.insert({
      id: 'dm2',
      key: `c:${ALICE_PK}`,
      fromPublicKeyHex: ALICE_PK,
      body: 'hello world',
      ts: 1_700_000_001_000,
      state: 'received',
    } as Message);
    const r = run(['dm']);
    expect(r.conversations).toEqual([]);
    expect(r.messages.some((m) => m.body === 'hello world')).toBe(true);
  });

  it('channel + dm → channel hit + both message kinds, no contact hits', () => {
    seed();
    const r = run(['channel', 'dm']);
    expect(r.conversations.every((c) => c.kind === 'channel')).toBe(true);
    expect(r.messages.some((m) => m.key.startsWith('ch:'))).toBe(true);
    expect(r.messages.some((m) => m.key.startsWith('c:'))).toBe(true);
  });

  it('omitted categories → all three (channels, contacts, messages)', () => {
    seed();
    const r = run(undefined);
    expect(r.conversations.some((c) => c.kind === 'channel')).toBe(true);
    expect(r.conversations.some((c) => c.kind === 'contact')).toBe(true);
    expect(r.messages.some((m) => m.key.startsWith('ch:'))).toBe(true);
    expect(r.messages.some((m) => m.key.startsWith('c:'))).toBe(true);
  });
});
