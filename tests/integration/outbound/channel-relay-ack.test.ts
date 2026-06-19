import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { stateHolder } from '../../../src/main/state/holder';
import type { Channel, MessagePath } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

const channel: Channel = {
  key: 'ch:Outbound',
  name: 'Outbound',
  kind: 'public',
  idx: 5,
  secretHex: '00112233445566778899aabbccddeeff',
};

// A 0x88 PUSH_LOG_RX_DATA frame wrapping a GRP_TXT mesh packet relayed by one
// repeater (hashCount=1), tagged with `channelHash` — i.e. our own channel send
// rebroadcast back over the air. This is the only signal that a repeater heard us.
function heardRelayFrame(channelHash: number): Buffer {
  // mesh packet: [header][pathLen][path 1B][channelHash][ciphertext…]
  //   header  0x15 = routeType 1 (flood, no transport codes) | payloadType 5 (GRP_TXT)
  //   pathLen 0x01 = hashCount 1, hashSize 1  →  one repeater hop (0xAA)
  const mesh = Buffer.from([0x15, 0x01, 0xaa, channelHash, 0xde, 0xad, 0xbe, 0xef]);
  // 0x88 companion wrapper: [0x88][snr*4 int8][rssi int8][mesh…]
  return Buffer.concat([Buffer.from([0x88, 0x14, 0xd8]), mesh]);
}

describe('channel send → heard repeater relay (green check)', () => {
  it('attributes a heard 0x88 relay back to the sent message and advances it to heard', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.setChannels([channel]);

    // Mirror the API route: optimistic insert, send, mark sent.
    const holder = stateHolder();
    const id = 'local-test-ch-1';
    holder.insertMessage({ id, key: 'ch:Outbound', body: 'hi there', ts: Date.now(), state: 'sending' });

    const result = await adapter.sendChannelText('ch:Outbound', 'hi there');
    expect(result.ok).toBe(true);
    expect(typeof result.channelHash).toBe('number');
    holder.setMessageState(id, 'sent');

    // The step the meshcore-ts migration dropped: register the send so heard
    // repeater relays get attributed back to this message id.
    adapter.registerChannelSend({ messageId: id, channelHash: result.channelHash as number });

    const heard: Array<{ id: string; path: MessagePath; state: string }> = [];
    bus.on('messagePathHeard', (e) => heard.push(e));

    receive(heardRelayFrame(result.channelHash as number));

    expect(heard).toHaveLength(1);
    expect(heard[0].id).toBe(id);
    expect(heard[0].state).toBe('heard');

    const msg = holder.getMessagesForKey('ch:Outbound').find((m) => m.id === id);
    expect(msg?.state).toBe('heard');
    expect(msg?.meta?.paths).toHaveLength(1);
  });
});
