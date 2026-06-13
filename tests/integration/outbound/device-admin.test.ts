import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { FeatureDisabledError, ProtocolError } from '../../../src/main/protocol/errors';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

const KEY = 'ab'.repeat(64); // 64-byte ed25519 expanded private key
const RESP_OK = Buffer.from([0x00]);
const RESP_DISABLED = Buffer.from([0x0f]);

function attach(): FakeTransport {
  const fake = new FakeTransport();
  transportManager.setTransport(fake);
  protocolSession().start();
  return fake;
}

describe('outbound device admin', () => {
  afterEach(() => protocolSession().stop());

  it('exportPrivateKey resolves with the 64-byte key from RESP_PRIVATE_KEY', async () => {
    const fake = attach();

    const p = protocolSession().exportPrivateKey();
    expect(fake.sent.at(-1)?.[0]).toBe(0x17); // CMD_EXPORT_PRIVATE_KEY (bare)
    expect(fake.sent.at(-1)?.length).toBe(1);

    const reply = Buffer.concat([Buffer.from([0x0e]), Buffer.from(KEY, 'hex')]);
    emit.packet(companionPacket(reply));
    expect(await p).toBe(KEY);
  });

  it('exportPrivateKey rejects FeatureDisabledError on RESP_DISABLED', async () => {
    attach();
    const p = protocolSession().exportPrivateKey();
    emit.packet(companionPacket(RESP_DISABLED));
    await expect(p).rejects.toBeInstanceOf(FeatureDisabledError);
  });

  it('importPrivateKey writes the 65-byte frame and resolves on RESP_OK', async () => {
    const fake = attach();
    const p = protocolSession().importPrivateKey(KEY);
    const sent = fake.sent.at(-1);
    expect(sent?.[0]).toBe(0x18); // CMD_IMPORT_PRIVATE_KEY
    expect(sent?.length).toBe(65);
    expect(sent?.subarray(1).toString('hex')).toBe(KEY);
    emit.packet(companionPacket(RESP_OK));
    await expect(p).resolves.toBeUndefined();
  });

  it('importPrivateKey rejects ProtocolError on RESP_ERR', async () => {
    attach();
    const p = protocolSession().importPrivateKey(KEY);
    emit.packet(companionPacket(Buffer.from([0x01, 0x06]))); // ERR + ILLEGAL_ARG
    await expect(p).rejects.toBeInstanceOf(ProtocolError);
  });

  it('setDevicePin writes [0x25][pin u32 LE] and resolves on RESP_OK', async () => {
    const fake = attach();
    const p = protocolSession().setDevicePin(123456);
    expect(fake.sent.at(-1)?.toString('hex')).toBe('2540e20100');
    emit.packet(companionPacket(RESP_OK));
    await expect(p).resolves.toBeUndefined();
  });

  it('factoryReset writes [0x33]"reset" and is fire-and-forget', async () => {
    const fake = attach();
    await protocolSession().factoryReset();
    expect(fake.sent.at(-1)?.toString('hex')).toBe('337265736574');
  });
});
