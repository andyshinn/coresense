import { Buffer } from 'node:buffer';
import { Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import type { Contact } from '../../../src/shared/types';
import { captureBus } from '../../support/bus';
import { makeTestSession } from '../../support/session-harness';

const PK = 'bb'.repeat(32);

const contact = (pk: string): Contact => ({
  key: `c:${pk}`,
  publicKeyHex: pk,
  name: 'Bob',
  kind: 'chat',
});

// PUSH_CONTACT_DELETED: [0x8f][pubkey 32B].
function contactDeletedFrame(pubkeyHex: string): Buffer {
  return Buffer.concat([Buffer.from([Protocol.PUSH.CONTACT_DELETED]), Buffer.from(pubkeyHex, 'hex')]);
}

describe('inbound PUSH_CONTACT_DELETED', () => {
  it('removes the contact and emits contactEvicted with its name', () => {
    const { adapter, receive } = makeTestSession();
    // Seed the lib's contact store so the eviction handler can resolve the
    // display name for the toast before dropping the contact.
    adapter.session.state.upsertContact(contact(PK));

    const evicted = captureBus('contactEvicted');

    receive(contactDeletedFrame(PK));

    expect(evicted.values).toEqual(['Bob']);
  });
});
