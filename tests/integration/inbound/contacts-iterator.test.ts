import { Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { captureBus } from '../../support/bus';
import { contactSyncFrame, u32Frame } from '../../support/companionFrames';
import { makeTestSession } from '../../support/session-harness';

const startFrame = (total: number) => u32Frame(Protocol.RESP.CONTACTS_START, total);
const endFrame = u32Frame(Protocol.RESP.END_OF_CONTACTS, 0);

describe('inbound contacts iterator via the feature registry + contactsSync bridge', () => {
  it('drives syncProgress 0/2 → 1/2 → 2/2 → 2/2 and surfaces both contacts', async () => {
    const { receive } = makeTestSession();

    const progress = captureBus('syncProgress');
    const contacts = captureBus('contacts');

    const pkA = 'a1'.repeat(32);
    const pkB = 'b2'.repeat(32);

    receive(startFrame(2));
    receive(contactSyncFrame(pkA, 'Alice'));
    receive(contactSyncFrame(pkB, 'Bob'));
    receive(endFrame);
    // The contacts broadcast is coalesced, so the final full list lands on the
    // trailing pass. syncProgress is not coalesced and is already complete.
    await flushContactSyncEmits();

    // The contactsSync bridge must reproduce the legacy handler's progress
    // transitions exactly: start(0/total) → per-contact(done/total) → end-snap.
    expect(progress.values.map((p) => p.contacts)).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
      { done: 2, total: 2 },
    ]);
    const keys = (contacts.last() ?? []).map((c) => c.key);
    expect(keys).toContain(`c:${pkA}`);
    expect(keys).toContain(`c:${pkB}`);
  });

  it('self-heals when more contacts arrive than CONTACTS_START promised', () => {
    const { receive } = makeTestSession();

    const progress = captureBus('syncProgress');

    receive(startFrame(1)); // radio promises 1
    receive(contactSyncFrame('a1'.repeat(32), 'Alice'));
    receive(contactSyncFrame('b2'.repeat(32), 'Bob')); // but sends 2
    receive(endFrame);

    // total bumps to 2 once count exceeds the promised 1 — never "2/1".
    expect(progress.values.map((p) => p.contacts)).toEqual([
      { done: 0, total: 1 },
      { done: 1, total: 1 },
      { done: 2, total: 2 },
      { done: 2, total: 2 },
    ]);
  });
});
