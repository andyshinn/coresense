import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { stateHolder } from '../../../src/main/state/holder';
import { makeTestSession } from '../../support/session-harness';

// meshcore-ts 0.7.0 reports how many RESP_CONTACT records the radio actually
// delivered. Comparing that against what we persisted is the only end-to-end
// answer to "did we load them all?" — the coalesced broadcasts deliberately no
// longer fire once per contact, so emit counts can't answer it.

const RESP_CONTACTS_START = 0x02;
const RESP_CONTACT = 0x03;
const RESP_END_OF_CONTACTS = 0x04;

function contactSyncFrame(i: number): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = RESP_CONTACT;
  Buffer.from(i.toString(16).padStart(4, '0').repeat(16), 'hex').copy(frame, 1);
  frame[33] = 1;
  frame[35] = 0xff;
  Buffer.from(`Node ${i}`, 'utf8').copy(frame, 100);
  frame.writeUInt32LE(1_750_000_000 + i, 132);
  return frame;
}

function u32Frame(code: number, value: number): Buffer {
  const frame = Buffer.alloc(5);
  frame[0] = code;
  frame.writeUInt32LE(value, 1);
  return frame;
}

describe('contact sync summary', () => {
  it('reports the radio-delivered count and the count we stored', async () => {
    const { receive } = makeTestSession();
    const N = 25;

    const summaries: Array<{ delivered: number; stored: number; complete: boolean }> = [];
    const onSummary = (s: { delivered: number; stored: number; complete: boolean }) => summaries.push(s);
    bus.on('contactSyncSummary', onSummary);

    receive(u32Frame(RESP_CONTACTS_START, N));
    for (let i = 0; i < N; i++) receive(contactSyncFrame(i));
    receive(u32Frame(RESP_END_OF_CONTACTS, N));
    await flushContactSyncEmits();
    bus.off('contactSyncSummary', onSummary);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].delivered).toBe(N);
    expect(summaries[0].stored).toBe(N);
    expect(summaries[0].complete).toBe(true);
    expect(stateHolder().getContacts()).toHaveLength(N);
  });

  it('counts delivered from the records actually received, not the header count', async () => {
    const { receive } = makeTestSession();

    const summaries: Array<{ delivered: number; stored: number; complete: boolean }> = [];
    const onSummary = (s: { delivered: number; stored: number; complete: boolean }) => summaries.push(s);
    bus.on('contactSyncSummary', onSummary);

    // CONTACTS_START and END_OF_CONTACTS both claim 5, but no RESP_CONTACT
    // arrives. `delivered` must reflect the records we actually saw (0), not
    // the radio's advertised count — otherwise an optimistic or stale header
    // would raise a false "INCOMPLETE" on every sync.
    receive(u32Frame(RESP_CONTACTS_START, 5));
    receive(u32Frame(RESP_END_OF_CONTACTS, 5));
    await flushContactSyncEmits();
    bus.off('contactSyncSummary', onSummary);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].delivered).toBe(0);
    expect(summaries[0].stored).toBe(0);
    expect(summaries[0].complete).toBe(true);
  });
});
