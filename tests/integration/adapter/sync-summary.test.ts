import { Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { stateHolder } from '../../../src/main/state/holder';
import { captureBus } from '../../support/bus';
import { contactsSync, u32Frame } from '../../support/companionFrames';
import { makeTestSession } from '../../support/session-harness';

// meshcore-ts 0.7.0 reports how many RESP_CONTACT records the radio actually
// delivered. Comparing that against what we persisted is the only end-to-end
// answer to "did we load them all?" — the coalesced broadcasts deliberately no
// longer fire once per contact, so emit counts can't answer it.

const { RESP } = Protocol;

describe('contact sync summary', () => {
  it('reports the radio-delivered count and the count we stored', async () => {
    const { receive } = makeTestSession();
    const N = 25;

    const summaries = captureBus('contactSyncSummary');

    for (const frame of contactsSync(N)) receive(frame);
    await flushContactSyncEmits();

    expect(summaries.values).toHaveLength(1);
    expect(summaries.values[0].delivered).toBe(N);
    expect(summaries.values[0].stored).toBe(N);
    expect(summaries.values[0].complete).toBe(true);
    expect(stateHolder().getContacts()).toHaveLength(N);
  });

  it('counts delivered from the records actually received, not the header count', async () => {
    const { receive } = makeTestSession();

    const summaries = captureBus('contactSyncSummary');

    // CONTACTS_START and END_OF_CONTACTS both claim 5, but no RESP_CONTACT
    // arrives. `delivered` must reflect the records we actually saw (0), not
    // the radio's advertised count — otherwise an optimistic or stale header
    // would raise a false "INCOMPLETE" on every sync.
    receive(u32Frame(RESP.CONTACTS_START, 5));
    receive(u32Frame(RESP.END_OF_CONTACTS, 5));
    await flushContactSyncEmits();

    expect(summaries.values).toHaveLength(1);
    expect(summaries.values[0].delivered).toBe(0);
    expect(summaries.values[0].stored).toBe(0);
    expect(summaries.values[0].complete).toBe(true);
  });
});
