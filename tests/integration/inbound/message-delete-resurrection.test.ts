import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

// Deterministic channel id, exactly the shape @andyshinn/meshcore-ts mints:
// chmsg-<channel.key>-<timestampUnix>-<sha1(body)[0:12]>. Two flood receipts of
// one packet produce this same id, which is why a deleted row can come back.
const CHANNEL_MID = 'chmsg-ch:General-1700000000-abc123def456';

const channelMsg = (): Message => ({
  id: CHANNEL_MID,
  key: 'ch:General',
  ts: 1_700_000_000_000,
  body: 'anyone near the north ridge repeater',
  state: 'received',
  fromPublicKeyHex: 'name:nate',
});

describe('deleted messages do not come back', () => {
  it('drops a re-heard channel packet whose id was deleted', () => {
    const holder = stateHolder();
    holder.recordLibMessage(channelMsg());
    expect(messagesStore.findById(CHANNEL_MID)).not.toBeNull();

    expect(holder.removeMessages('ch:General', [CHANNEL_MID])).toEqual([CHANNEL_MID]);
    expect(messagesStore.findById(CHANNEL_MID)).toBeNull();

    // Same packet, second flood path — the library re-emits messageUpserted
    // with the identical deterministic id.
    holder.recordLibMessage(channelMsg());
    expect(messagesStore.findById(CHANNEL_MID)).toBeNull();
  });

  it('still records a genuinely new message after a delete', () => {
    const holder = stateHolder();
    holder.recordLibMessage(channelMsg());
    holder.removeMessages('ch:General', [CHANNEL_MID]);
    holder.recordLibMessage({ ...channelMsg(), id: 'radio-xyz-000001', body: 'different' });
    expect(messagesStore.findById('radio-xyz-000001')).not.toBeNull();
  });

  it('removeMessages returns [] for an unknown id', () => {
    expect(stateHolder().removeMessages('ch:General', ['ghost'])).toEqual([]);
  });

  // upsertMessage is the other insert path — currently unreferenced, but it
  // exists to merge the multi-path receipts the tombstone protects.
  it('upsertMessage also refuses to resurrect a deleted id', () => {
    const holder = stateHolder();
    holder.recordLibMessage(channelMsg());
    holder.removeMessages('ch:General', [CHANNEL_MID]);
    holder.upsertMessage(channelMsg());
    expect(messagesStore.findById(CHANNEL_MID)).toBeNull();
  });
});
