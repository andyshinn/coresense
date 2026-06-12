import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  buildAnonLogin,
  buildGetStats,
  buildLogout,
  buildReboot,
  buildSendAnonReq,
  buildSendBinaryReq,
  buildSendDmText,
  buildSendLogin,
  buildSendSelfAdvert,
  buildSendStatusReq,
  buildSendTelemetryReq,
  buildSendTracePath,
} from '../../../../src/main/protocol/encode';

const hex = (b: Buffer) => b.toString('hex');

describe('encode: bare-opcode commands', () => {
  it('buildSendSelfAdvert encodes the flood flag', () => {
    expect(hex(buildSendSelfAdvert())).toBe('0701');
    expect(hex(buildSendSelfAdvert(false))).toBe('0700');
  });

  it('buildReboot appends the literal "reboot"', () => {
    expect(hex(buildReboot())).toBe('137265626f6f74');
  });
});

describe('encode: DM text framing + validation', () => {
  it('lays out [cmd][txt_type][attempt][ts u32 LE][6B pubkey prefix][text]', () => {
    const out = buildSendDmText({
      destPublicKeyHex: 'aabbccddeeff00112233445566778899',
      text: 'hi',
      timestampUnix: 1,
    });
    expect(out[0]).toBe(0x02); // SEND_TXT_MSG
    expect(out[1]).toBe(0); // PLAIN
    expect(out[2]).toBe(0); // attempt
    expect(out.readUInt32LE(3)).toBe(1); // timestamp
    expect(out.subarray(7, 13).toString('hex')).toBe('aabbccddeeff'); // first 6 bytes
    expect(out.subarray(13).toString('utf8')).toBe('hi');
  });

  it('rejects a public key shorter than 6 bytes', () => {
    expect(() => buildSendDmText({ destPublicKeyHex: 'aabb', text: 'x' })).toThrow(/≥6 bytes/);
  });
});

describe('encode: bare/simple builders (missing coverage)', () => {
  it('buildGetStats appends the subtype', () => {
    expect(hex(buildGetStats(0x00))).toBe('3800');
  });
});

describe('encode: 32-byte-pubkey commands (missing coverage)', () => {
  const pk = 'aa'.repeat(32);

  it('buildLogout is [0x1d][32B pubkey]', () => {
    expect(hex(buildLogout(pk))).toBe(`1d${pk}`);
  });

  it('buildSendStatusReq is [0x1b][32B pubkey]', () => {
    expect(hex(buildSendStatusReq(pk))).toBe(`1b${pk}`);
  });

  it('buildSendTelemetryReq is [0x27][3 reserved zero bytes][32B pubkey]', () => {
    expect(hex(buildSendTelemetryReq(pk))).toBe(`27000000${pk}`);
  });

  it('buildSendLogin is [0x1a][32B pubkey][ascii password]', () => {
    expect(hex(buildSendLogin(pk, 'pw'))).toBe(`1a${pk}7077`);
  });

  it('buildSendAnonReq is [0x39][32B pubkey][data]; rejects empty data', () => {
    expect(hex(buildSendAnonReq(pk, Buffer.from([0x01])))).toBe(`39${pk}01`);
    expect(() => buildSendAnonReq(pk, Buffer.alloc(0))).toThrow(/≥1 byte/);
  });

  it('buildAnonLogin wraps the password as anon-req data; rejects empty', () => {
    expect(hex(buildAnonLogin(pk, 'pw'))).toBe(`39${pk}7077`);
    expect(() => buildAnonLogin(pk, '')).toThrow(/empty/);
  });

  it('buildSendBinaryReq is [0x32][32B pubkey][reqData]; rejects empty', () => {
    expect(hex(buildSendBinaryReq(pk, Buffer.from([0x05])))).toBe(`32${pk}05`);
    expect(() => buildSendBinaryReq(pk, Buffer.alloc(0))).toThrow(/≥1 byte/);
  });

  it('rejects pubkeys shorter than 32 bytes', () => {
    expect(() => buildLogout('aabb')).toThrow(/32B/);
    expect(() => buildSendStatusReq('aabb')).toThrow(/32B/);
  });
});

describe('encode: structured builders (missing coverage)', () => {
  it('buildSendTracePath lays out [0x24][tag u32 LE][auth u32 LE][flags u8][path]', () => {
    const out = buildSendTracePath({ tag: 1, authCode: 2, flags: 0, path: Buffer.from([0xaa]) });
    expect(hex(out)).toBe('24010000000200000000aa');
  });

  it('buildSendTracePath rejects an empty path', () => {
    expect(() => buildSendTracePath({ tag: 1, authCode: 2, path: Buffer.alloc(0) })).toThrow(
      /≥1 byte/,
    );
  });
});
