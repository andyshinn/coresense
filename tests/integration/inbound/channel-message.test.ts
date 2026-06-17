import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

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

describe('inbound channel-message pipeline', () => {
  it('routes a received channel frame to state + storage + bus event', () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.markChannelPresent({ key: 'ch:General', name: 'General', kind: 'public', idx: 0 });

    const emitted: Array<{ key: string; messages: Message[] }> = [];
    bus.on('messages', (key: string, messages: Message[]) => emitted.push({ key, messages }));

    receive(channelMsgV3(0, 1_700_000_000, 'Alice: hi'));

    expect(emitted.at(-1)?.key).toBe('ch:General');
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'ch:General', body: 'hi', state: 'received' });
  });

  it('drops a channel frame for an unknown slot', () => {
    const { receive } = makeTestSession();
    receive(channelMsgV3(3, 1_700_000_001, 'Bob: yo'));
    expect(messagesStore.recent()).toHaveLength(0);
  });
});
