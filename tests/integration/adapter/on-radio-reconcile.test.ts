import { Buffer } from 'node:buffer';
import type { Models } from '@andyshinn/meshcore-ts';
import { describe, expect, it, vi } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import type { DiscoveredContact } from '../../../src/shared/contacts/discovered';
import { makeTestSession } from '../../support/session-harness';

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

const RESP_CONTACTS_START = 0x02;
const RESP_CONTACT = 0x03;
const RESP_END_OF_CONTACTS = 0x04;

/** meshcore-ts arms a 10s idle watchdog for the bulk window; when a sync stalls
 *  it flushes the coalesced snapshots without emitting `contactsSynced`. */
const BULK_IDLE_MS = 10_000;

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

function deliverSync(receive: (f: Buffer) => void, n: number): void {
  receive(u32Frame(RESP_CONTACTS_START, n));
  for (let i = 0; i < n; i++) receive(contactSyncFrame(i));
  receive(u32Frame(RESP_END_OF_CONTACTS, n));
}

/** A contact the radio no longer holds: only ever seen through a past sync, so
 *  the lib's fresh in-memory pool has never heard of it. */
function staleRecord(i: number): Models.ContactRecord {
  return {
    publicKeyHex: pubkeyOf(i),
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
      expect(discoveredStore.get(pubkeyOf(i))?.on_radio).toBe(1);
    }
  });

  it('re-broadcasts the discovered pool so the renderer sees the reconciled flags', async () => {
    const { receive } = makeTestSession();
    const stalePk = seedStale(0xf1);

    let last: DiscoveredContact[] = [];
    const onDiscovered = (rows: DiscoveredContact[]) => {
      last = rows;
    };
    bus.on('discovered', onDiscovered);

    deliverSync(receive, 3);
    await flushContactSyncEmits();
    bus.off('discovered', onDiscovered);

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

    receive(u32Frame(RESP_CONTACTS_START, 0));
    receive(u32Frame(RESP_END_OF_CONTACTS, 0));
    await flushContactSyncEmits();

    expect(discoveredStore.get(a)?.on_radio).toBe(0);
    expect(discoveredStore.get(b)?.on_radio).toBe(0);
  });

  it('does NOT reconcile an iteration abandoned before RESP_END_OF_CONTACTS', async () => {
    const { receive } = makeTestSession();
    const stalePk = seedStale(0xf4);

    const summaries: unknown[] = [];
    const onSummary = (s: unknown) => summaries.push(s);
    bus.on('contactSyncSummary', onSummary);

    // The radio announces 5 contacts, delivers 2, then goes away. Reconciling
    // here would clear on_radio for the 3 it never sent — and for every other
    // contact the radio genuinely still holds.
    receive(u32Frame(RESP_CONTACTS_START, 5));
    receive(contactSyncFrame(0));
    receive(contactSyncFrame(1));
    await flushContactSyncEmits();
    bus.off('contactSyncSummary', onSummary);

    expect(summaries).toHaveLength(0);
    expect(discoveredStore.get(stalePk)?.on_radio).toBe(1);
  });

  it('does NOT reconcile when a stalled sync is closed by the bulk watchdog', async () => {
    vi.useFakeTimers();
    try {
      const { receive } = makeTestSession();
      const stalePk = seedStale(0xf5);

      const summaries: unknown[] = [];
      const onSummary = (s: unknown) => summaries.push(s);
      bus.on('contactSyncSummary', onSummary);

      receive(u32Frame(RESP_CONTACTS_START, 5));
      receive(contactSyncFrame(0));
      receive(contactSyncFrame(1));
      // The lib's idle watchdog fires: it flushes the coalesced `contacts` and
      // `discovered` snapshots, which is exactly the shape of a completed sync
      // from our write-through's point of view — but it emits no
      // `contactsSynced`, so nothing may be reconciled.
      vi.advanceTimersByTime(BULK_IDLE_MS + 1);
      await flushContactSyncEmits();
      bus.off('contactSyncSummary', onSummary);

      expect(summaries).toHaveLength(0);
      expect(discoveredStore.get(stalePk)?.on_radio).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles again on the next sync, so a re-added contact goes back on-radio', async () => {
    const { receive } = makeTestSession();

    deliverSync(receive, 3);
    await flushContactSyncEmits();
    expect(discoveredStore.get(pubkeyOf(2))?.on_radio).toBe(1);

    // Contact 2 is removed from the radio...
    deliverSync(receive, 2);
    await flushContactSyncEmits();
    expect(discoveredStore.get(pubkeyOf(2))?.on_radio).toBe(0);

    // ...and added back. The reconcile clears the whole flag cache, so the
    // write-through must not consider these rows already up to date.
    deliverSync(receive, 3);
    await flushContactSyncEmits();
    expect(discoveredStore.get(pubkeyOf(2))?.on_radio).toBe(1);
  });
});
