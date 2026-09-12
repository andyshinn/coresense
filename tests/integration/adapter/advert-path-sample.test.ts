import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProtocolSession } from '../../../src/main/protocol';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { transportManager } from '../../../src/main/transport/manager';
import { makeTestSession, type TestSession } from '../../support/session-harness';

// #45 item 7, the half that makes the column fill in on its own.
//
// The firmware's advert-path table is a 16-entry RAM ring, so asking about a
// contact the user happens to click on is usually a miss. The one moment an
// entry is guaranteed to exist is immediately after we hear that node's advert
// — so that is when we sample it. These tests drive real companion frames
// through the session to prove the command goes out (and, just as importantly,
// when it does not).

const PK = 'e7'.repeat(32);
const STRANGER = 'f8'.repeat(32);

// RESP_CONTACT (0x03) — the 148-byte record a GET_CONTACTS walk streams. Seeds
// both the library's contact map and coresense's mirror.
function contactSyncFrame(pubkeyHex: string, name: string): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = 0x03;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = 1; // type = chat
  frame[35] = 0xff; // out_path_len = OUT_PATH_UNKNOWN
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

// PUSH_NEW_ADVERT (0x8a) — same 148-byte record, but a node we actually heard.
function newAdvertFrame(pubkeyHex: string, name: string): Buffer {
  const frame = contactSyncFrame(pubkeyHex, name);
  frame[0] = 0x8a;
  return frame;
}

// RESP_ADVERT_PATH (0x16): [0x16][recv_timestamp u32 LE][path_len u8][path].
// path_len is the packed byte: bits 5-0 hop count, bits 7-6 hashSize-1 — except
// for the one value below, which is not a length at all. Written raw so a test
// can put the sentinel on the wire.
function advertPathReply(recvUnix: number, pathLenByte: number, pathHex = ''): Buffer {
  const path = Buffer.from(pathHex, 'hex');
  const frame = Buffer.alloc(6 + path.length);
  frame[0] = 0x16;
  frame.writeUInt32LE(recvUnix, 1);
  frame[5] = pathLenByte;
  path.copy(frame, 6);
  return frame;
}

// OUT_PATH_UNKNOWN: "this entry has no path", not a hop count. No path bytes
// follow it, so the frame is a valid six-byte reply.
const PATH_LEN_FLOOD = 0xff;

const advertPathCommands = (s: TestSession) => s.transport.sent.filter((f) => f[0] === 0x2a);

afterEach(() => {
  setProtocolSession(null);
  transportManager.setState('idle');
});

function connected(): TestSession {
  const s = makeTestSession();
  // fetchAdvertPath refuses without a radio, and the sampler calls it through
  // the module-level session seam.
  transportManager.setState('connected');
  setProtocolSession(s.adapter);
  return s;
}

