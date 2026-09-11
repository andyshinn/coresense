import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../../src/main/storage/db';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { messagesStore } from '../../../src/main/storage/messages';
import { makeTestSession } from '../../support/session-harness';

// #45 item 9: `last_heard_ms` is our-clock "when did we last actually receive
// something from this node". Only the advert path wrote it, so a contact we DM
// every day showed "never". These tests pin down which receptions move it — and
// just as importantly, which must not.

const PK = 'cc'.repeat(32);
const PREFIX = 'cccccccccccc'; // first 6 bytes of PK
const STRANGER = 'dd'.repeat(32);

// RESP_CONTACT (0x03) — the 148-byte record the radio streams during a
// GET_CONTACTS walk. Seeds both the lib's contact map and coresense's mirror.
function contactSyncFrame(pubkeyHex: string, name: string): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = 0x03;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = 1; // type = chat
  frame[35] = 0xff; // out_path_len = OUT_PATH_UNKNOWN
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

// RESP_CONTACT_MSG_RECV_V3 (0x10): [0x10][snr*4 i8][rsv][rsv][6B sender prefix]
// [path_len][txt_type][ts u32 LE][body].
function dmFrame(prefixHex: string, ts: number, body: string): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(16 + text.length);
  frame[0] = 0x10;
  frame.writeInt8(40, 1);
  Buffer.from(prefixHex, 'hex').copy(frame, 4);
  frame[10] = 0xff;
  frame[11] = 0; // txt_type = plain
  frame.writeUInt32LE(ts, 12);
  text.copy(frame, 16);
  return frame;
}

// RESP_CHANNEL_MSG_RECV_V3 (0x11): [0x11][snr*4 i8][rsv][rsv][idx][path_len]
// [txt_type][ts u32 LE][body].
function channelFrame(idx: number, ts: number, body: string): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(11 + text.length);
  frame[0] = 0x11;
  frame.writeInt8(40, 1);
  frame[4] = idx;
  frame[5] = 0xff;
  frame[6] = 0;
  frame.writeUInt32LE(ts, 7);
  text.copy(frame, 11);
  return frame;
}

// PUSH_STATUS_RESPONSE: [0x87][0][6B prefix][stats…].
function statusResponse(prefixHex: string): Buffer {
  const stats = Buffer.alloc(8);
  stats.writeUInt32LE(4020, 0);
  stats.writeUInt32LE(2, 4);
  return Buffer.concat([Buffer.from([0x87, 0x00]), Buffer.from(prefixHex, 'hex'), stats]);
}

// PUSH_TELEMETRY_RESPONSE: [0x8b][0][6B prefix][CayenneLPP].
function telemetryResponse(prefixHex: string): Buffer {
  return Buffer.concat([Buffer.from([0x8b, 0x00]), Buffer.from(prefixHex, 'hex'), Buffer.from([0x00, 0x74, 0x01, 0xa4])]);
}

const heard = (pk = PK) => discoveredStore.get(pk)?.last_heard_ms ?? null;
const rowCount = () => (openDb().prepare('SELECT COUNT(*) AS n FROM discovered_contacts').get() as { n: number }).n;

function seeded() {
  const s = makeTestSession();
  s.receive(contactSyncFrame(PK, 'Carol'));
  // A resync is not a reception — the column starts at 0 even though the row
  // now exists and is on the radio.
  expect(discoveredStore.get(PK)?.on_radio).toBe(1);
  expect(heard()).toBe(0);
  return s;
}

describe('last-heard bumps from receipt paths', () => {
  it('bumps on an inbound DM', () => {
    const { receive } = seeded();
    const before = Date.now();

    receive(dmFrame(PREFIX, 1_700_000_000, 'hello'));

    expect(messagesStore.byKey(`c:${PK}`)).toHaveLength(1);
    expect(heard()).toBeGreaterThanOrEqual(before);
  });

  it('bumps on a repeater status push', () => {
    const { receive } = seeded();
    const before = Date.now();

    receive(statusResponse(PREFIX));

    expect(heard()).toBeGreaterThanOrEqual(before);
  });

  it('bumps on a repeater telemetry push', () => {
    const { receive } = seeded();
    const before = Date.now();

    receive(telemetryResponse(PREFIX));

    expect(heard()).toBeGreaterThanOrEqual(before);
  });

  // The lib emits pathLearned only after a multi-attempt DM retry actually
  // installs a new out_path, which no single injected frame can produce — so
  // drive the event itself. What is under test is coresense's wiring, not the
  // library's trigger.
  it('bumps on a learned path (a completed round trip)', () => {
    const { adapter } = seeded();
    const before = Date.now();

    adapter.session.events.emit('pathLearned', {
      contactKey: `c:${PK}`,
      newOutPathHex: 'aabb',
      newOutPathHashSize: 2,
      previousOutPathHex: '',
      previousManual: false,
      learnedAt: before,
    });

    expect(heard()).toBeGreaterThanOrEqual(before);
  });

  // An ack is the one send-side transition that is a genuine reception: the
  // peer's ACK packet reached our radio. Reaching it through frames needs the
  // whole send + RESP_SENT + PUSH_MSG_ACK FIFO, so the event is driven directly.
  it('bumps when one of our DMs is acked', () => {
    const { adapter } = seeded();
    const before = Date.now();
    messagesStore.insert({ id: 'm1', key: `c:${PK}`, body: 'ping', ts: before, state: 'sent' });

    adapter.session.events.emit('messageState', 'm1', 'ack');

    expect(heard()).toBeGreaterThanOrEqual(before);
  });

  it('does NOT bump when our own DM merely reaches the radio', () => {
    const { adapter } = seeded();
    messagesStore.insert({ id: 'm2', key: `c:${PK}`, body: 'ping', ts: Date.now(), state: 'sending' });

    // 'sent' means our radio wrote the packet out. Nothing came back.
    adapter.session.events.emit('messageState', 'm2', 'sent');
    adapter.session.events.emit('messageState', 'm2', 'failed');

    expect(heard()).toBe(0);
  });

  // A channel post identifies its sender only as `name:<n>` — there is no
  // pubkey to attribute the reception to, and matching on the advert name can
  // land on the wrong node.
  it('does NOT bump on a channel post', () => {
    const { adapter, receive } = seeded();
    adapter.session.markChannelPresent({ key: 'ch:General', name: 'General', kind: 'public', idx: 0 });

    receive(channelFrame(0, 1_700_000_100, 'Carol: hi all'));

    expect(messagesStore.byKey('ch:General')).toHaveLength(1);
    expect(heard()).toBe(0);
  });

  // A DM whose sender the radio doesn't store resolves only to a 6-byte prefix.
  // That is not an identity we can write against, and it must not synthesise a
  // nameless row into the Contact Manager.
  it('creates no row for a DM from a pubkey we have no record of', () => {
    const { receive } = seeded();
    const before = rowCount();

    receive(dmFrame('ffeeddccbbaa', 1_700_000_200, 'who am i'));

    expect(rowCount()).toBe(before);
    expect(heard(STRANGER)).toBeNull();
  });

  it('leaves other contacts alone', () => {
    const { receive } = seeded();
    receive(contactSyncFrame(STRANGER, 'Dave'));

    receive(dmFrame(PREFIX, 1_700_000_300, 'hi'));

    expect(heard()).toBeGreaterThan(0);
    expect(heard(STRANGER)).toBe(0);
  });
});
