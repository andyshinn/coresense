import type { Models } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { countDiscoveredWrites } from '../../support/sql-counter';

// The write counter underpins the "work proportional to N, not N^2" perf guards.
// discoveredStore.reconcileOnRadio and clearDiscoveredOnly mutate the table via
// db.exec(...) rather than a prepared statement, so a counter that only wraps
// db.prepare().run would report them as zero writes — a quadratic regression
// routed through db.exec would slip past the guard unseen.

function record(i: number): Models.ContactRecord {
  return {
    publicKeyHex: i.toString(16).padStart(2, '0').repeat(32),
    name: `Node ${i}`,
    type: 1,
    flags: 0,
    outPathLen: 0xff,
    outPathHex: '',
    lastAdvertUnix: 1_750_000_000 + i,
    gpsLat: 0,
    gpsLon: 0,
    lastmod: i,
  } as Models.ContactRecord;
}

describe('countWritesTo — db.exec coverage', () => {
  it('counts a discovered_contacts write issued through db.exec', () => {
    discoveredStore.upsert(record(0), { onRadio: true, nowMs: 1_750_000_000_000, heardLive: false });

    const counter = countDiscoveredWrites();
    // reconcileOnRadio issues `db.exec('UPDATE discovered_contacts SET on_radio = 0')`.
    discoveredStore.reconcileOnRadio([]);
    counter.restore();

    expect(counter.count).toBe(1);
  });
});
