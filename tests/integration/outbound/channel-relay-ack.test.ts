import { Buffer } from 'node:buffer';
import { createCipheriv, createHmac } from 'node:crypto';
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

// A GRP_TXT payload the library can actually decrypt. Since meshcore-ts 0.6.0
// a relay is attributed by the timestamp sealed inside the ciphertext, and a
// clean decrypt is conclusive in BOTH directions — a payload whose MAC doesn't
// verify is ruled out as "not on this channel" rather than falling through to
// the fingerprint guess. So the fixture has to be genuinely encrypted:
//   payload    = [channel_hash 1B][MAC 2B][ciphertext N*16B]
//   ciphertext = AES-128-ECB(secret, plaintext zero-padded to 16B blocks)
//   MAC        = first 2 bytes of HMAC-SHA256(secret, ciphertext)
//   plaintext  = [timestamp u32 LE][flags 1B][body UTF-8]
function grpTxtPayload(channelHash: number, timestampUnix: number, body: string): Buffer {
  const secret = Buffer.from(channel.secretHex as string, 'hex');
  const head = Buffer.alloc(5);
  head.writeUInt32LE(timestampUnix, 0);
  head[4] = 0; // flags
  const plain = Buffer.concat([head, Buffer.from(body, 'utf8')]);
  // Zero padding to the block size — not PKCS#7, which is Node's default.
  const padded = Buffer.alloc(Math.ceil(plain.length / 16) * 16);
  plain.copy(padded);
  const cipher = createCipheriv('aes-128-ecb', secret, null);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const mac = createHmac('sha256', secret).update(ciphertext).digest().subarray(0, 2);
  return Buffer.concat([Buffer.from([channelHash]), mac, ciphertext]);
}

// A 0x88 PUSH_LOG_RX_DATA frame wrapping a GRP_TXT mesh packet relayed by one
// repeater (hashCount=1) — i.e. our own channel send rebroadcast back over the
// air. This is the only signal that a repeater heard us.
function heardRelayFrame(channelHash: number, timestampUnix: number, body: string): Buffer {
  // mesh packet: [header][pathLen][path 1B][payload…]
  //   header  0x15 = routeType 1 (flood, no transport codes) | payloadType 5 (GRP_TXT)
  //   pathLen 0x01 = hashCount 1, hashSize 1  →  one repeater hop (0xAA)
  const mesh = Buffer.concat([Buffer.from([0x15, 0x01, 0xaa]), grpTxtPayload(channelHash, timestampUnix, body)]);
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

    // Register the send so heard repeater relays get attributed back to this
    // message id. timestampUnix is what makes the attribution authoritative
    // rather than a newest-first guess — mirror what sendMessage.ts passes.
    expect(typeof result.timestampUnix).toBe('number');
    adapter.registerChannelSend({
      messageId: id,
      channelHash: result.channelHash as number,
      timestampUnix: result.timestampUnix,
    });

    const heard: Array<{ id: string; path: MessagePath; state: string }> = [];
    bus.on('messagePathHeard', (e) => heard.push(e));

    receive(heardRelayFrame(result.channelHash as number, result.timestampUnix as number, 'Andy: hi there'));

    expect(heard).toHaveLength(1);
    expect(heard[0].id).toBe(id);
    expect(heard[0].state).toBe('heard');

    const msg = holder.getMessagesForKey('ch:Outbound').find((m) => m.id === id);
    expect(msg?.state).toBe('heard');
    expect(msg?.meta?.paths).toHaveLength(1);
  });

  it('attributes a relay of the OLDER of two in-flight sends to the right message', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.setChannels([channel]);
    const holder = stateHolder();

    // One real send to obtain this channel's hash byte, then two registrations
    // with timestamps a few seconds apart. Registering explicitly (rather than
    // sending twice) is deliberate: timestampUnix has second granularity, so
    // two back-to-back sends in one test would share a timestamp and be
    // genuinely indistinguishable — the library documents newest-first as the
    // fallback for exactly that case.
    const probe = await adapter.sendChannelText('ch:Outbound', 'probe');
    const channelHash = probe.channelHash as number;
    const olderTs = (probe.timestampUnix as number) - 5;
    const newerTs = probe.timestampUnix as number;

    const first = 'local-test-ch-first';
    const second = 'local-test-ch-second';
    holder.insertMessage({ id: first, key: 'ch:Outbound', body: 'first', ts: Date.now(), state: 'sending' });
    holder.insertMessage({ id: second, key: 'ch:Outbound', body: 'second', ts: Date.now(), state: 'sending' });
    adapter.registerChannelSend({ messageId: first, channelHash, timestampUnix: olderTs });
    adapter.registerChannelSend({ messageId: second, channelHash, timestampUnix: newerTs });

    const heard: Array<{ id: string; path: MessagePath; state: string }> = [];
    bus.on('messagePathHeard', (e) => heard.push(e));

    // Relay the OLDER send. Newest-first guessing would credit this to
    // `second`; the sealed timestamp is what makes it land on `first`.
    receive(heardRelayFrame(channelHash, olderTs, 'Andy: first'));

    expect(heard).toHaveLength(1);
    expect(heard[0].id).toBe(first);
  });
});
