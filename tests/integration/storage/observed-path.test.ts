import type { Models } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../../src/main/storage/db';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';

// #45 item 7. The Contact Manager's hop count comes from out_path_len — the
// LEARNED OUTBOUND route — while the question a user is asking ("how far away
// is the node I just heard?") is inbound. These columns hold the inbound
// answer, and the tests below are mostly about keeping the two apart.

const PK = 'a1'.repeat(32);
const OTHER = 'b2'.repeat(32);
const T0 = 1_750_000_000_000;
const NO_RULES: never[] = [];

function record(pubkey: string, outPathLen = 0xff): Models.ContactRecord {
  return {
    publicKeyHex: pubkey,
    name: `Node ${pubkey.slice(0, 4)}`,
    type: 1,
    flags: 0,
    outPathLen,
    outPathHex: '',
    lastAdvertUnix: 1_700_000_000,
    gpsLat: 0,
    gpsLon: 0,
    lastmod: 1,
  } as Models.ContactRecord;
}

function seed(pubkey = PK, outPathLen = 0xff): void {
  discoveredStore.upsert(record(pubkey, outPathLen), { onRadio: true, nowMs: T0, heardLive: false });
}

const projected = (pubkey = PK) => discoveredStore.list(NO_RULES).find((d) => d.publicKeyHex === pubkey);
const rowCount = () => (openDb().prepare('SELECT COUNT(*) AS n FROM discovered_contacts').get() as { n: number }).n;

describe('discoveredStore.setObservedPath', () => {
  it('records the radio-reported inbound path and projects it', () => {
    seed();
    expect(discoveredStore.setObservedPath(PK, { hops: 3, pathHex: 'aabbcc', recvUnix: 1_760_000_000 })).toBe(true);

    const d = projected();
    expect(d?.observedHops).toBe(3);
    expect(d?.observedPathHex).toBe('aabbcc');
    expect(d?.observedAtMs).toBe(1_760_000_000_000);
  });

  // The trap the whole feature turns on: 0 hops means the advert arrived
  // direct. Any truthiness test in the projection reports that as "never
  // measured" and the rail silently lies about the closest nodes on the mesh.
  it('round-trips a zero-hop measurement as 0, not as missing', () => {
    seed();
    discoveredStore.setObservedPath(PK, { hops: 0, pathHex: '', recvUnix: 1_760_000_000 });

    const d = projected();
    expect(d?.observedHops).toBe(0);
    expect(d?.observedHops).not.toBeUndefined();
    // An empty path is the correct companion of a direct reception.
    expect(d?.observedPathHex).toBeUndefined();
  });

  it('leaves an unmeasured row undefined rather than reporting -1', () => {
    seed();
    const d = projected();
    expect(d?.observedHops).toBeUndefined();
    expect(d?.observedAtMs).toBeUndefined();
  });

  // UPDATE-only, like markHeard: a reply about a pubkey we have no advert for
  // must not conjure a nameless row into the Contact Manager.
  it('creates nothing for a pubkey with no row', () => {
    seed();
    const before = rowCount();

    expect(discoveredStore.setObservedPath(OTHER, { hops: 1, pathHex: 'aa', recvUnix: 1 })).toBe(false);

    expect(rowCount()).toBe(before);
    expect(discoveredStore.get(OTHER)).toBeNull();
  });

  it('does not touch the outbound route', () => {
    // 0x41 = 2-byte hash mode, 1 hop — a real learned out-path.
    seed(PK, 0x41);
    discoveredStore.setObservedPath(PK, { hops: 4, pathHex: 'ddeeffaa', recvUnix: 1_760_000_000 });

    const row = discoveredStore.get(PK);
    expect(row?.out_path_len).toBe(0x41);
    const d = projected();
    expect(d?.hops).toBe(1); // outbound, from out_path_len
    expect(d?.observedHops).toBe(4); // inbound, from the advert path
  });
});

