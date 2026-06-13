import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

const PK = 'aa'.repeat(32);
const RESP_OK = Buffer.from([0x00]);
const RESP_ERR = Buffer.from([0x01, 0x02]); // ERR + NOT_FOUND

describe('outbound misc queries', () => {
  afterEach(() => protocolSession().stop());

  it('hasConnection maps RESP_OK→true and RESP_ERR→false', async () => {
    const fake = new FakeTransport();
    transportManager.setTransport(fake);
    const session = protocolSession();
    session.start();

    const p1 = session.hasConnection(PK);
    expect(fake.sent.at(-1)?.[0]).toBe(0x1c); // CMD_HAS_CONNECTION
    emit.packet(companionPacket(RESP_OK));
    expect(await p1).toBe(true);

    const p2 = session.hasConnection(PK);
    emit.packet(companionPacket(RESP_ERR));
    expect(await p2).toBe(false);
  });

  it('getAllowedRepeatFreq decodes the frequency ranges', async () => {
    const fake = new FakeTransport();
    transportManager.setTransport(fake);
    const session = protocolSession();
    session.start();

    const p = session.getAllowedRepeatFreq();
    expect(fake.sent.at(-1)?.[0]).toBe(0x3c); // CMD_GET_ALLOWED_REPEAT_FREQ
    const frame = Buffer.alloc(9);
    frame[0] = 0x1a;
    frame.writeUInt32LE(902_000_000, 1);
    frame.writeUInt32LE(928_000_000, 5);
    emit.packet(companionPacket(frame));
    expect(await p).toEqual([{ lowerHz: 902_000_000, upperHz: 928_000_000 }]);
  });
});
