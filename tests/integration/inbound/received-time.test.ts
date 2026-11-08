import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

const RECEIVED = 1_800_000_000_000;
// A sender whose RTC is ~32 years fast — the reason `ts` can't be the packet time.
const FUTURE_PACKET = 2_794_000_000_000;

const libMsg = (over: Partial<Message> = {}): Message => ({
  id: 'chmsg-ch:General-2794000000-abc123def456',
  key: 'ch:General',
  ts: FUTURE_PACKET,
  body: 'test from new config',
  state: 'received',
  fromPublicKeyHex: 'name:barry',
  ...over,
});

describe('inbound messages are timed by reception, not the packet', () => {
  it('stores the receive time as ts and the packet time as sentTs', () => {
    stateHolder().recordLibMessage(libMsg(), RECEIVED);
    expect(messagesStore.findById(libMsg().id)).toMatchObject({ ts: RECEIVED, sentTs: FUTURE_PACKET });
  });

  it('orders a future-dated packet by when it arrived', () => {
    const holder = stateHolder();
    holder.recordLibMessage(libMsg(), RECEIVED);
    // Arrives later, but its sender's clock is correct — so its packet time is
    // far EARLIER than the first message's. It must still sort after it.
    holder.recordLibMessage(libMsg({ id: 'radio-later', ts: RECEIVED + 50_000, body: 'later' }), RECEIVED + 60_000);
    expect(holder.getMessagesForKey('ch:General').map((m) => m.body)).toEqual(['test from new config', 'later']);
  });

  it('keeps the first reception time when a flood copy is re-heard', () => {
    const holder = stateHolder();
    holder.recordLibMessage(libMsg(), RECEIVED);
    holder.recordLibMessage(libMsg({ meta: { timesHeard: 2 } }), RECEIVED + 30_000);
    const row = messagesStore.findById(libMsg().id);
    expect(row).toMatchObject({ ts: RECEIVED, sentTs: FUTURE_PACKET, meta: { timesHeard: 2 } });
  });

  it('keeps sentTs through state and path updates', () => {
    const holder = stateHolder();
    holder.recordLibMessage(libMsg(), RECEIVED);
    holder.setMessageState(libMsg().id, 'heard');
    holder.appendMessagePath(libMsg().id, { id: 'p1', hashMode: 1, finalSnr: 0, hops: [] });
    expect(messagesStore.findById(libMsg().id)).toMatchObject({ ts: RECEIVED, sentTs: FUTURE_PACKET, state: 'heard' });
  });

  it('does not null sent_ts when a re-insert omits it', () => {
    stateHolder().recordLibMessage(libMsg(), RECEIVED);
    const { sentTs: _drop, ...partial } = messagesStore.findById(libMsg().id) as Message;
    messagesStore.insert({ ...partial, body: 'edited' });
    expect(messagesStore.findById(libMsg().id)).toMatchObject({ body: 'edited', sentTs: FUTURE_PACKET });
  });

  it('leaves a legacy row without sentTs when its packet is re-heard', () => {
    // Stored before sent_ts existed: ts is the packet time, sentTs unknown.
    messagesStore.insert({ ...libMsg(), ts: FUTURE_PACKET });
    stateHolder().recordLibMessage(libMsg({ meta: { timesHeard: 2 } }), RECEIVED);
    const row = messagesStore.findById(libMsg().id);
    expect(row?.ts).toBe(FUTURE_PACKET);
    expect(row).not.toHaveProperty('sentTs');
  });

  it('round-trips a row with no sentTs (own and legacy messages)', () => {
    messagesStore.insert({ id: 'own-1', key: 'ch:General', ts: RECEIVED, body: 'mine', state: 'sent' });
    const row = messagesStore.findById('own-1');
    expect(row?.ts).toBe(RECEIVED);
    expect(row).not.toHaveProperty('sentTs');
  });
});
