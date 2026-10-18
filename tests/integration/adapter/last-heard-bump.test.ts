import { describe, expect, it } from 'vitest';
import { openDb } from '../../../src/main/storage/db';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { messagesStore } from '../../../src/main/storage/messages';
import {
  channelMsgV3,
  contactMsgV3,
  contactSyncFrame,
  statusResponse,
  telemetryResponse,
} from '../../support/companionFrames';
import { makeTestSession } from '../../support/session-harness';

// #45 item 9: `last_heard_ms` is our-clock "when did we last actually receive
// something from this node". Only the advert path wrote it, so a contact we DM
// every day showed "never". These tests pin down which receptions move it — and
// just as importantly, which must not.

const PK = 'cc'.repeat(32);
const PREFIX = 'cccccccccccc'; // first 6 bytes of PK
const STRANGER = 'dd'.repeat(32);

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

    receive(contactMsgV3(PREFIX, 1_700_000_000, 'hello'));

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

    receive(channelMsgV3(0, 1_700_000_100, 'Carol: hi all'));

    expect(messagesStore.byKey('ch:General')).toHaveLength(1);
    expect(heard()).toBe(0);
  });

  // A DM whose sender the radio doesn't store resolves only to a 6-byte prefix.
  // That is not an identity we can write against, and it must not synthesise a
  // nameless row into the Contact Manager.
  it('creates no row for a DM from a pubkey we have no record of', () => {
    const { receive } = seeded();
    const before = rowCount();

    receive(contactMsgV3('ffeeddccbbaa', 1_700_000_200, 'who am i'));

    expect(rowCount()).toBe(before);
    expect(heard(STRANGER)).toBeNull();
  });

  it('leaves other contacts alone', () => {
    const { receive } = seeded();
    receive(contactSyncFrame(STRANGER, 'Dave'));

    receive(contactMsgV3(PREFIX, 1_700_000_300, 'hi'));

    expect(heard()).toBeGreaterThan(0);
    expect(heard(STRANGER)).toBe(0);
  });
});
