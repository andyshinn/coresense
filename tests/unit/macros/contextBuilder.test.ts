// tests/unit/macros/contextBuilder.test.ts
import { describe, expect, it } from 'vitest';
import { buildReplyContext, buildSendContext } from '../../../src/main/macros/contextBuilder';
import type { Contact, DeviceIdentity, DeviceInfo, Message, Owner } from '../../../src/shared/types';

const owner: Owner = { name: 'N0CALL', publicKeyHex: 'aabbccdd', publicKeyShort: 'aabbccdd' };
const deviceInfo = { batteryMv: 4100 } as DeviceInfo;
const deviceIdentity = { lat: 37.7749, lon: -122.4194 } as DeviceIdentity;
const self = { owner, deviceInfo, deviceIdentity };

const alice: Contact = {
  key: 'c:alice',
  publicKeyHex: 'alicepk',
  name: 'Alice',
  kind: 'chat',
  lastSeenMs: 1700000000000,
  rssi: -80,
  snr: 7,
  hops: 1,
  gpsLat: 37.8,
  gpsLon: -122.27,
};

describe('buildSendContext', () => {
  it('maps self + peer for a DM and leaves reply fields empty', () => {
    const ctx = buildSendContext({ self, peerContact: alice, channelName: null });
    expect(ctx.my_callsign).toBe('N0CALL');
    expect(ctx.my_pos).toEqual({ lat: 37.7749, lon: -122.4194 });
    expect(ctx.my_battery_v).toBeCloseTo(4.1, 3);
    expect(ctx.peer_name).toBe('Alice');
    expect(ctx.peer_pos).toEqual({ lat: 37.8, lon: -122.27 });
    expect(ctx.message_body).toBeNull();
    expect(ctx.paths).toEqual([]);
  });

  it('nulls peer for a channel broadcast', () => {
    const ctx = buildSendContext({ self, peerContact: null, channelName: 'General' });
    expect(ctx.channel).toBe('General');
    expect(ctx.peer_name).toBeNull();
    expect(ctx.peer_pos).toBeNull();
  });

  it('nulls my_pos when device position is absent', () => {
    const ctx = buildSendContext({
      self: { owner, deviceInfo, deviceIdentity: { lat: null, lon: null } as DeviceIdentity },
      peerContact: null,
      channelName: null,
    });
    expect(ctx.my_pos).toBeNull();
  });
});

