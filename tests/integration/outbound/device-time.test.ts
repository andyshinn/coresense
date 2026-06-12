import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { ProtocolError } from '../../../src/main/protocol/errors';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

describe('device time round-trips', () => {
  afterEach(() => protocolSession().stop());

  it('getDeviceTime sends [0x05] and resolves RESP_CURR_TIME', async () => {
    const session = protocolSession();
    session.start();
    const transport = new FakeTransport();
    transportManager.setTransport(transport);

    const p = session.getDeviceTime();
    await Promise.resolve();
    expect(transport.sent[0]?.toString('hex')).toBe('05');
    emit.packet(companionPacket(Buffer.from([0x09, 0x04, 0x03, 0x02, 0x01]))); // RESP_CURR_TIME
    await expect(p).resolves.toBe(0x01020304);
  });

  it('setDeviceTime resolves on RESP_OK', async () => {
    const session = protocolSession();
    session.start();
    transportManager.setTransport(new FakeTransport());

    const p = session.setDeviceTime(1_700_000_000);
    await Promise.resolve();
    emit.packet(companionPacket(Buffer.from([0x00]))); // RESP_OK
    await expect(p).resolves.toBeUndefined();
  });

  it('setDeviceTime rejects with ProtocolError on RESP_ERR[ILLEGAL_ARG]', async () => {
    const session = protocolSession();
    session.start();
    transportManager.setTransport(new FakeTransport());

    const p = session.setDeviceTime(1);
    await Promise.resolve();
    emit.packet(companionPacket(Buffer.from([0x01, 0x06]))); // RESP_ERR + ERR_CODE_ILLEGAL_ARG
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ProtocolError);
    expect((err as ProtocolError).errorCode).toBe(0x06);
  });
});
