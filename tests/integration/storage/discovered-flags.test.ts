import type { Models } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { countDiscoveredWrites } from '../../support/sql-counter';

// The lib re-sends its whole discovered pool on every contact frame, so the
// write-through has to be cheap to REPEAT: applying the same flags twice must
// not touch sqlite the second time.

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

function seed(n: number): void {
  for (let i = 0; i < n; i++) {
    discoveredStore.upsert(record(i), { onRadio: false, nowMs: 1_750_000_000_000, heardLive: false });
  }
}

const flagsFor = (n: number, onRadio: boolean, favourite: boolean) =>
  Array.from({ length: n }, (_, i) => ({
    publicKeyHex: record(i).publicKeyHex,
    onRadio,
    favourite,
  }));

describe('discoveredStore.applyRadioFlags', () => {
  it('writes on_radio and favourite through for every row', () => {
    seed(3);

    discoveredStore.applyRadioFlags(flagsFor(3, true, true));

    for (let i = 0; i < 3; i++) {
      const row = discoveredStore.get(record(i).publicKeyHex);
      expect(row?.on_radio).toBe(1);
      expect(row?.favourite).toBe(1);
      // Bit 0 of flags mirrors favourite, as setFavourite maintains.
      expect((row?.flags ?? 0) & 1).toBe(1);
    }
  });

  it('does not touch sqlite when re-applying flags that already match', () => {
    seed(20);
    discoveredStore.applyRadioFlags(flagsFor(20, true, false));

    const counter = countDiscoveredWrites();
    discoveredStore.applyRadioFlags(flagsFor(20, true, false));
    discoveredStore.applyRadioFlags(flagsFor(20, true, false));
    counter.restore();

    expect(counter.count).toBe(0);
  });

  it('writes only the rows whose flags actually changed', () => {
    seed(20);
    discoveredStore.applyRadioFlags(flagsFor(20, true, false));

    const next = flagsFor(20, true, false);
    next[7] = { ...next[7], favourite: true };

    const counter = countDiscoveredWrites();
    discoveredStore.applyRadioFlags(next);
    counter.restore();

    expect(counter.count).toBe(1);
    expect(discoveredStore.get(record(7).publicKeyHex)?.favourite).toBe(1);
  });

  it('re-writes a row after another code path changed its flags', () => {
    seed(2);
    discoveredStore.applyRadioFlags(flagsFor(2, true, false));

    // A direct write must invalidate whatever applyRadioFlags cached, or the
    // next pass would wrongly consider the row already up to date.
    discoveredStore.setOnRadio(record(0).publicKeyHex, false);
    discoveredStore.applyRadioFlags(flagsFor(2, true, false));

    expect(discoveredStore.get(record(0).publicKeyHex)?.on_radio).toBe(1);
  });

  it('re-writes a row after it was removed and re-discovered', () => {
    seed(1);
    discoveredStore.applyRadioFlags(flagsFor(1, true, true));

    discoveredStore.remove(record(0).publicKeyHex);
    discoveredStore.upsert(record(0), { onRadio: false, nowMs: 1_750_000_000_000, heardLive: false });
    discoveredStore.applyRadioFlags(flagsFor(1, true, true));

    expect(discoveredStore.get(record(0).publicKeyHex)?.on_radio).toBe(1);
    expect(discoveredStore.get(record(0).publicKeyHex)?.favourite).toBe(1);
  });

  it('is a no-op for an empty list', () => {
    seed(1);
    expect(() => discoveredStore.applyRadioFlags([])).not.toThrow();
  });
});
