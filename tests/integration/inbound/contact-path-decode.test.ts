import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { makeTestSession } from '../../support/session-harness';

// PUSH_NEW_ADVERT (0x8a) carries a full 148-byte contact record — same layout as
// RESP_CONTACT. Byte 35 is the packed out_path_len ((hashSize-1)<<6 | hops); the
// 64-byte out_path region begins at offset 36. This drives a real advert frame
// through the (linked) meshcore-ts decoder and coresense's discovered store, so
// it exercises the whole decode→map chain end to end.
function advertFrame(pubkeyHex: string, name: string, outPathLen: number, pathHex = ''): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = 0x8a;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = 2; // type = repeater
  frame[34] = 0; // flags
  frame[35] = outPathLen;
  if (pathHex) Buffer.from(pathHex, 'hex').copy(frame, 36);
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

function seen(pubkeyHex: string) {
  const row = discoveredStore.list([]).find((d) => d.publicKeyHex === pubkeyHex);
  if (!row) throw new Error(`contact ${pubkeyHex} not in discovered store`);
  return row;
}

const PK = (b: string) => b.repeat(32);

describe('contact path decode from adverts (packed out_path_len)', () => {
  it('flood (0xFF): no hops, no path', () => {
    const { receive } = makeTestSession();
    receive(advertFrame(PK('a1'), 'Flooded', 0xff));
    const c = seen(PK('a1'));
    expect(c.hops).toBeUndefined();
    expect(c.outPathHex).toBeUndefined();
    expect(c.outPathHashSize).toBeUndefined();
  });

  it('direct 2-byte-mode (0x40): 0 hops, no path bytes — not 64 hops of 0000', () => {
    const { receive } = makeTestSession();
    receive(advertFrame(PK('b2'), 'Direct', 0x40));
    const c = seen(PK('b2'));
    expect(c.hops).toBe(0);
    expect(c.outPathHex).toBeUndefined();
    expect(c.outPathHashSize).toBeUndefined();
  });

  it('3-hop 2-byte-mode (0x43): 3 hops, 6 path bytes, 2-byte hash size', () => {
    const { receive } = makeTestSession();
    receive(advertFrame(PK('c3'), 'ThreeHop', 0x43, 'aabbccddeeff'));
    const c = seen(PK('c3'));
    expect(c.hops).toBe(3);
    expect(c.outPathHex).toBe('aabbccddeeff');
    expect(c.outPathHashSize).toBe(2);
  });

  it('2-hop 1-byte-mode (0x02): 2 hops, 2 path bytes, 1-byte hash size', () => {
    const { receive } = makeTestSession();
    receive(advertFrame(PK('d4'), 'LegacyTwo', 0x02, 'a1b2'));
    const c = seen(PK('d4'));
    expect(c.hops).toBe(2);
    expect(c.outPathHex).toBe('a1b2');
    expect(c.outPathHashSize).toBe(1);
  });
});
