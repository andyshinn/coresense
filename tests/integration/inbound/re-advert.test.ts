import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import type { Contact } from '../../../src/shared/types';
import { companionPacket } from '../../support/fake-transport';

const PK = 'aa'.repeat(32);

// PUSH_ADVERT: [0x80][pubkey 32B] — a known contact re-advertised.
function advert(pubkeyHex: string): Buffer {
  return Buffer.concat([Buffer.from([0x80]), Buffer.from(pubkeyHex, 'hex')]);
}

const contact = (pk: string, lastSeenMs: number): Contact => ({
  key: `c:${pk}`,
  publicKeyHex: pk,
  name: 'Bob',
  kind: 'chat',
  lastSeenMs,
});

describe('inbound PUSH_ADVERT (known contact re-advert)', () => {
  afterEach(() => protocolSession().stop());

  it('touches a known contact last-seen and re-emits contacts', () => {
    stateHolder().upsertContact(contact(PK, 1_000));
    const session = protocolSession();
    session.start();

    const emitted: Array<Array<{ key: string }>> = [];
    const onContacts = (c: Array<{ key: string }>) => emitted.push(c);
    bus.on('contacts', onContacts);
    try {
      emit.packet(companionPacket(advert(PK)));
      const updated = stateHolder()
        .getContacts()
        .find((c) => c.key === `c:${PK}`);
      expect(updated?.lastSeenMs).toBeGreaterThan(1_000);
      expect(emitted.length).toBeGreaterThan(0);
    } finally {
      bus.off('contacts', onContacts);
    }
  });

  it('ignores a re-advert for an unknown contact', () => {
    const session = protocolSession();
    session.start();

    const emitted: unknown[] = [];
    const onContacts = (c: unknown) => emitted.push(c);
    bus.on('contacts', onContacts);
    try {
      expect(() => emit.packet(companionPacket(advert('bb'.repeat(32))))).not.toThrow();
      expect(emitted).toHaveLength(0);
    } finally {
      bus.off('contacts', onContacts);
    }
  });
});