describe('buildReplyContext', () => {
  const pathHops = [
    { kind: 'origin' as const, shortId: 'aa', name: 'Alice', pk: 'alicepk' },
    { kind: 'hop' as const, shortId: 'a1', name: null, pk: null },
    { kind: 'hop' as const, shortId: '37', name: null, pk: null },
    { kind: 'sink' as const, shortId: 'bb', name: 'Me', pk: 'aabbccdd' },
  ];

  const message: Message = {
    id: 'm1',
    key: 'ch:General',
    fromPublicKeyHex: 'alicepk',
    body: 'hi',
    ts: 1700000000000,
    state: 'received',
    meta: {
      rssi: -95,
      snr: 5.5,
      hops: 2,
      timesHeard: 3,
      paths: [{ id: 'p1', hashMode: 1, finalSnr: 6, hops: pathHops }],
    },
  };

  const directMessage: Message = {
    ...message,
    meta: {
      ...message.meta,
      paths: [{ id: 'p2', hashMode: 1, finalSnr: 6, hops: [pathHops[0], pathHops[3]] }],
    },
  };

  const repeater = (name: string, publicKeyHex: string): Contact => ({
    key: `c:${publicKeyHex}`,
    publicKeyHex,
    name,
    kind: 'repeater',
  });

  const reply = (over: { message?: Message; repeaters?: Contact[] } = {}) =>
    buildReplyContext({
      self,
      message: over.message ?? message,
      senderContact: alice,
      channelName: 'General',
      repeaters: over.repeaters ?? [],
      now: 1700000300000,
    });

  it('maps message signal, sender, and peer-from-sender on a channel', () => {
    const ctx = reply();
    expect(ctx.message_body).toBe('hi');
    expect(ctx.rssi).toBe(-95);
    expect(ctx.times_heard).toBe(3);
    expect(ctx.sender_name).toBe('Alice');
    expect(ctx.sender_id).toBe('alicepk');
    expect(ctx.peer_name).toBe('Alice'); // peer resolved from the sender, even on a channel
    expect(ctx.received_ago).toBe('5m');
    expect(ctx.paths).toHaveLength(1);
    expect(ctx.paths[0].final_snr).toBe(6);
  });

  it('exposes only relay hops in hops, and the full timeline in all_hops', () => {
    const ctx = reply();
    expect(ctx.paths[0].hops.map((h) => h.short_id)).toEqual(['a1', '37']);
    expect(ctx.paths[0].hops.every((h) => h.kind === 'hop')).toBe(true);
    expect(ctx.paths[0].all_hops.map((h) => h.short_id)).toEqual(['aa', 'a1', '37', 'bb']);
    expect(ctx.paths[0].all_hops.map((h) => h.name)).toEqual(['Alice', null, null, 'Me']);
  });

  it('reports length as the relay count, not the timeline length', () => {
    expect(reply().paths[0].length).toBe(2);
  });

  it('reports length 0 and empty hops for a direct path', () => {
    const ctx = reply({ message: directMessage });
    expect(ctx.paths[0].length).toBe(0);
    expect(ctx.paths[0].hops).toEqual([]);
    expect(ctx.paths[0].all_hops).toHaveLength(2);
  });

  it('resolves a relay hop name and pk from an unambiguous repeater match', () => {
    const ctx = reply({ repeaters: [repeater('Tarrytown East Solar', 'a137f2aa')] });
    expect(ctx.paths[0].hops[0]).toMatchObject({
      short_id: 'a1',
      name: 'Tarrytown East Solar',
      pk: 'a137f2aa',
    });
    expect(ctx.paths[0].hops[1]).toMatchObject({ short_id: '37', name: null, pk: null });
  });

  it('leaves name and pk null when two repeaters share the prefix', () => {
    const ctx = reply({ repeaters: [repeater('One', 'a137f2aa'), repeater('Two', 'a1ff0000')] });
    expect(ctx.paths[0].hops[0]).toMatchObject({ name: null, pk: null });
  });

  it('ignores a non-repeater contact whose pubkey matches the prefix', () => {
    // A phone must never be named as a mesh relay. resolveHop guards on kind
    // itself, so this holds even if a caller forgets to pre-filter.
    const phone: Contact = { key: 'c:a1cafe', publicKeyHex: 'a1cafe22', name: 'Bob (phone)', kind: 'chat' };
    expect(reply({ repeaters: [phone] }).paths[0].hops[0]).toMatchObject({ name: null, pk: null });
  });

  it('does not let a non-repeater manufacture ambiguity', () => {
    // The Path viewer resolves against repeaters only; a chat contact sharing
    // the prefix must not blank out a name the viewer shows confidently.
    const phone: Contact = { key: 'c:a1cafe', publicKeyHex: 'a1cafe22', name: 'Bob (phone)', kind: 'chat' };
    const ctx = reply({ repeaters: [repeater('Tarrytown East Solar', 'a137f2aa'), phone] });
    expect(ctx.paths[0].hops[0].name).toBe('Tarrytown East Solar');
  });

  it('leaves name and pk null for an empty short_id', () => {
    const blank: Message = {
      ...message,
      meta: {
        ...message.meta,
        paths: [{ id: 'p3', hashMode: 1, finalSnr: 6, hops: [{ kind: 'hop', shortId: '', name: null, pk: null }] }],
      },
    };
    const ctx = reply({ message: blank, repeaters: [repeater('Only', 'deadbeef')] });
    expect(ctx.paths[0].hops[0]).toMatchObject({ name: null, pk: null });
  });

  it('origin and sink never carry a resolved pk', () => {
    const ctx = reply({ repeaters: [repeater('Tarrytown', 'a137f2aa')] });
    const ends = ctx.paths[0].all_hops.filter((h) => h.kind !== 'hop');
    expect(ends.map((h) => h.pk)).toEqual([null, null]);
  });
});
