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
      paths: [
        {
          id: 'p1',
          hashMode: 1,
          finalSnr: 6,
          hops: [
            { kind: 'origin', shortId: 'aa', name: 'Alice', pk: 'alicepk' },
            { kind: 'sink', shortId: 'bb', name: 'Me', pk: 'aabbccdd' },
          ],
        },
      ],
    },
  };

  it('maps message signal, sender, and peer-from-sender on a channel', () => {
    const ctx = buildReplyContext({ self, message, senderContact: alice, channelName: 'General', now: 1700000300000 });
    expect(ctx.message_body).toBe('hi');
    expect(ctx.rssi).toBe(-95);
    expect(ctx.times_heard).toBe(3);
    expect(ctx.sender_name).toBe('Alice');
    expect(ctx.sender_id).toBe('alicepk');
    expect(ctx.peer_name).toBe('Alice'); // peer resolved from the sender, even on a channel
    expect(ctx.received_ago).toBe('5m');
    expect(ctx.paths).toHaveLength(1);
    expect(ctx.paths[0].final_snr).toBe(6);
    expect(ctx.paths[0].hops.map((h) => h.name)).toEqual(['Alice', 'Me']);
  });
});
