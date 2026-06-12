import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { companionPacket } from '../../support/fake-transport';

describe('PUSH_CONTACTS_FULL handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('emits a user-facing error when the radio reports its contact store full', async () => {
    const session = protocolSession();
    session.start();

    const messages: string[] = [];
    const onError = (m: string) => messages.push(m);
    bus.on('errorMessage', onError);

    emit.packet(companionPacket(Buffer.from([0x90]))); // PUSH_CODE_CONTACTS_FULL
    await Promise.resolve();
    bus.off('errorMessage', onError);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/contact store is full/i);
  });
});
