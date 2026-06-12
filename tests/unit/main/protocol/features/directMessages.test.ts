import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeContactMsgV1,
  decodeContactMsgV3,
  decodeSendConfirmed,
  decodeSentAck,
  encodeSendDmText,
} from '../../../../../src/main/protocol/features/directMessages';

describe('directMessages: encodeSendDmText', () => {
  it('lays out [cmd][txt_type][attempt][ts u32 LE][6B pubkey prefix][text]', () => {
    const out = encodeSendDmText({
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
    expect(() => encodeSendDmText({ destPublicKeyHex: 'aabb', text: 'x' })).toThrow(/≥6 bytes/);
  });
});

describe('directMessages: decodeContactMsgV3', () => {
  it('reads the 6-byte sender prefix and body (no name prefix)', () => {
    const body = Buffer.from('ping', 'utf8');
    const frame = Buffer.alloc(16 + body.length);
    frame[0] = 0x10;
    frame.writeInt8(-4, 1); // snr*4 = -4 → -1 dB
    Buffer.from('aabbccddeeff', 'hex').copy(frame, 4); // sender prefix
    frame[10] = 0xff; // path_len
    frame[11] = 0; // txt_type
    frame.writeUInt32LE(99, 12);
    body.copy(frame, 16);
    const msg = decodeContactMsgV3(frame);
    expect(msg?.snrDb).toBe(-1);
    expect(msg?.senderPubKeyPrefixHex).toBe('aabbccddeeff');
    expect(msg?.timestampUnix).toBe(99);
    expect(msg?.body).toBe('ping');
  });
});

describe('directMessages: decodeContactMsgV1 (legacy, no snr prefix)', () => {
  it('reads the 6-byte sender prefix and body, snrDb 0', () => {
    const body = Buffer.from('hey', 'utf8');
    const frame = Buffer.alloc(13 + body.length);
    frame[0] = 0x07;
    Buffer.from('aabbccddeeff', 'hex').copy(frame, 1); // sender prefix
    frame[7] = 3; // path_len
    frame[8] = 0; // txt_type
    frame.writeUInt32LE(123, 9);
    body.copy(frame, 13);
    const msg = decodeContactMsgV1(frame);
    expect(msg?.snrDb).toBe(0);
    expect(msg?.senderPubKeyPrefixHex).toBe('aabbccddeeff');
    expect(msg?.pathLen).toBe(3);
    expect(msg?.timestampUnix).toBe(123);
    expect(msg?.body).toBe('hey');
  });

  it('returns null below 13 bytes', () => {
    expect(decodeContactMsgV1(Buffer.alloc(12))).toBeNull();
  });
});

describe('directMessages: decodeSentAck / decodeSendConfirmed', () => {
  it('decodeSentAck reads flood flag, expected ack, and est timeout', () => {
    const frame = Buffer.alloc(10);
    frame[0] = 0x06;
    frame[1] = 1; // flood
    Buffer.from('deadbeef', 'hex').copy(frame, 2); // expected ack
    frame.writeUInt32LE(1500, 6); // est timeout ms
    const ack = decodeSentAck(frame);
    expect(ack?.flood).toBe(true);
    expect(ack?.expectedAckHex).toBe('deadbeef');
    expect(ack?.estTimeoutMs).toBe(1500);
  });

  it('decodeSendConfirmed reads ack hash and trip time', () => {
    const frame = Buffer.alloc(9);
    frame[0] = 0x82;
    Buffer.from('cafebabe', 'hex').copy(frame, 1);
    frame.writeUInt32LE(321, 5);
    const c = decodeSendConfirmed(frame);
    expect(c?.ackHex).toBe('cafebabe');
    expect(c?.tripTimeMs).toBe(321);
  });
});
