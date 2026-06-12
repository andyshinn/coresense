import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

const RESP_OK = Buffer.from([0x00]);

function respDefaultScope(name: string, keyByte: number): Buffer {
  const f = Buffer.alloc(48);
  f[0] = 0x1c;
  Buffer.from(name, 'utf8').copy(f, 1);
  Buffer.alloc(16, keyByte).copy(f, 32);
  return f;
}

describe('outbound flood scope', () => {
  afterEach(() => protocolSession().stop());

  it('setFloodScopeKey writes [0x36][0x00][16B key] and resolves on RESP_OK', async () => {
    const fake = new FakeTransport();
    transportManager.setTransport(fake);
    const session = protocolSession();
    session.start();

    const p = session.setFloodScopeKey({ keyHex: 'aa'.repeat(16) });
    expect(fake.sent.at(-1)?.toString('hex')).toBe(`3600${'aa'.repeat(16)}`);
    emit.packet(companionPacket(RESP_OK));
    await expect(p).resolves.toBeUndefined();
  });

  it('getDefaultFloodScope decodes the 48-byte set form', async () => {
    const fake = new FakeTransport();
    transportManager.setTransport(fake);
    const session = protocolSession();
    session.start();

    const p = session.getDefaultFloodScope();
    expect(fake.sent.at(-1)?.[0]).toBe(0x40); // CMD_GET_DEFAULT_FLOOD_SCOPE
    emit.packet(companionPacket(respDefaultScope('General', 0xcd)));
    expect(await p).toEqual({ name: 'General', keyHex: 'cd'.repeat(16) });
  });

  it('getDefaultFloodScope resolves null on the 1-byte no-scope reply', async () => {
    transportManager.setTransport(new FakeTransport());
    const session = protocolSession();
    session.start();

    const p = session.getDefaultFloodScope();
    emit.packet(companionPacket(Buffer.from([0x1c])));
    expect(await p).toBeNull();
  });
});
