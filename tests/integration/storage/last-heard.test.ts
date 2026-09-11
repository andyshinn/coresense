import type { Models } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../../src/main/storage/db';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { countDiscoveredWrites } from '../../support/sql-counter';

// `last_heard_ms` used to have exactly one writer — the advert upsert — so a
// contact we message daily read "never" in the Contact Manager and dropped out
// of every Last-heard window. markHeard is the door for the other receipt paths
// (#45 item 9).

const PK = 'aa'.repeat(32);
const OTHER = 'bb'.repeat(32);
const T0 = 1_750_000_000_000;

function record(pubkey: string): Models.ContactRecord {
  return {
    publicKeyHex: pubkey,
    name: `Node ${pubkey.slice(0, 4)}`,
    type: 1,
    flags: 0,
    outPathLen: 0xff,
    outPathHex: '',
    lastAdvertUnix: 1_700_000_000,
    gpsLat: 0,
    gpsLon: 0,
    lastmod: 1,
  } as Models.ContactRecord;
}

/** Seed a row the way a GET_CONTACTS resync would — never heard live. */
function seed(pubkey = PK): void {
  discoveredStore.upsert(record(pubkey), { onRadio: true, nowMs: T0, heardLive: false });
}

const rowCount = () => (openDb().prepare('SELECT COUNT(*) AS n FROM discovered_contacts').get() as { n: number }).n;

describe('discoveredStore.markHeard', () => {
  it('advances last_heard_ms for an existing row', () => {
    seed();
    expect(discoveredStore.get(PK)?.last_heard_ms).toBe(0);

    expect(discoveredStore.markHeard(PK, T0 + 5_000)).toBe(true);
    expect(discoveredStore.get(PK)?.last_heard_ms).toBe(T0 + 5_000);
  });

  // A DM from a pubkey we have no advert for must not conjure a nameless row
  // into the Contact Manager.
  it('creates nothing for a pubkey with no row', () => {
    seed();
    const before = rowCount();

    expect(discoveredStore.markHeard(OTHER, T0 + 5_000)).toBe(false);

    expect(rowCount()).toBe(before);
    expect(discoveredStore.get(OTHER)).toBeNull();
  });

  it('never moves the clock backwards', () => {
    seed();
    discoveredStore.markHeard(PK, T0 + 600_000);

    // An out-of-order or replayed bump for an older reception.
    expect(discoveredStore.markHeard(PK, T0 + 1_000)).toBe(false);
    expect(discoveredStore.get(PK)?.last_heard_ms).toBe(T0 + 600_000);
  });

  // messageUpserted fires once per received message; unthrottled that is one
  // sqlite write per inbound packet into the table the emit coalescer already
  // exists to protect.
  it('throttles repeat bumps for the same pubkey', () => {
    seed();
    discoveredStore.markHeard(PK, T0 + 1_000);

    const counter = countDiscoveredWrites();
    for (let i = 1; i <= 20; i++) expect(discoveredStore.markHeard(PK, T0 + 1_000 + i * 100)).toBe(false);
    counter.restore();

    expect(counter.count).toBe(0);
    expect(discoveredStore.get(PK)?.last_heard_ms).toBe(T0 + 1_000);
  });

  it('writes again once the throttle window has passed', () => {
    seed();
    discoveredStore.markHeard(PK, T0);

    expect(discoveredStore.markHeard(PK, T0 + 30_000)).toBe(true);
    expect(discoveredStore.get(PK)?.last_heard_ms).toBe(T0 + 30_000);
  });

  it('throttles per pubkey, not globally', () => {
    seed(PK);
    seed(OTHER);
    discoveredStore.markHeard(PK, T0 + 1_000);

    expect(discoveredStore.markHeard(OTHER, T0 + 1_100)).toBe(true);
    expect(discoveredStore.get(OTHER)?.last_heard_ms).toBe(T0 + 1_100);
  });

  it('leaves on_radio and favourite alone', () => {
    seed();
    discoveredStore.setFavourite(PK, true);

    discoveredStore.markHeard(PK, T0 + 1_000);

    const row = discoveredStore.get(PK);
    expect(row?.on_radio).toBe(1);
    expect(row?.favourite).toBe(1);
  });

  // applyRadioFlags' cache tracks only on_radio|favourite. markHeard touches
  // neither, so invalidating it would force a full-pool rewrite on the next
  // `discovered` frame — the exact per-frame cost that cache exists to kill.
  it('does not invalidate the radio-flag cache', () => {
    seed();
    const flags = [{ publicKeyHex: PK, onRadio: true, favourite: false }];
    discoveredStore.applyRadioFlags(flags);

    discoveredStore.markHeard(PK, T0 + 1_000);

    const counter = countDiscoveredWrites();
    discoveredStore.applyRadioFlags(flags);
    counter.restore();
    expect(counter.count).toBe(0);
  });

  // A resync re-lists everything the radio stores; that is not a reception, and
  // it must not clobber a real one either.
  it('survives a later GET_CONTACTS resync of the same contact', () => {
    seed();
    discoveredStore.markHeard(PK, T0 + 60_000);

    discoveredStore.upsert(record(PK), { onRadio: true, nowMs: T0 + 120_000, heardLive: false });

    expect(discoveredStore.get(PK)?.last_heard_ms).toBe(T0 + 60_000);
  });

  it('surfaces through the projection as lastHeardMs', () => {
    seed();
    discoveredStore.markHeard(PK, T0 + 7_000);

    const row = discoveredStore.list([]).find((r) => r.publicKeyHex === PK);
    expect(row?.lastHeardMs).toBe(T0 + 7_000);
  });
});
