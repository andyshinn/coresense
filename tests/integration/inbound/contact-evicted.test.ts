import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import type { Contact } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

const PK = 'bb'.repeat(32);

const contact = (pk: string): Contact => ({
  key: `c:${pk}`,
  publicKeyHex: pk,
  name: 'Bob',
  kind: 'chat',
});

function contactDeletedFrame(pubkeyHex: string): Buffer {
  const frame = Buffer.alloc(1 + 32);
  frame[0] = 0x8f; // PUSH_CODE_CONTACT_DELETED
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  return frame;
}

describe('inbound PUSH_CONTACT_DELETED', () => {
  it('removes the contact and emits contactEvicted with its name', () => {
    const { adapter, receive } = makeTestSession();
    // Seed the lib's contact store so the eviction handler can resolve the
    // display name for the toast before dropping the contact.
    adapter.session.state.upsertContact(contact(PK));

    const evicted: string[] = [];
    bus.on('contactEvicted', (name: string) => evicted.push(name));

    receive(contactDeletedFrame(PK));

    expect(evicted).toEqual(['Bob']);
  });
});