describe('advert-triggered advert-path sampling', () => {
  it('asks the radio for the advert path of a node whose advert just landed', async () => {
    const s = connected();
    s.receive(contactSyncFrame(PK, 'Erin'));

    s.receive(newAdvertFrame(PK, 'Erin'));

    await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));
    // CMD_GET_ADVERT_PATH: [0x2a][reserved][32B pubkey].
    const cmd = Buffer.from(advertPathCommands(s)[0]);
    expect(cmd).toHaveLength(34);
    expect(cmd.subarray(2).toString('hex')).toBe(PK);
  });

  it('persists the reply as inbound hops, leaving the outbound route alone', async () => {
    const s = connected();
    s.receive(contactSyncFrame(PK, 'Erin'));
    s.receive(newAdvertFrame(PK, 'Erin'));
    await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));

    s.receive(advertPathReply(1_760_000_000, 0x02, 'aabb'));

    await vi.waitFor(() => expect(discoveredStore.get(PK)?.observed_hops).toBe(2));
    expect(discoveredStore.get(PK)?.observed_path_hex).toBe('aabb');
    expect(discoveredStore.get(PK)?.observed_at_unix).toBe(1_760_000_000);
    // out_path_len is the LEARNED OUTBOUND route and is not ours to touch.
    expect(discoveredStore.get(PK)?.out_path_len).toBe(0xff);
  });

  // The two frames below are the pair this whole branch turns on. path_len 0x00
  // and path_len 0xFF both carry zero path bytes and both reach us as hops 0
  // with an empty path; only meshcore-ts 0.8.1's `flood` flag separates them.
  // One is the best answer the radio can give and the other is no answer at all,
  // so they are pinned side by side — a fix that keys on the empty path instead
  // of the flag passes one and fails the other.

  it('records a direct reception as 0 hops rather than as unmeasured', async () => {
    const s = connected();
    s.receive(contactSyncFrame(PK, 'Erin'));
    s.receive(newAdvertFrame(PK, 'Erin'));
    await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));

    s.receive(advertPathReply(1_760_000_000, 0x00));

    await vi.waitFor(() => expect(discoveredStore.get(PK)?.observed_hops).toBe(0));
    // A real measurement, so the reception time lands with it. An empty path
    // here means "arrived with no relays", which is exactly why the sentinel
    // below must never be allowed to write one.
    expect(discoveredStore.get(PK)?.observed_path_hex).toBe('');
    expect(discoveredStore.get(PK)?.observed_at_unix).toBe(1_760_000_000);
  });

  // The sentinel means the ring HOLDS this node but cached no path for it.
  // Through 0.7.2 it failed the decoder's length guard and arrived as null, like
  // a miss; 0.8.0 decoded it as a bare `hops: 0`, and this module dutifully filed
  // "heard direct, 0 hops" against nodes it knows no path to — a lie that then
  // won the Hops column and outlived the query in sqlite.
  it('does not record the no-path sentinel as a measurement', async () => {
    const s = connected();
    s.receive(contactSyncFrame(PK, 'Erin'));
    s.receive(newAdvertFrame(PK, 'Erin'));
    await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));

    s.receive(advertPathReply(1_760_000_000, PATH_LEN_FLOOD));
    await new Promise((r) => setTimeout(r, 10));

    const row = discoveredStore.get(PK);
    expect(row?.observed_hops).toBe(-1); // the unmeasured default, untouched
    expect(row?.observed_path_hex).toBe('');
    expect(row?.observed_at_unix).toBe(0);
  });

  // A GET_CONTACTS walk is the radio listing what it stores, not a reception.
  // Sampling there would be one command per contact for an answer that is a miss
  // for all but the 16 most recently heard.
  it('does not sample on a contact-store resync', async () => {
    const s = connected();

    s.receive(contactSyncFrame(PK, 'Erin'));
    await new Promise((r) => setTimeout(r, 10));

    expect(advertPathCommands(s)).toHaveLength(0);
  });

  // The library resolves a contact key through the radio's contact map and
  // throws when it misses, so the pre-check is what keeps a brand-new advert
  // from a node we did not auto-add free.
  it('does not sample a node the radio does not store', async () => {
    const s = connected();

    s.receive(newAdvertFrame(STRANGER, 'Stranger'));
    await new Promise((r) => setTimeout(r, 10));

    expect(advertPathCommands(s)).toHaveLength(0);
    expect(discoveredStore.get(STRANGER)?.observed_hops).toBe(-1);
  });

  it('does not sample while the radio is detached', async () => {
    const s = makeTestSession();
    setProtocolSession(s.adapter);
    transportManager.setState('idle');
    s.receive(contactSyncFrame(PK, 'Erin'));

    s.receive(newAdvertFrame(PK, 'Erin'));
    await new Promise((r) => setTimeout(r, 10));

    expect(advertPathCommands(s)).toHaveLength(0);
  });

  // A radio that never answers must not leave the sampler retrying: the cooldown
  // is armed before the round trip, not after it.
  it('does not re-ask on a second advert inside the cooldown', async () => {
    const s = connected();
    s.receive(contactSyncFrame(PK, 'Erin'));
    s.receive(newAdvertFrame(PK, 'Erin'));
    await vi.waitFor(() => expect(advertPathCommands(s)).toHaveLength(1));
    s.receive(advertPathReply(1_760_000_000, 0x01, 'aa'));
    await vi.waitFor(() => expect(discoveredStore.get(PK)?.observed_hops).toBe(1));

    s.receive(newAdvertFrame(PK, 'Erin'));
    await new Promise((r) => setTimeout(r, 10));

    expect(advertPathCommands(s)).toHaveLength(1);
  });
});
