import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { makeTestSession } from '../../support/session-harness';

// meshcore-ts emits a `contactsFull` event for PUSH_CODE_CONTACTS_FULL (0x90);
// the SessionAdapter bridges it to coresense's `errorMessage` bus so the renderer
// shows the "contact store is full" toast (adapterEvents.ts).
describe('PUSH_CONTACTS_FULL handled via the feature registry', () => {
  it('emits a user-facing error when the radio reports its contact store full', async () => {
    const { receive } = makeTestSession();

    const messages: string[] = [];
    const onError = (m: string) => messages.push(m);
    bus.on('errorMessage', onError);

    receive(Buffer.from([0x90])); // PUSH_CODE_CONTACTS_FULL
    await Promise.resolve();
    bus.off('errorMessage', onError);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/contact store is full/i);
  });
});
