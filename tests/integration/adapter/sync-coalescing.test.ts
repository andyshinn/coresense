import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { flushHolderPersistence, stateHolder } from '../../../src/main/state/holder';
import { openDb } from '../../../src/main/storage/db';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { makeTestSession } from '../../support/session-harness';
import { countDiscoveredWrites, countWritesTo } from '../../support/sql-counter';

// The lib emits a FULL `contacts` and a FULL `discovered` snapshot on every
// RESP_CONTACT frame (meshcore-ts src/features/contacts.ts:346 and :371), and
// re-emits both authoritatively at END_OF_CONTACTS (:520-521). coresense used
// to react to each one by rewriting the whole sqlite pool and re-broadcasting
// the whole array, which made a sync O(N^2) in both statements and bytes.
//
// These tests pin the coalescing contract: a bulk sync must do work
// proportional to N, not N^2 — while still leaving the mirror correct.

const RESP_CONTACTS_START = 0x02;
const RESP_CONTACT = 0x03;
const RESP_END_OF_CONTACTS = 0x04;

function pubkeyOf(i: number): string {
  return i.toString(16).padStart(2, '0').repeat(32);
}

/** RESP_CONTACT: the 148-byte contact record (same layout as PUSH_NEW_ADVERT). */
function contactSyncFrame(i: number): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = RESP_CONTACT;
  Buffer.from(pubkeyOf(i), 'hex').copy(frame, 1);
  frame[33] = 1; // type = chat
  frame[35] = 0xff; // out_path_len = flood/direct, no path bytes
  Buffer.from(`Node ${i}`, 'utf8').copy(frame, 100);
  frame.writeUInt32LE(1_750_000_000 + i, 132); // last_advert_unix
  return frame;
}

function u32Frame(code: number, value: number): Buffer {
  const frame = Buffer.alloc(5);
  frame[0] = code;
  frame.writeUInt32LE(value, 1);
  return frame;
}

/** Drive a full GET_CONTACTS iteration of `n` contacts through the adapter. */
function deliverSync(receive: (f: Buffer) => void, n: number): void {
  receive(u32Frame(RESP_CONTACTS_START, n));
  for (let i = 0; i < n; i++) receive(contactSyncFrame(i));
  receive(u32Frame(RESP_END_OF_CONTACTS, n));
}

const N = 40;

describe('bulk contact sync coalescing', () => {
  it('broadcasts the discovered pool a bounded number of times, not once per contact', async () => {
    const { receive } = makeTestSession();

    let emits = 0;
    const onDiscovered = () => {
      emits += 1;
    };
    bus.on('discovered', onDiscovered);

    deliverSync(receive, N);
    await flushContactSyncEmits();
    bus.off('discovered', onDiscovered);

    // Uncoalesced this is N+1 = 41 (one per contact frame, plus END_OF_CONTACTS).
    expect(emits).toBeLessThanOrEqual(4);
  });

  it('broadcasts the contact list a bounded number of times, not once per contact', async () => {
    const { receive } = makeTestSession();

    let emits = 0;
    let bytes = 0;
    const onContacts = (rows: unknown) => {
      emits += 1;
      bytes += JSON.stringify(rows).length;
    };
    bus.on('contacts', onContacts);

    deliverSync(receive, N);
    await flushContactSyncEmits();
    bus.off('contacts', onContacts);

    // Uncoalesced this is N+1 full-array broadcasts, so the bytes pushed to the
    // renderer grow as N^2 — the renderer then parses and re-renders each one.
    expect(emits).toBeLessThanOrEqual(4);
    expect(bytes).toBeLessThan(N * 2_000);
  });

  it('leaves the holder holding every synced contact', async () => {
    const { receive } = makeTestSession();

    deliverSync(receive, N);
    await flushContactSyncEmits();

    expect(stateHolder().getContacts()).toHaveLength(N);
  });

  it('writes a number of discovered_contacts rows proportional to N, not N squared', async () => {
    const { receive } = makeTestSession();
    const counter = countDiscoveredWrites();

    deliverSync(receive, N);
    await flushContactSyncEmits();
    counter.restore();

    // Uncoalesced: one upsert per contact (N) plus 2 UPDATEs per row on every
    // one of the N+1 `discovered` emits = N + N(N+1) = 1,680 at N=40.
    // Linear behaviour is one upsert per contact plus a bounded flag pass.
    expect(counter.count).toBeLessThanOrEqual(4 * N);
  });

  it('rebuilds the conversations search index a bounded number of times', async () => {
    const { receive } = makeTestSession();
    const counter = countWritesTo('conversations_fts');

    deliverSync(receive, N);
    await flushHolderPersistence();
    counter.restore();

    // Uncoalesced, holder.setContacts fires per lib `contacts` event and each
    // one DELETEs the whole index and re-inserts every row: sum(i) ~ 820 at
    // N=40. Coalesced, it should be a couple of passes over N rows.
    expect(counter.count).toBeLessThanOrEqual(4 * N);
  });

  it('still indexes every synced contact for search', async () => {
    const { receive } = makeTestSession();

    deliverSync(receive, N);
    await flushHolderPersistence();

    expect(stateHolder().getContacts()).toHaveLength(N);
    const indexed = openDb().prepare(`SELECT COUNT(*) AS n FROM conversations_fts WHERE kind = 'contact'`).get() as {
      n: number;
    };
    expect(indexed.n).toBe(N);
  });

  it('still leaves every synced contact on-radio in the sqlite mirror', async () => {
    const { receive } = makeTestSession();

    deliverSync(receive, N);
    await flushContactSyncEmits();

    const rows = discoveredStore.list(stateHolder().getBlockRules());
    expect(rows).toHaveLength(N);
    expect(rows.every((r) => r.onRadio)).toBe(true);
    expect(rows.map((r) => r.name).sort()).toEqual(Array.from({ length: N }, (_, i) => `Node ${i}`).sort());
  });
});
