import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { stateHolder } from '../../../src/main/state/holder';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

// Read-path smoke tests for the SessionAdapter: inject a companion frame through
// the LoopbackTransport and assert the adapter writes through to coresense's
// holder/discoveredStore/messagesStore and re-emits the identical emit.* bus
// event the renderer already listens for.

// RESP_DEVICE_INFO fixed layout (firmware MyMesh.cpp CMD_DEVICE_QUERY):
//   [0]=code 0x0d, [1]=verCode, [2]=maxContacts/2, [3]=maxChannels,
//   [4..7]=ble_pin u32LE, [8..19]=build date, [20..59]=model,
//   [60..79]=firmware version, [80]=client_repeat
function deviceInfoFrame(): Buffer {
  const frame = Buffer.alloc(82);
  frame[0] = 0x0d;
  frame[1] = 0x0b; // ver 11
  frame[2] = 0xaf; // maxContacts / 2
  frame[3] = 0x28; // maxChannels
  frame.writeUInt32LE(0, 4); // ble_pin unset
  frame.write('19 Apr 2026', 8, 'ascii');
  frame.write('Heltec T096', 20, 'ascii');
  frame.write('v1.15.0', 60, 'ascii');
  frame[80] = 1;
  return frame;
}

// PUSH_NEW_ADVERT (0x8a) carries a full 148-byte contact record — same layout
// as RESP_CONTACT, only the code byte differs.
function advertFrame(pubkeyHex: string, name: string): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = 0x8a;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = 1; // type = chat
  frame[35] = 0xff; // out_path_len = direct
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

// RESP_CHANNEL_MSG_RECV_V3 (0x11): [0x11][snr*4 int8][2B rsv][idx][path_len]
// [txt_type][ts u32 LE][body]. path_len 0xFF = direct (no mesh observation).
function channelMsgV3(idx: number, ts: number, body: string): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(11 + text.length);
  frame[0] = 0x11;
  frame.writeInt8(48, 1); // snr*4 = 48 → 12 dB
  frame[4] = idx;
  frame[5] = 0xff; // direct
  frame[6] = 0; // txt_type
  frame.writeUInt32LE(ts, 7);
  text.copy(frame, 11);
  return frame;
}

const PUBKEY = 'cc'.repeat(32);

describe('SessionAdapter read-path (inject frame → persist + bus)', () => {
  it('folds RESP_DEVICE_INFO into the holder and re-emits deviceInfo', async () => {
    const { receive } = makeTestSession();

    const seen: Array<{ firmwareVersion?: string; firmwareBuildDate?: string }> = [];
    const onInfo = (d: { firmwareVersion?: string; firmwareBuildDate?: string }) => seen.push(d);
    bus.on('deviceInfo', onInfo);

    receive(deviceInfoFrame());
    await Promise.resolve();
    bus.off('deviceInfo', onInfo);

    expect(seen.at(-1)?.firmwareVersion).toBe('v1.15.0');
    expect(seen.at(-1)?.firmwareBuildDate).toBe('19 Apr 2026');
    expect(stateHolder().getDeviceInfo().deviceModel).toBe('Heltec T096');
    expect(stateHolder().getDeviceInfo().maxContacts).toBe(0xaf * 2);
  });

  it('ingests a PUSH_NEW_ADVERT into discoveredStore and emits discovered', async () => {
    const { receive } = makeTestSession();

    const discovered: Array<{ key: string; name: string; kind: string }> = [];
    bus.on('contactDiscovered', (c: { key: string; name: string; kind: string }) => discovered.push(c));

    receive(advertFrame(PUBKEY, 'Carol'));
    await Promise.resolve();

    expect(discovered).toEqual([{ key: `c:${PUBKEY}`, name: 'Carol', kind: 'chat' }]);

    const row = discoveredStore.get(PUBKEY);
    expect(row).not.toBeNull();
    expect(row?.name).toBe('Carol');
  });

  it('routes a channel-message frame to storage and re-emits messages', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.markChannelPresent({ key: 'ch:General', name: 'General', kind: 'public', idx: 0 });

    const emitted: Array<{ key: string; messages: Message[] }> = [];
    bus.on('messages', (key: string, messages: Message[]) => emitted.push({ key, messages }));

    receive(channelMsgV3(0, 1_700_000_000, 'Alice: hi'));
    await Promise.resolve();

    expect(emitted.at(-1)?.key).toBe('ch:General');
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'ch:General', body: 'hi', state: 'received' });
  });
});
