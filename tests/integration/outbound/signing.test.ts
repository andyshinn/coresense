import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { ProtocolError } from '../../../src/main/protocol/errors';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

const SIG = 'cd'.repeat(64);
const RESP_OK = Buffer.from([0x00]);

// Yield to the event loop so a pending writeFrame lands in fake.sent before we
// inject the next reply. setTimeout(0) drains the full microtask chain that
// ctx.request → writeFrame → sendBytes schedules.
const flush = () => new Promise((r) => setTimeout(r, 0));

function signStartReply(maxLen: number): Buffer {
  const frame = Buffer.alloc(6);
  frame[0] = 0x13; // RESP_SIGN_START
  frame[1] = 0x00; // reserved
  frame.writeUInt32LE(maxLen, 2);
  return frame;
}

function signatureReply(sigHex: string): Buffer {
  return Buffer.concat([Buffer.from([0x14]), Buffer.from(sigHex, 'hex')]);
}

function attach(): FakeTransport {
  const fake = new FakeTransport();
  transportManager.setTransport(fake);
  protocolSession().start();
  return fake;
}

describe('outbound message signing', () => {
  afterEach(() => protocolSession().stop());

  it('drives START → DATA → FINISH and resolves with the signature', async () => {
    const fake = attach();
    const data = Buffer.from([0x01, 0x02, 0x03]);

    const p = protocolSession().signData(data);
    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x21); // CMD_SIGN_START
    emit.packet(companionPacket(signStartReply(8192)));

    await flush();
    expect(fake.sent.at(-1)?.toString('hex')).toBe('22010203'); // CMD_SIGN_DATA[chunk]
    emit.packet(companionPacket(RESP_OK));

    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x23); // CMD_SIGN_FINISH
    emit.packet(companionPacket(signatureReply(SIG)));

    expect(await p).toBe(SIG);
  });

  it('splits data larger than the chunk size into multiple SIGN_DATA frames', async () => {
    const fake = attach();
    const data = Buffer.alloc(200, 0xab); // 200 > 128 chunk → 128 + 72

    const p = protocolSession().signData(data);
    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x21);
    emit.packet(companionPacket(signStartReply(8192)));

    await flush();
    const c1 = fake.sent.at(-1);
    expect(c1?.[0]).toBe(0x22);
    expect(c1?.length).toBe(1 + 128);
    emit.packet(companionPacket(RESP_OK));

    await flush();
    const c2 = fake.sent.at(-1);
    expect(c2?.[0]).toBe(0x22);
    expect(c2?.length).toBe(1 + 72);
    emit.packet(companionPacket(RESP_OK));

    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x23); // FINISH
    emit.packet(companionPacket(signatureReply(SIG)));

    expect(await p).toBe(SIG);
  });

  it('signs empty data with no SIGN_DATA frames (START → FINISH)', async () => {
    const fake = attach();
    const p = protocolSession().signData(Buffer.alloc(0));
    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x21);
    emit.packet(companionPacket(signStartReply(8192)));

    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x23); // straight to FINISH, no 0x22
    emit.packet(companionPacket(signatureReply(SIG)));

    expect(await p).toBe(SIG);
  });

  it('rejects without sending data when the payload exceeds the device max', async () => {
    const fake = attach();
    const p = protocolSession().signData(Buffer.alloc(5));
    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x21);
    const sentCount = fake.sent.length;
    emit.packet(companionPacket(signStartReply(4))); // maxLen 4 < 5

    await expect(p).rejects.toThrow(/exceeds the device max/);
    expect(fake.sent.length).toBe(sentCount); // no CMD_SIGN_DATA written
  });

  it('rejects ProtocolError when a chunk is refused (RESP_ERR BAD_STATE)', async () => {
    const fake = attach();
    const p = protocolSession().signData(Buffer.from([0xaa]));
    await flush();
    emit.packet(companionPacket(signStartReply(8192)));

    await flush();
    expect(fake.sent.at(-1)?.[0]).toBe(0x22);
    emit.packet(companionPacket(Buffer.from([0x01, 0x04]))); // RESP_ERR + BAD_STATE

    await expect(p).rejects.toBeInstanceOf(ProtocolError);
  });
});
