import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { ProtocolError } from '../../../src/main/protocol/errors';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

const PK = 'aa'.repeat(32);
const RESP_OK = Buffer.from([0x00]);
const RESP_ERR_NOT_FOUND = Buffer.from([0x01, 0x02]);
const flush = () => new Promise((r) => setTimeout(r, 0));

function attach(): FakeTransport {
  const fake = new FakeTransport();
  transportManager.setTransport(fake);
  protocolSession().start();
  return fake;
}

// A full 148-byte RESP_CONTACT frame for the given pubkey.
function respContact(pkHex: string, name: string): Buffer {
  const f = Buffer.alloc(148);
  f[0] = 0x03;
  Buffer.from(pkHex, 'hex').copy(f, 1);
  f[33] = 1; // type: chat
  f[35] = 0; // out_path_len
  Buffer.from(name, 'utf8').copy(f, 100);
  f.writeUInt32LE(1000, 132); // last_advert
  f.writeUInt32LE(2000, 144); // lastmod
  return f;
}

describe('outbound contact interop', () => {
  afterEach(() => protocolSession().stop());

  it('shareContact writes [0x10][pubkey] and resolves on RESP_OK', async () => {
    const fake = attach();
    const p = protocolSession().shareContact(PK);
    expect(fake.sent.at(-1)?.toString('hex')).toBe(`10${PK}`);
    emit.packet(companionPacket(RESP_OK));
    await expect(p).resolves.toBeUndefined();
  });

  it('exportContact (self) returns the blob from RESP_EXPORT_CONTACT', async () => {
    const fake = attach();
    const p = protocolSession().exportContact();
    await flush();
    expect(fake.sent.at(-1)?.toString('hex')).toBe('11'); // bare opcode = export self
    const blob = 'bb'.repeat(50);
    emit.packet(companionPacket(Buffer.concat([Buffer.from([0x0b]), Buffer.from(blob, 'hex')])));
    expect(await p).toBe(blob);
  });

  it('exportContact returns null on RESP_ERR (contact not found)', async () => {
    attach();
    const p = protocolSession().exportContact(PK);
    await flush();
    emit.packet(companionPacket(RESP_ERR_NOT_FOUND));
    expect(await p).toBeNull();
  });

  it('importContact writes [0x12][blob] and rejects ProtocolError on RESP_ERR', async () => {
    const fake = attach();
    const blob = 'cc'.repeat(98);
    const p = protocolSession().importContact(blob);
    expect(fake.sent.at(-1)?.toString('hex')).toBe(`12${blob}`);
    emit.packet(companionPacket(RESP_ERR_NOT_FOUND));
    await expect(p).rejects.toBeInstanceOf(ProtocolError);
  });

  it('getContactByKey resolves the record from RESP_CONTACT without touching the sync', async () => {
    const fake = attach();
    const syncSignals: unknown[] = [];
    const onSync = (s: unknown) => syncSignals.push(s);
    bus.on('contactsSync', onSync);
    try {
      const p = protocolSession().getContactByKey(PK);
      await flush();
      expect(fake.sent.at(-1)?.toString('hex')).toBe(`1e${PK}`);
      emit.packet(companionPacket(respContact(PK, 'Alice')));
      const rec = await p;
      expect(rec?.publicKeyHex).toBe(PK);
      expect(rec?.name).toBe('Alice');
      expect(syncSignals).toHaveLength(0); // not folded into the bulk-sync iterator
    } finally {
      bus.off('contactsSync', onSync);
    }
  });

  it('getContactByKey resolves null on RESP_ERR (not found)', async () => {
    attach();
    const p = protocolSession().getContactByKey(PK);
    await flush();
    emit.packet(companionPacket(RESP_ERR_NOT_FOUND));
    expect(await p).toBeNull();
  });
});
