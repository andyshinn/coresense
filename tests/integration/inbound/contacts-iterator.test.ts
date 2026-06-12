import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { companionPacket } from '../../support/fake-transport';

// RESP_CONTACT (0x03) carries a full 148-byte record (same layout as
// PUSH_NEW_ADVERT, only the code byte differs).
function contactFrame(pubkeyHex: string, name: string): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = 0x03;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = 1; // type = chat
  frame[35] = 0xff; // out_path_len = direct
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

const startFrame = (total: number) => {
  const f = Buffer.alloc(5);
  f[0] = 0x02; // RESP_CONTACTS_START
  f.writeUInt32LE(total, 1);
  return f;
};
const endFrame = Buffer.from([0x04, 0x00, 0x00, 0x00, 0x00]); // RESP_END_OF_CONTACTS

describe('inbound contacts iterator via the feature registry + contactsSync bridge', () => {
  afterEach(() => protocolSession().stop());

  it('drives syncProgress 0/2 → 1/2 → 2/2 → 2/2 and surfaces both contacts', () => {
    const session = protocolSession();
    session.start();

    const progress: Array<{ done: number; total: number }> = [];
    const onProgress = (p: { contacts: { done: number; total: number } }) =>
      progress.push({ ...p.contacts });
    bus.on('syncProgress', onProgress);
    let lastContacts: Array<{ key: string }> = [];
    const onContacts = (c: Array<{ key: string }>) => {
      lastContacts = c;
    };
    bus.on('contacts', onContacts);

    const pkA = 'a1'.repeat(32);
    const pkB = 'b2'.repeat(32);

    emit.packet(companionPacket(startFrame(2)));
    emit.packet(companionPacket(contactFrame(pkA, 'Alice')));
    emit.packet(companionPacket(contactFrame(pkB, 'Bob')));
    emit.packet(companionPacket(endFrame));

    bus.off('syncProgress', onProgress);
    bus.off('contacts', onContacts);

    // The contactsSync bridge must reproduce the legacy handler's progress
    // transitions exactly: start(0/total) → per-contact(done/total) → end-snap.
    expect(progress).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
      { done: 2, total: 2 },
    ]);
    const keys = lastContacts.map((c) => c.key);
    expect(keys).toContain(`c:${pkA}`);
    expect(keys).toContain(`c:${pkB}`);
  });

  it('self-heals when more contacts arrive than CONTACTS_START promised', () => {
    const session = protocolSession();
    session.start();

    const progress: Array<{ done: number; total: number }> = [];
    const onProgress = (p: { contacts: { done: number; total: number } }) =>
      progress.push({ ...p.contacts });
    bus.on('syncProgress', onProgress);

    emit.packet(companionPacket(startFrame(1))); // radio promises 1
    emit.packet(companionPacket(contactFrame('a1'.repeat(32), 'Alice')));
    emit.packet(companionPacket(contactFrame('b2'.repeat(32), 'Bob'))); // but sends 2
    emit.packet(companionPacket(endFrame));

    bus.off('syncProgress', onProgress);

    // total bumps to 2 once count exceeds the promised 1 — never "2/1".
    expect(progress).toEqual([
      { done: 0, total: 1 },
      { done: 1, total: 1 },
      { done: 2, total: 2 },
      { done: 2, total: 2 },
    ]);
  });
});
