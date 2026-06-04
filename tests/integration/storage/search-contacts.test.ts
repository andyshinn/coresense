import { describe, expect, it } from 'vitest';
import { rebuildConversationsIndex, searchMessages } from '../../../src/main/storage/search';
import type { Channel, Contact } from '../../../src/shared/types';

const CTX = { contacts: [], blockRules: [], regexCache: new Map() };

// Build a 64-hex-char pubkey with a controlled prefix and suffix.
const pk = (prefix: string, suffix: string): string =>
  prefix + '0'.repeat(64 - prefix.length - suffix.length) + suffix;

const channel = (over: Partial<Channel> = {}): Channel => ({
  key: 'ch:General',
  name: 'General',
  kind: 'hashtag',
  ...over,
});

const contact = (over: Partial<Contact> = {}): Contact => ({
  key: 'c:default',
  publicKeyHex: pk('a1ce', 'face'),
  name: 'Alice',
  kind: 'chat',
  ...over,
});

const REPEATER = contact({
  key: 'c:repeater',
  publicKeyHex: pk('77aa01', 'ccdd99'),
  name: 'North Ridge',
  kind: 'repeater',
});

describe('search — contacts by kind', () => {
  it('returns the contact kind on a name hit', () => {
    rebuildConversationsIndex({ channels: [], contacts: [REPEATER] });
    const res = searchMessages({ query: 'North', sort: 'relevance' }, CTX);
    const hit = res.conversations.find((c) => c.name === 'North Ridge');
    expect(hit?.kind).toBe('contact');
    expect(hit?.contactKind).toBe('repeater');
  });

  it('carries the kind for all four contact kinds', () => {
    rebuildConversationsIndex({
      channels: [],
      contacts: [
        contact({
          key: 'c:chat',
          name: 'ChatPerson',
          kind: 'chat',
          publicKeyHex: pk('c4a7', '0001'),
        }),
        contact({
          key: 'c:rep',
          name: 'RepeaterNode',
          kind: 'repeater',
          publicKeyHex: pk('4ce9', '0002'),
        }),
        contact({
          key: 'c:room',
          name: 'RoomServer',
          kind: 'room',
          publicKeyHex: pk('40b0', '0003'),
        }),
        contact({
          key: 'c:sen',
          name: 'SensorNode',
          kind: 'sensor',
          publicKeyHex: pk('5e50', '0004'),
        }),
      ],
    });
    const kindOf = (name: string) =>
      searchMessages({ query: name, sort: 'relevance' }, CTX).conversations.find(
        (c) => c.name === name,
      )?.contactKind;
    expect(kindOf('ChatPerson')).toBe('chat');
    expect(kindOf('RepeaterNode')).toBe('repeater');
    expect(kindOf('RoomServer')).toBe('room');
    expect(kindOf('SensorNode')).toBe('sensor');
  });

  it('surfaces all contacts of a kind when the kind keyword is searched', () => {
    rebuildConversationsIndex({
      channels: [],
      contacts: [
        contact({
          key: 'c:r1',
          name: 'North Ridge',
          kind: 'repeater',
          publicKeyHex: pk('77aa', '0011'),
        }),
        contact({
          key: 'c:r2',
          name: 'South Peak',
          kind: 'repeater',
          publicKeyHex: pk('88bb', '0022'),
        }),
        contact({ key: 'c:chat', name: 'Alice', kind: 'chat', publicKeyHex: pk('a1ce', '0033') }),
      ],
    });
    const names = searchMessages({ query: 'repeater', sort: 'relevance' }, CTX).conversations.map(
      (c) => c.name,
    );
    expect(names).toContain('North Ridge');
    expect(names).toContain('South Peak');
    expect(names).not.toContain('Alice');
  });

  it('still matches a contact by pubkey prefix and suffix, with kind attached', () => {
    rebuildConversationsIndex({ channels: [], contacts: [REPEATER] });
    const byPrefix = searchMessages({ query: '77aa01', sort: 'relevance' }, CTX).conversations.find(
      (c) => c.name === 'North Ridge',
    );
    expect(byPrefix?.contactKind).toBe('repeater');
    const bySuffix = searchMessages({ query: 'ccdd99', sort: 'relevance' }, CTX).conversations.find(
      (c) => c.name === 'North Ridge',
    );
    expect(bySuffix?.contactKind).toBe('repeater');
  });

  it('returns channels with no contactKind', () => {
    rebuildConversationsIndex({ channels: [channel()], contacts: [] });
    const hit = searchMessages({ query: 'General', sort: 'relevance' }, CTX).conversations.find(
      (c) => c.name === 'General',
    );
    expect(hit?.kind).toBe('channel');
    expect(hit?.contactKind).toBeUndefined();
  });

  it('does not surface channels when a kind keyword is searched', () => {
    // The 'General' channel stores '' for contact_kind, so a 'repeater'
    // keyword search must never pull it in (only the repeater contact).
    rebuildConversationsIndex({ channels: [channel()], contacts: [REPEATER] });
    const channelHits = searchMessages(
      { query: 'repeater', sort: 'relevance' },
      CTX,
    ).conversations.filter((c) => c.kind === 'channel');
    expect(channelHits).toEqual([]);
  });
});
