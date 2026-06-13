import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import type { Contact } from '../../../src/shared/types';
import { companionPacket } from '../../support/fake-transport';

const PK = 'cc'.repeat(32);

// PUSH_PATH_UPDATED [0x81][pubkey 32B].
function pathUpdated(pubkeyHex: string): Buffer {
  return Buffer.concat([Buffer.from([0x81]), Buffer.from(pubkeyHex, 'hex')]);
}

const contact = (pk: string, lastSeenMs: number): Contact => ({
  key: `c:${pk}`,
  publicKeyHex: pk,
  name: 'Repeater',
  kind: 'repeater',
  lastSeenMs,
});

describe('inbound PUSH_PATH_UPDATED', () => {
  afterEach(() => protocolSession().stop());

  it('touches a known contact last-seen and re-emits contacts', () => {
    stateHolder().upsertContact(contact(PK, 1_000));
    protocolSession().start();

    const emitted: unknown[] = [];
    const onContacts = (c: unknown) => emitted.push(c);
    bus.on('contacts', onContacts);
    try {
      emit.packet(companionPacket(pathUpdated(PK)));
      const updated = stateHolder()
        .getContacts()
        .find((c) => c.key === `c:${PK}`);
      expect(updated?.lastSeenMs).toBeGreaterThan(1_000);
      expect(emitted.length).toBeGreaterThan(0);
    } finally {
      bus.off('contacts', onContacts);
    }
  });

  it('ignores PUSH_PATH_UPDATED for an unknown contact', () => {
    protocolSession().start();
    const emitted: unknown[] = [];
    const onContacts = (c: unknown) => emitted.push(c);
    bus.on('contacts', onContacts);
    try {
      expect(() => emit.packet(companionPacket(pathUpdated('dd'.repeat(32))))).not.toThrow();
      expect(emitted).toHaveLength(0);
    } finally {
      bus.off('contacts', onContacts);
    }
  });
});
