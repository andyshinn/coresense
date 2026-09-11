import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { buildReplyContext } from '../../../src/main/macros/contextBuilder';
import { renderMacro } from '../../../src/main/macros/service';
import { messagesStore } from '../../../src/main/storage/messages';
import type { DeviceIdentity, DeviceInfo, Owner } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

// The V3 message frames carry a signal header the V1 frames do not:
//   [code][snr*4 i8][reserved1][reserved2][payload…]
// Bytes 2-3 are NOT rssi. Firmware hardcodes both to zero — `out_frame[i++] =
// 0; // reserved1` in companion_radio/MyMesh.cpp, for 0x10, 0x11 and 0x1B alike
// — and companion_protocol.md documents "Bytes 2-3: Reserved". The
// [code][snr*4][rssi][0xFF] header belongs to PUSH_RAW_DATA (0x84), together
// with 0x88 and 0x8e; those are the only frames the radio fills from
// getLastRSSI(), which is why RSSI shows in the Packet Log but never on a
// Message.
//
// meshcore-ts 0.7.1 read byte 2 as rssi, so every received message got
// `meta.rssi = 0` — and since every consumer gates on `!= null` and
// RssiChip.barsFor(0) returns 4, that rendered a full-bar "0 dBm" chip on
// everything. 0.7.2 reverted it.
//
// These tests are the guard. Every frame below sets the reserved bytes to a
// deliberately non-zero, plausible-looking RSSI value: firmware would never
// emit that, so if a decoder starts reading byte 2 again the value surfaces
// here and these tests fail, instead of the bug reaching a radio.

// RESP_CHANNEL_MSG_RECV_V3 (0x11): [0x11][snr*4 i8][rsv][rsv][idx][path_len]
// [txt_type][ts u32 LE][body]. path_len 0xFF = direct (no mesh observation).
function channelMsgV3(idx: number, ts: number, body: string, snrQ: number, reserved = 0): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(11 + text.length);
  frame[0] = 0x11;
  frame.writeInt8(snrQ, 1);
  frame.writeInt8(reserved, 2); // reserved1 — firmware always 0
  frame.writeInt8(reserved, 3); // reserved2 — firmware always 0
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

// RESP_CONTACT_MSG_RECV_V3 (0x10): [0x10][snr*4 i8][rsv][rsv]
// [sender pubkey prefix 6B][path_len][txt_type][ts u32 LE][body].
function contactMsgV3(prefixHex: string, ts: number, body: string, snrQ: number, reserved = 0): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(16 + text.length);
  frame[0] = 0x10;
  frame.writeInt8(snrQ, 1);
  frame.writeInt8(reserved, 2); // reserved1 — firmware always 0
  frame.writeInt8(reserved, 3); // reserved2 — firmware always 0
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

describe('V3 reserved bytes never become meta.rssi', () => {
  it('leaves rssi off a channel message, even when byte 2 looks like an RSSI', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_000, 'Alice: hi', 48, -73));

    const row = messagesStore.byKey('ch:General')[0];
    expect(row.body).toBe('hi');
    expect(row.meta).not.toHaveProperty('rssi');
    expect(row.meta?.snr).toBe(12); // snr*4 = 48, read off byte 1 as always
  });

  it('leaves rssi off a DM, even when byte 2 looks like an RSSI', () => {
    const { receive } = makeTestSession();
    const prefix = 'a1b2c3d4e5f6';
    receive(contactMsgV3(prefix, 1_700_000_100, 'dm body', -20, -104));

    const row = messagesStore.byKey(`c:${prefix}`)[0];
    expect(row.body).toBe('dm body');
    expect(row.meta).not.toHaveProperty('rssi');
    expect(row.meta?.snr).toBe(-5); // snr*4 = -20
  });

  it('ignores byte 2 per frame — two frames differing only there both stay clean', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_200, 'Alice: near', 40, -42));
    receive(channelMsgV3(0, 1_700_000_201, 'Alice: far', 40, -119));

    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.meta).not.toHaveProperty('rssi');
      expect(row.meta?.snr).toBe(10);
    }
  });

  it('omits rssi on a firmware-faithful frame, where the reserved bytes are 0', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_250, 'Alice: real', 48));

    const row = messagesStore.byKey('ch:General')[0];
    expect(row.body).toBe('real');
    expect(row.meta).not.toHaveProperty('rssi');
  });

  it('omits rssi entirely on a V1 frame, which has no signal header', () => {
    const { receive } = channelSession();
    receive(channelMsgV1(0, 1_700_000_300, 'Alice: legacy'));

    const row = messagesStore.byKey('ch:General')[0];
    expect(row.body).toBe('legacy');
    expect(row.meta).not.toHaveProperty('rssi');
  });

  it('renders {{ rssi }} as the ? placeholder, matching the manifest caveat', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_400, 'Alice: ping', 48, -87));

    // Read the message back out of storage (a full JSON meta round-trip), then
    // drive the real reply-context builder and the real macro engine over it.
    // A macro built on {{ rssi }} transmits "?dBm" — which is exactly why the
    // manifest entry steers users to snr. Populating this for real needs the
    // 0x88 RX-log correlation, not a header read (issue #33).
    const message = messagesStore.byKey('ch:General')[0];
    const ctx = buildReplyContext({ self, message, senderContact: null, channelName: 'General', repeaters: [] });
    expect(ctx.rssi).toBeNull();

    expect(renderMacro('{{ rssi }}dBm', ctx)).toEqual({ ok: true, text: '?dBm' });
    // snr is the one that actually works.
    expect(renderMacro('{{ snr }}dB', ctx)).toEqual({ ok: true, text: '12dB' });
  });
});
