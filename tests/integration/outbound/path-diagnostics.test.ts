import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { ProtocolError } from '../../../src/main/protocol/errors';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import type { Contact } from '../../../src/shared/types';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

const PK = 'aa'.repeat(32);
const PREFIX = 'aa'.repeat(6); // first 6 bytes of the pubkey
const flush = () => new Promise((r) => setTimeout(r, 0));

const seedContact = (): void => {
  stateHolder().upsertContact({
    key: `c:${PK}`,
    publicKeyHex: PK,
    name: 'Repeater',
    kind: 'repeater',
  } satisfies Contact);
};

function attach(): FakeTransport {
  const fake = new FakeTransport();
  transportManager.setTransport(fake);
  protocolSession().start();
  return fake;
}

// RESP_SENT [0x06][flood][tag u32][est_timeout u32] (10B).
function respSent(): Buffer {
  const f = Buffer.alloc(10);
  f[0] = 0x06;
  f[1] = 1; // flood
  f.writeUInt32LE(0x1234, 2);
  f.writeUInt32LE(5000, 6);
  return f;
}

describe('outbound path diagnostics', () => {
  afterEach(() => protocolSession().stop());

  it('sendPathDiscoveryReq dispatches, then resolves with the discovered paths', async () => {
    seedContact();
    const fake = attach();

    const p = protocolSession().sendPathDiscoveryReq(`c:${PK}`);
    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x34); // CMD_SEND_PATH_DISCOVERY_REQ
    expect(fake.sent.at(-1)?.[1]).toBe(0x00); // reserved byte

    emit.packet(companionPacket(respSent())); // dispatch confirmed
    await flush();

    const push = Buffer.concat([
      Buffer.from([0x8d, 0x00]), // code + reserved
      Buffer.from(PREFIX, 'hex'), // 6B prefix
      Buffer.from([0x02]),
      Buffer.from('1122', 'hex'), // out_path
      Buffer.from([0x01]),
      Buffer.from('33', 'hex'), // in_path
    ]);
    emit.packet(companionPacket(push));

    expect(await p).toEqual({
      pubKeyPrefixHex: PREFIX,
      outHops: 2,
      outPathHex: '1122',
      inHops: 1,
      inPathHex: '33',
    });
  });

  it('sendPathDiscoveryReq rejects ProtocolError when the radio refuses dispatch', async () => {
    seedContact();
    attach();
    const p = protocolSession().sendPathDiscoveryReq(`c:${PK}`);
    await flush();
    emit.packet(companionPacket(Buffer.from([0x01, 0x02]))); // RESP_ERR NOT_FOUND
    await expect(p).rejects.toBeInstanceOf(ProtocolError);
  });

  it('getAdvertPath returns the cached path on RESP_ADVERT_PATH', async () => {
    seedContact();
    const fake = attach();
    const p = protocolSession().getAdvertPath(`c:${PK}`);
    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x2a); // CMD_GET_ADVERT_PATH

    const reply = Buffer.concat([
      Buffer.from([0x16]),
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(1000, 0);
        return b;
      })(),
      Buffer.from([0x02]),
      Buffer.from('aabb', 'hex'),
    ]);
    emit.packet(companionPacket(reply));
    expect(await p).toEqual({ recvTimestampUnix: 1000, hops: 2, pathHex: 'aabb' });
  });

  it('getAdvertPath returns null on RESP_ERR (no cached path)', async () => {
    seedContact();
    attach();
    const p = protocolSession().getAdvertPath(`c:${PK}`);
    await flush();
    emit.packet(companionPacket(Buffer.from([0x01, 0x02]))); // RESP_ERR NOT_FOUND
    expect(await p).toBeNull();
  });
});
