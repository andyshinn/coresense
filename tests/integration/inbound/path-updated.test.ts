import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import type { Contact } from '../../../src/shared/types';
import { captureBus } from '../../support/bus';
import { makeTestSession } from '../../support/session-harness';

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
  it('touches a known contact last-seen and re-emits contacts', () => {
    const { adapter, receive } = makeTestSession();
    // Seed the lib's contact store so the PUSH_PATH_UPDATED handler resolves a
    // known contact; the lib's `contacts` event then flows into coresense's holder.
    adapter.session.state.upsertContact(contact(PK, 1_000));

    const emitted = captureBus('contacts');
    receive(pathUpdated(PK));
    const updated = stateHolder()
      .getContacts()
      .find((c) => c.key === `c:${PK}`);
    expect(updated?.lastSeenMs).toBeGreaterThan(1_000);
    expect(emitted.calls.length).toBeGreaterThan(0);
  });

  it('ignores PUSH_PATH_UPDATED for an unknown contact', () => {
    const { receive } = makeTestSession();
    const emitted = captureBus('contacts');
    expect(() => receive(pathUpdated('dd'.repeat(32)))).not.toThrow();
    expect(emitted.calls).toHaveLength(0);
  });
});
