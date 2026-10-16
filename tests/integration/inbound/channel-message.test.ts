import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import { captureBus } from '../../support/bus';
import { channelMsgV3 } from '../../support/companionFrames';
import { makeTestSession } from '../../support/session-harness';

describe('inbound channel-message pipeline', () => {
  it('routes a received channel frame to state + storage + bus event', () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.markChannelPresent({ key: 'ch:General', name: 'General', kind: 'public', idx: 0 });

    const emitted = captureBus('messages');

    receive(channelMsgV3(0, 1_700_000_000, 'Alice: hi'));

    expect(emitted.last()).toBe('ch:General');
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
