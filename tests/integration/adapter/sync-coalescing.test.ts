import { describe, expect, it } from 'vitest';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { flushHolderPersistence, stateHolder } from '../../../src/main/state/holder';
import { openDb } from '../../../src/main/storage/db';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { captureBus } from '../../support/bus';
import { contactsSync } from '../../support/companionFrames';
import { makeTestSession, type TestSession } from '../../support/session-harness';
import { countDiscoveredWrites, countWritesTo } from '../../support/sql-counter';

// The lib emits a FULL `contacts` and a FULL `discovered` snapshot on every
// RESP_CONTACT frame (meshcore-ts src/features/contacts.ts:346 and :371), and
// re-emits both authoritatively at END_OF_CONTACTS (:520-521). coresense used
// to react to each one by rewriting the whole sqlite pool and re-broadcasting
// the whole array, which made a sync O(N^2) in both statements and bytes.
//
// These tests pin the coalescing contract: a bulk sync must do work
// proportional to N, not N^2 — while still leaving the mirror correct.

/** Drive a full GET_CONTACTS iteration of `n` contacts through the adapter. */
function deliverSync(receive: TestSession['receive'], n: number): void {
  for (const frame of contactsSync(n)) receive(frame);
}

const N = 40;

describe('bulk contact sync coalescing', () => {
  it('broadcasts the discovered pool a bounded number of times, not once per contact', async () => {
    const { receive } = makeTestSession();

    const discovered = captureBus('discovered');

    deliverSync(receive, N);
    await flushContactSyncEmits();

    // Uncoalesced this is N+1 = 41 (one per contact frame, plus END_OF_CONTACTS).
    expect(discovered.calls.length).toBeLessThanOrEqual(4);
  });

  it('broadcasts the contact list a bounded number of times, not once per contact', async () => {
    const { receive } = makeTestSession();

    const contacts = captureBus('contacts');

    deliverSync(receive, N);
    await flushContactSyncEmits();

    // Uncoalesced this is N+1 full-array broadcasts, so the bytes pushed to the
    // renderer grow as N^2 — the renderer then parses and re-renders each one.
    const bytes = contacts.values.reduce((sum, rows) => sum + JSON.stringify(rows).length, 0);
    expect(contacts.calls.length).toBeLessThanOrEqual(4);
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
