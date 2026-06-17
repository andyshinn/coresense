import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { Channel } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

const channel: Channel = {
  key: 'ch:Outbound',
  name: 'Outbound',
  kind: 'public',
  idx: 5,
  secretHex: '00112233445566778899aabbccddeeff',
};

describe('outbound channel send', () => {
  it('encodes the channel-text frame and writes it to the transport', async () => {
    const { adapter, transport } = makeTestSession();
    // Seed the lib's channel store so sendChannelText resolves the slot index.
    adapter.session.state.setChannels([channel]);

    const result = await adapter.sendChannelText('ch:Outbound', 'hi there');
    expect(result.ok).toBe(true);

    expect(transport.sent).toHaveLength(1);
    const frame = Buffer.from(transport.sent[0]);
    expect(frame[0]).toBe(0x03); // SEND_CHAN_TXT_MSG
    expect(frame[1]).toBe(0); // flags
    expect(frame[2]).toBe(5); // channel idx
    // bytes 3..6 are the LE timestamp (non-deterministic); body follows at 7.
    expect(frame.subarray(7).toString('utf8')).toBe('hi there');
  });

  it('fails cleanly when the channel slot is unknown', async () => {
    const { adapter } = makeTestSession();
    adapter.session.state.setChannels([{ ...channel, key: 'ch:NoSlot', idx: undefined }]);
    const result = await adapter.sendChannelText('ch:NoSlot', 'hi');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no slot index/i);
  });
});
