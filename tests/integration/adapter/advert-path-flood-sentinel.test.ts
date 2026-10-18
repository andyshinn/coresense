import { Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it, vi } from 'vitest';
import { fetchAdvertPath } from '../../../src/main/state/advertPath';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { formatHopsCell, formatObservedHops } from '../../../src/shared/contacts/discovered';
import { advertPathReply, contactSyncFrame, newAdvertFrame, OUT_PATH_UNKNOWN } from '../../support/companionFrames';
import { makeTestSession, type TestSession } from '../../support/session-harness';

// The #45 flood-sentinel defect, pinned from the bytes the firmware puts on the
// wire all the way out to the string the Contact Manager's Hops column renders.
//
// advert-path-sample.test.ts already pins the sqlite half of the 0xFF / 0x00
// pair. This file exists because the defect was never really about a column in
// a table: it was about a node we know NO path to being displayed as "0 hops
// in" — as our nearest possible neighbour — so the assertion that actually
// matters is on the rendered cell, produced from a row that a real
// RESP_ADVERT_PATH frame wrote, through the same list() the IPC layer serves.
//
// It also mints its reception times from the clock. The sibling file's fixed
// 1_760_000_000 is now well outside MAX_OBSERVED_HEARD_AGE_MS, so every
// last-heard in it is rejected on age before the sentinel branch matters — it
// cannot see what the sentinel does to last_heard_ms. Here that path is live.

const PK = 'a3'.repeat(32);

/** OUT_PATH_UNKNOWN in the path_len slot: "this ring entry has no path". Not a
 *  hop count, and no path bytes follow — so on the wire the frame is byte-for-
 *  byte identical to a direct reception apart from this one value. */
const PATH_LEN_FLOOD = OUT_PATH_UNKNOWN;
/** A real zero-hop measurement. Also zero path bytes. */
const PATH_LEN_DIRECT = 0x00;

/** Old enough to be believable, recent enough to survive MAX_OBSERVED_HEARD_AGE_MS. */
const recentUnix = () => Math.floor(Date.now() / 1000) - 600;

const advertPathCommands = (s: TestSession) => s.sentWithCode(Protocol.CMD.GET_ADVERT_PATH);

/** The row as the Contact Manager sees it — through the same list() the IPC
 *  layer serves, never a hand-built object. */
function managerRow() {
  const row = discoveredStore.list([]).find((c) => c.publicKeyHex === PK);
  if (!row) throw new Error('contact missing from the discovered list');
  return row;
}

/** A connected session with Erin in the radio's contact map (so
 *  hasRadioContact passes) and in our mirror (so markHeard, which is
 *  UPDATE-only, has a row to move), and nothing else. A GET_CONTACTS record is
 *  not a reception, so last_heard_ms is 0 — a clean baseline. */
function seeded(): TestSession {
  const s = makeTestSession({ connected: true, installAsProtocolSession: true });
  s.receive(contactSyncFrame(PK, 'Erin'));
  return s;
}