// The single sharpest regression risk in this change: the observed_* columns
// must appear in the DDL, the Row interface and the projection — and NOWHERE in
// upsert's INSERT or ON CONFLICT DO UPDATE SET lists. Adding them there would
// wipe every measurement on every GET_CONTACTS walk while every other test
// stayed green.
describe('measurements survive the contact write-through', () => {
  it('survives a GET_CONTACTS resync of the same contact', () => {
    seed();
    discoveredStore.setObservedPath(PK, { hops: 2, pathHex: 'aabb', recvUnix: 1_760_000_000 });

    // Exactly what a refresh / handshake walk does to every row it touches.
    discoveredStore.upsert(record(PK), { onRadio: true, nowMs: T0 + 60_000, heardLive: false });

    const d = projected();
    expect(d?.observedHops).toBe(2);
    expect(d?.observedPathHex).toBe('aabb');
    expect(d?.observedAtMs).toBe(1_760_000_000_000);
  });

  it('survives a live advert from the same contact', () => {
    seed();
    discoveredStore.setObservedPath(PK, { hops: 0, pathHex: '', recvUnix: 1_760_000_000 });

    discoveredStore.upsert(record(PK), { onRadio: true, nowMs: T0 + 60_000, heardLive: true });

    // Zero specifically: it is the value an over-eager "reset the column on
    // conflict" would be least likely to be noticed destroying.
    expect(projected()?.observedHops).toBe(0);
  });

  it('survives the flag write-throughs that fire once per contact frame', () => {
    seed();
    discoveredStore.setObservedPath(PK, { hops: 5, pathHex: 'aabbccddee', recvUnix: 1_760_000_000 });

    discoveredStore.applyRadioFlags([{ publicKeyHex: PK, onRadio: true, favourite: true }]);
    discoveredStore.reconcileOnRadio([PK]);
    discoveredStore.setFavourite(PK, false);
    discoveredStore.setOnRadio(PK, true);
    discoveredStore.markHeard(PK, T0 + 90_000);

    expect(projected()?.observedHops).toBe(5);
  });
});

// `changes > 0` is true for ANY existing row, so the "returns true only when a
// row moved" contract — which callers use to decide whether to project the
// whole pool and push it to every websocket client — needs a value guard in the
// WHERE clause to be true at all. It matters most on the advert-triggered path:
// that write lands inside the 1s coalescer window the advert's own write
// already opened, so an unconditional "changed" is a SECOND full-pool broadcast
// for every advert from an on-radio node.
describe('setObservedPath reports a real change only', () => {
  it('is a no-op when the radio repeats the answer it already gave', () => {
    seed();
    const measurement = { hops: 2, pathHex: 'aabb', recvUnix: 1_760_000_000 };
    expect(discoveredStore.setObservedPath(PK, measurement)).toBe(true);

    expect(discoveredStore.setObservedPath(PK, { ...measurement })).toBe(false);
    expect(projected()?.observedHops).toBe(2);
  });

  it('reports a change when any one of the three columns moves', () => {
    seed();
    discoveredStore.setObservedPath(PK, { hops: 2, pathHex: 'aabb', recvUnix: 1_760_000_000 });

    // A newer reception of the same path is still news.
    expect(discoveredStore.setObservedPath(PK, { hops: 2, pathHex: 'aabb', recvUnix: 1_760_000_060 })).toBe(true);
    expect(discoveredStore.setObservedPath(PK, { hops: 3, pathHex: 'aabb', recvUnix: 1_760_000_060 })).toBe(true);
    expect(discoveredStore.setObservedPath(PK, { hops: 3, pathHex: 'aabbcc', recvUnix: 1_760_000_060 })).toBe(true);
  });

  // The first measurement of a node the radio heard direct writes 0 into a
  // column whose "never measured" sentinel is -1 and an empty path into a
  // column whose default is ''. Only the hop count moves, and it has to count.
  it('reports the first zero-hop measurement as a change', () => {
    seed();
    expect(discoveredStore.setObservedPath(PK, { hops: 0, pathHex: '', recvUnix: 0 })).toBe(true);
  });
});
