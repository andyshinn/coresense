import { describe, expect, it } from 'vitest';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import type { Channel } from '../../../src/shared/types';
import { FakeTransport } from '../../support/fake-transport';

const channel: Channel = {
  key: 'ch:Outbound',
  name: 'Outbound',
  kind: 'public',
  idx: 5,
  secretHex: '00112233445566778899aabbccddeeff',
};

describe('outbound channel send', () => {
  it('encodes the channel-text frame and writes it to the transport', async () => {
    stateHolder().setChannels([channel]);
    const fake = new FakeTransport();
    transportManager.setTransport(fake);

    const result = await protocolSession().sendChannelText('ch:Outbound', 'hi there');
    expect(result.ok).toBe(true);

    expect(fake.sent).toHaveLength(1);
    const frame = fake.sent[0];
    expect(frame[0]).toBe(0x03); // SEND_CHAN_TXT_MSG
    expect(frame[1]).toBe(0); // flags
    expect(frame[2]).toBe(5); // channel idx
    // bytes 3..6 are the LE timestamp (non-deterministic); body follows at 7.
    expect(frame.subarray(7).toString('utf8')).toBe('hi there');
  });

  it('fails cleanly when the channel slot is unknown', async () => {
    stateHolder().setChannels([{ ...channel, key: 'ch:NoSlot', idx: undefined }]);
    transportManager.setTransport(new FakeTransport());
    const result = await protocolSession().sendChannelText('ch:NoSlot', 'hi');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no slot index/i);
  });
});