describe('RESP_ADVERT_PATH flood sentinel, wire to rendered cell', () => {
  // The advert-triggered route — how the column actually fills in on a live
  // mesh, and the route the defect shipped on.
  it('path_len 0xFF after an advert records no measurement and never renders "0 hops in"', async () => {
    const s = seeded();
    s.receive(newAdvertFrame(PK, 'Erin'));
    await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));

    s.receive(advertPathReply(recentUnix(), PATH_LEN_FLOOD));
    await new Promise((r) => setTimeout(r, 20));

    // Nothing is persisted as a measurement.
    const row = discoveredStore.get(PK);
    expect(row?.observed_hops).toBe(-1); // the unmeasured default, untouched
    expect(row?.observed_path_hex).toBe('');
    expect(row?.observed_at_unix).toBe(0);

    // And the cell falls back to the OUTBOUND state. This is the assertion the
    // whole branch is for: the defect rendered "0 hops in" here, for a node
    // whose path we do not know at all.
    const c = managerRow();
    expect(c.observedHops).toBeUndefined();
    expect(formatHopsCell(c)).toBe('Flood');
    expect(formatHopsCell(c)).not.toBe('0 hops in');
    // The rail's labelled inbound reading, for the same reason.
    expect(formatObservedHops(c.observedHops)).toBe('not measured');
  });

  it('path_len 0x00 on the same wire shape still records a real direct reception', async () => {
    const s = seeded();
    s.receive(newAdvertFrame(PK, 'Erin'));
    await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));
    const recvUnix = recentUnix();

    s.receive(advertPathReply(recvUnix, PATH_LEN_DIRECT));
    await vi.waitFor(() => expect(discoveredStore.get(PK)?.observed_hops).toBe(0));

    const row = discoveredStore.get(PK);
    expect(row?.observed_path_hex).toBe(''); // no relays, so no path bytes
    expect(row?.observed_at_unix).toBe(recvUnix);

    // Here "0 hops in" is the truth, so the case above cannot have been bought
    // by suppressing zero, or by keying on the empty path both frames carry.
    const c = managerRow();
    expect(c.observedHops).toBe(0);
    expect(formatHopsCell(c)).toBe('0 hops in');
  });

  // Asked through fetchAdvertPath rather than the advert sampler, because a
  // PUSH_NEW_ADVERT is itself a live reception and slams last_heard_ms to
  // Date.now() before the reply ever lands — after which markHeard, being
  // monotonic, could not move it backwards whatever this code did. Seeding with
  // a GET_CONTACTS record only (last_heard_ms = 0) is the one way to see the
  // adoption itself.
  describe('the reception time it carries', () => {
    it('IS adopted as a last-heard even from the sentinel, by design', async () => {
      const s = seeded();
      await new Promise((r) => setTimeout(r, 10));
      expect(discoveredStore.get(PK)?.last_heard_ms).toBe(0); // a walk is not a reception
      const recvUnix = recentUnix();

      const pending = fetchAdvertPath(PK, { force: true });
      await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));
      s.receive(advertPathReply(recvUnix, PATH_LEN_FLOOD));

      // Its own status: the ring HOLDS this node, it just cached no path for
      // it. Distinct from `notCached`, which is "nothing about this node at
      // all", and only distinguishable at all since meshcore-ts 0.8.1.
      expect(await pending).toEqual({ status: 'noPath', recvUnix });

      // The hop columns stay untouched...
      expect(discoveredStore.get(PK)?.observed_hops).toBe(-1);
      expect(discoveredStore.get(PK)?.observed_at_unix).toBe(0);
      // ...but the reception is real, and is frequently the only proof we will
      // ever get that this node was heard (the radio hears adverts while we are
      // detached, and a contact walk never advances the column). The sentinel
      // is silent about the PATH, not about the RECEPTION, so refusing its
      // timestamp would discard firmware-authoritative evidence for a reason
      // that has nothing to do with reception.
      expect(discoveredStore.get(PK)?.last_heard_ms).toBe(recvUnix * 1000);
    });

    it('is still range-checked: an unset radio RTC moves nothing', async () => {
      const s = seeded();
      const pending = fetchAdvertPath(PK, { force: true });
      await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));
      // Near the epoch — a radio whose clock was never set. Far outside
      // MAX_OBSERVED_HEARD_AGE_MS.
      s.receive(advertPathReply(1_000, PATH_LEN_FLOOD));
      await pending;

      expect(discoveredStore.get(PK)?.last_heard_ms).toBe(0);
    });
  });

  // The two replies differ in ONE byte and carry zero path bytes each, so
  // neither `pathHex === ''` nor `hops === 0` can separate them — only the
  // library's 0.8.1 `flood` flag can. Asserted directly so that if the link
  // ever regresses to a build without the flag, this fails with the reason
  // rather than as a mysterious row diff three files away.
  it('the sentinel is separable from a direct reception only by the library flag', async () => {
    const s = seeded();

    const pendingFlood = s.adapter.getAdvertPath(`c:${PK}`);
    s.receive(advertPathReply(1_760_000_000, PATH_LEN_FLOOD));
    const flood = await pendingFlood;

    const pendingDirect = s.adapter.getAdvertPath(`c:${PK}`);
    s.receive(advertPathReply(1_760_000_000, PATH_LEN_DIRECT));
    const direct = await pendingDirect;

    // Identical in everything the wire could tell us...
    expect(flood?.hops).toBe(0);
    expect(direct?.hops).toBe(0);
    expect(flood?.pathHex).toBe('');
    expect(direct?.pathHex).toBe('');
    // ...and separated by exactly one flag.
    expect(flood?.flood).toBe(true);
    expect(direct?.flood).toBeUndefined();
  });
});
