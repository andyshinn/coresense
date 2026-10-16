import { describe, expect, it } from 'vitest';
import { buildReplyContext } from '../../../src/main/macros/contextBuilder';
import { renderMacro } from '../../../src/main/macros/service';
import { messagesStore } from '../../../src/main/storage/messages';
import type { DeviceIdentity, DeviceInfo, Owner } from '../../../src/shared/types';
import { channelMsgV1, channelMsgV3, contactMsgV3 } from '../../support/companionFrames';
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

// The frame layouts (RESP_CHANNEL_MSG_RECV_V3 0x11, RESP_CONTACT_MSG_RECV_V3
// 0x10, the V1 RESP_CHANNEL_MSG_RECV 0x08) are in tests/support/companionFrames.ts;
// `reserved` writes the same value into both reserved bytes.

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
    receive(channelMsgV3(0, 1_700_000_000, 'Alice: hi', { snrQ: 48, reserved: -73 }));

    const row = messagesStore.byKey('ch:General')[0];
    expect(row.body).toBe('hi');
    expect(row.meta).not.toHaveProperty('rssi');
    expect(row.meta?.snr).toBe(12); // snr*4 = 48, read off byte 1 as always
  });

  it('leaves rssi off a DM, even when byte 2 looks like an RSSI', () => {
    const { receive } = makeTestSession();
    const prefix = 'a1b2c3d4e5f6';
    receive(contactMsgV3(prefix, 1_700_000_100, 'dm body', { snrQ: -20, reserved: -104 }));

    const row = messagesStore.byKey(`c:${prefix}`)[0];
    expect(row.body).toBe('dm body');
    expect(row.meta).not.toHaveProperty('rssi');
    expect(row.meta?.snr).toBe(-5); // snr*4 = -20
  });

  it('ignores byte 2 per frame — two frames differing only there both stay clean', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_200, 'Alice: near', { snrQ: 40, reserved: -42 }));
    receive(channelMsgV3(0, 1_700_000_201, 'Alice: far', { snrQ: 40, reserved: -119 }));

    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.meta).not.toHaveProperty('rssi');
      expect(row.meta?.snr).toBe(10);
    }
  });

  it('omits rssi on a firmware-faithful frame, where the reserved bytes are 0', () => {
    const { receive } = channelSession();
    receive(channelMsgV3(0, 1_700_000_250, 'Alice: real', { snrQ: 48 }));

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
    receive(channelMsgV3(0, 1_700_000_400, 'Alice: ping', { snrQ: 48, reserved: -87 }));

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
