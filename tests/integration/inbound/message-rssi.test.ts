import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { buildReplyContext } from '../../../src/main/macros/contextBuilder';
import { renderMacro } from '../../../src/main/macros/service';
import { messagesStore } from '../../../src/main/storage/messages';
import type { DeviceIdentity, DeviceInfo, Owner } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

// The V3 message frames carry a signal header the V1 frames do not:
//   [code][snr*4 i8][rssi i8][rsv][payload…]
// Byte 2 is the one under test. Every frame below is built byte-for-byte the
// way the firmware emits it and injected over the loopback transport, so the
// value asserted at the far end came off a decoded wire frame — NOT from a
// hand-built Message with meta.rssi pre-set, and NOT from buildSampleContext(),
// which hardcodes rssi: -95 and would look identical whether or not the real
// path works. That fixture-vs-wire gap is exactly how the `{{ hops }}` bug in
// #32 survived its own tests.

// RESP_CHANNEL_MSG_RECV_V3 (0x11): [0x11][snr*4 i8][rssi i8][rsv][idx][path_len]
// [txt_type][ts u32 LE][body]. path_len 0xFF = direct (no mesh observation).
function channelMsgV3(idx: number, ts: number, body: string, snrQ: number, rssi: number): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(11 + text.length);
  frame[0] = 0x11;
  frame.writeInt8(snrQ, 1);
  frame.writeInt8(rssi, 2);
  frame[4] = idx;
  frame[5] = 0xff;
  frame[6] = 0; // txt_type = plain
  frame.writeUInt32LE(ts, 7);
  text.copy(frame, 11);
  return frame;
}

// RESP_CHANNEL_MSG_RECV (0x08), the V1 shape: no signal header at all —
// [0x08][idx][path_len][txt_type][ts u32 LE][body].
function channelMsgV1(idx: number, ts: number, body: string): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(8 + text.length);
  frame[0] = 0x08;
  frame[1] = idx;
  frame[2] = 0xff;
  frame[3] = 0;
  frame.writeUInt32LE(ts, 4);
  text.copy(frame, 8);
  return frame;
}

// RESP_CONTACT_MSG_RECV_V3 (0x10): [0x10][snr*4 i8][rssi i8][rsv]
// [sender pubkey prefix 6B][path_len][txt_type][ts u32 LE][body].
function contactMsgV3(prefixHex: string, ts: number, body: string, snrQ: number, rssi: number): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(16 + text.length);
  frame[0] = 0x10;
  frame.writeInt8(snrQ, 1);
  frame.writeInt8(rssi, 2);
  Buffer.from(prefixHex, 'hex').copy(frame, 4);
  frame[10] = 0xff;
  frame[11] = 0; // txt_type = plain
  frame.writeUInt32LE(ts, 12);
  text.copy(frame, 16);
  return frame;
}

function channelSession() {
  const s = makeTestSession();
  s.adapter.session.markChannelPresent({ key: 'ch:General', name: 'General', kind: 'public', idx: 0 });
  return s;
}

const self = {
  owner: { name: 'N0CALL', publicKeyHex: 'aabbccdd', publicKeyShort: 'aabbccdd' } as Owner,
  deviceInfo: { batteryMv: 4100 } as DeviceInfo,
  deviceIdentity: { lat: null, lon: null } as DeviceIdentity,
};

describe('meta.rssi from a decoded wire frame', () => {
  it('carries the V3 channel frame rssi byte through to the stored message', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_000, 'Alice: hi', 48, -73));

    const row = messagesStore.byKey('ch:General')[0];
    expect(row.body).toBe('hi');
    expect(row.meta?.rssi).toBe(-73);
    expect(row.meta?.snr).toBe(12); // snr*4 = 48
  });

  it('carries the V3 DM frame rssi byte through to the stored message', () => {
    const { receive } = makeTestSession();
    const prefix = 'a1b2c3d4e5f6';
    receive(contactMsgV3(prefix, 1_700_000_100, 'dm body', -20, -104));

    const row = messagesStore.byKey(`c:${prefix}`)[0];
    expect(row.body).toBe('dm body');
    expect(row.meta?.rssi).toBe(-104);
    expect(row.meta?.snr).toBe(-5); // snr*4 = -20
  });

  it('reads byte 2 per frame, not a constant — two frames keep their own values', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_200, 'Alice: near', 40, -42));
    receive(channelMsgV3(0, 1_700_000_201, 'Alice: far', 40, -119));

    const byBody = new Map(messagesStore.byKey('ch:General').map((m) => [m.body, m.meta?.rssi]));
    expect(byBody.get('near')).toBe(-42);
    expect(byBody.get('far')).toBe(-119);
  });

  it('omits rssi entirely on a V1 frame, which has no signal header', () => {
    const { receive } = channelSession();
    receive(channelMsgV1(0, 1_700_000_300, 'Alice: legacy'));

    const row = messagesStore.byKey('ch:General')[0];
    expect(row.body).toBe('legacy');
    expect(row.meta?.rssi).toBeUndefined();
  });

  it('renders {{ rssi }} from the wire value instead of the ? placeholder', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_400, 'Alice: ping', 48, -87));

    // Read the message back out of storage (a full JSON meta round-trip), then
    // drive the real reply-context builder and the real macro engine over it.
    const message = messagesStore.byKey('ch:General')[0];
    const ctx = buildReplyContext({ self, message, senderContact: null, channelName: 'General', repeaters: [] });
    expect(ctx.rssi).toBe(-87);

    expect(renderMacro('{{ rssi }}dBm', ctx)).toEqual({ ok: true, text: '-87dBm' });
  });
});
