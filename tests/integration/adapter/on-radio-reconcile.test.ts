import { type Models, Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it, vi } from 'vitest';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { captureBus } from '../../support/bus';
import { contactsSync, syncPubkey, u32Frame } from '../../support/companionFrames';
import { makeTestSession, type TestSession } from '../../support/session-harness';

// `on_radio` in the sqlite mirror used to be one-way: the `discovered`
// write-through SETS it for every row the lib reports, and nothing ever CLEARED
// it for a row the lib stopped reporting. The lib's pool is in-memory and
// per-session; ours is persistent, so a contact removed from the radio kept
// on_radio=1 forever and the Contact Manager's "On radio" count drifted upward
// without bound (#30).
//
// The fix reconciles the mirror against the radio's contents on `contactsSynced`.
// The load-bearing property — and the most dangerous way to get this wrong — is
// that the reconcile happens ONLY after a genuine RESP_END_OF_CONTACTS. An
// iteration abandoned by a disconnect or a stalled radio flushes its coalesced
// snapshots but reports no summary, and must not clear flags for contacts the
// radio simply never got around to sending.

const { RESP } = Protocol;

/** meshcore-ts arms a 10s idle watchdog for the bulk window; when a sync stalls
 *  it flushes the coalesced snapshots without emitting `contactsSynced`. */
const BULK_IDLE_MS = 10_000;

function deliverSync(receive: TestSession['receive'], n: number): void {
  for (const frame of contactsSync(n)) receive(frame);
}

/** A contact the radio no longer holds: only ever seen through a past sync, so
 *  the lib's fresh in-memory pool has never heard of it. */
function staleRecord(i: number): Models.ContactRecord {
  return {
    publicKeyHex: syncPubkey(i),
    name: `Removed ${i}`,
    type: 1,
    flags: 0,
    outPathLen: 0xff,
    outPathHex: '',
    lastAdvertUnix: 1_749_000_000 + i,
    gpsLat: 0,
    gpsLon: 0,
    lastmod: i,
  } as Models.ContactRecord;
}

/** Persist a row claiming to be on the radio, as an earlier session's sync did. */
function seedStale(i: number): string {
  const record = staleRecord(i);
  discoveredStore.upsert(record, { onRadio: true, nowMs: 1_749_000_000_000, heardLive: false });
  return record.publicKeyHex;
}

describe('on_radio reconcile after a contact sync', () => {
  it('clears a stale on_radio row that the completed sync did not report', async () => {
    const { receive } = makeTestSession();
    const stalePk = seedStale(0xf0);
    expect(discoveredStore.get(stalePk)?.on_radio).toBe(1);

    deliverSync(receive, 3);
    await flushContactSyncEmits();

    // Flipped, not deleted: the node is still a legitimate discovered contact,
    // it just is not in the radio's contact store any more.
    const row = discoveredStore.get(stalePk);
    expect(row).not.toBeNull();
    expect(row?.name).toBe('Removed 240');
    expect(row?.on_radio).toBe(0);

    for (let i = 0; i < 3; i++) {
      expect(discoveredStore.get(syncPubkey(i))?.on_radio).toBe(1);
    }
  });

  it('re-broadcasts the discovered pool so the renderer sees the reconciled flags', async () => {
    const { receive } = makeTestSession();
    const stalePk = seedStale(0xf1);

    const discovered = captureBus('discovered');

    deliverSync(receive, 3);
    await flushContactSyncEmits();
    const last = discovered.last() ?? [];

    // The lib flushes its own `discovered` snapshot BEFORE emitting
    // contactsSynced, so without an explicit re-broadcast the last thing the
    // renderer saw would still carry the pre-reconcile flag.
    expect(last.find((r) => r.publicKeyHex === stalePk)?.onRadio).toBe(false);
    expect(last.filter((r) => r.onRadio)).toHaveLength(3);
  });

  it('clears every row when the radio reports an empty contact store', async () => {
    const { receive } = makeTestSession();
    const a = seedStale(0xf2);
    const b = seedStale(0xf3);

    receive(u32Frame(RESP.CONTACTS_START, 0));
    receive(u32Frame(RESP.END_OF_CONTACTS, 0));
    await flushContactSyncEmits();

    expect(discoveredStore.get(a)?.on_radio).toBe(0);
    expect(discoveredStore.get(b)?.on_radio).toBe(0);
  });

  it('does NOT reconcile an iteration abandoned before RESP_END_OF_CONTACTS', async () => {
    const { receive } = makeTestSession();
    const stalePk = seedStale(0xf4);

    const summaries = captureBus('contactSyncSummary');

    // The radio announces 5 contacts, delivers 2, then goes away. Reconciling
    // here would clear on_radio for the 3 it never sent — and for every other
    // contact the radio genuinely still holds.
    const [start, first, second] = contactsSync(5);
    receive(start);
    receive(first);
    receive(second);
    await flushContactSyncEmits();

    expect(summaries.calls).toHaveLength(0);
    expect(discoveredStore.get(stalePk)?.on_radio).toBe(1);
  });

  it('does NOT reconcile when a stalled sync is closed by the bulk watchdog', async () => {
    vi.useFakeTimers();
    try {
      const { receive } = makeTestSession();
      const stalePk = seedStale(0xf5);

      const summaries = captureBus('contactSyncSummary');

      const [start, first, second] = contactsSync(5);
      receive(start);
      receive(first);
      receive(second);
      // The lib's idle watchdog fires: it flushes the coalesced `contacts` and
      // `discovered` snapshots, which is exactly the shape of a completed sync
      // from our write-through's point of view — but it emits no
      // `contactsSynced`, so nothing may be reconciled.
      vi.advanceTimersByTime(BULK_IDLE_MS + 1);
      await flushContactSyncEmits();

      expect(summaries.calls).toHaveLength(0);
      expect(discoveredStore.get(stalePk)?.on_radio).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles again on the next sync, so a re-added contact goes back on-radio', async () => {
    const { receive } = makeTestSession();

    deliverSync(receive, 3);
    await flushContactSyncEmits();
    expect(discoveredStore.get(syncPubkey(2))?.on_radio).toBe(1);

    // Contact 2 is removed from the radio...
    deliverSync(receive, 2);
    await flushContactSyncEmits();
    expect(discoveredStore.get(syncPubkey(2))?.on_radio).toBe(0);

    // ...and added back. The reconcile clears the whole flag cache, so the
    // write-through must not consider these rows already up to date.
    deliverSync(receive, 3);
    await flushContactSyncEmits();
    expect(discoveredStore.get(syncPubkey(2))?.on_radio).toBe(1);
  });
});
