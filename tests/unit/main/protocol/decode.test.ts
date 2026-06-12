import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  parseChannelInfo,
  parseChannelMsgV1,
  parseChannelMsgV3,
  parseContact,
  parseContactMsgV1,
  parseContactMsgV3,
  parseContactsStart,
  parseCustomVars,
  parseDeviceInfo,
  parseEndOfContacts,
  parseSelfInfo,
  parseSendConfirmed,
  parseSentAck,
  parseStatusResponse,
  parseTelemetryResponse,
} from '../../../../src/main/protocol/decode';
import { frameBuf } from '../../../support/frames';

describe('parseDeviceInfo (real fixture)', () => {
  it('reads firmware version, doubled max-contacts, and max-channels', () => {
    const info = parseDeviceInfo(frameBuf('deviceInfo'));
    expect(info).not.toBeNull();
    expect(info?.firmwareVerCode).toBe(0x0b); // 11
    expect(info?.maxContacts).toBe(0xaf * 2); // firmware reports count/2 → 350
    expect(info?.maxChannels).toBe(0x28); // 40
    expect(info?.pathHashMode).toBe(1); // trailing byte
    expect(info?.clientRepeat).toBe(false);
  });

  it('returns null for a frame shorter than 4 bytes', () => {
    expect(parseDeviceInfo(Buffer.from([0x0d, 0x0b]))).toBeNull();
  });
});

describe('parseSelfInfo (real fixture)', () => {
  it('extracts the 32-byte public key at offset 4', () => {
    const self = parseSelfInfo(frameBuf('selfInfo'));
    expect(self).not.toBeNull();
    expect(self?.publicKeyHex).toBe(
      '1a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d5',
    );
    expect(self?.name).toContain('Hand'); // trailing printable name region
  });

  it('returns null when the code byte is not 0x05', () => {
    const bad = Buffer.alloc(40);
    bad[0] = 0x06;
    expect(parseSelfInfo(bad)).toBeNull();
  });

  it('returns null below 36 bytes', () => {
    expect(parseSelfInfo(Buffer.alloc(35))).toBeNull();
  });
});

describe('parseChannelInfo', () => {
  it('reads idx, null-terminated name, and 16-byte key', () => {
    const frame = Buffer.alloc(50);
    frame[0] = 0x12;
    frame[1] = 2; // idx
    Buffer.from('General', 'utf8').copy(frame, 2); // name region (null-padded)
    Buffer.alloc(16, 0xab).copy(frame, 34); // 16-byte key, all 0xab
    const info = parseChannelInfo(frame);
    expect(info?.idx).toBe(2);
    expect(info?.name).toBe('General');
    expect(info?.secretHex).toBe('ab'.repeat(16));
    expect(info?.empty).toBe(false);
  });

  it('flags an all-zero key as empty', () => {
    const frame = Buffer.alloc(50);
    frame[0] = 0x12;
    expect(parseChannelInfo(frame)?.empty).toBe(true);
  });

  it('returns null below the 50-byte frame length', () => {
    expect(parseChannelInfo(Buffer.alloc(49))).toBeNull();
  });
});

describe('parseChannelMsgV3', () => {
  it('decodes snr/4, channel idx, timestamp, and splits the "name: " prefix', () => {
    const body = Buffer.from('Alice: hello', 'utf8');
    const frame = Buffer.alloc(11 + body.length);
    frame[0] = 0x11;
    frame.writeInt8(50, 1); // snr*4 = 50 → 12.5 dB
    frame[4] = 3; // channel idx
    frame[5] = 0xff; // path_len (direct)
    frame[6] = 0; // txt_type
    frame.writeUInt32LE(1_700_000_000, 7);
    body.copy(frame, 11);
    const msg = parseChannelMsgV3(frame);
    expect(msg?.snrDb).toBe(12.5);
    expect(msg?.channelIdx).toBe(3);
    expect(msg?.pathLen).toBe(0xff);
    expect(msg?.timestampUnix).toBe(1_700_000_000);
    expect(msg?.body).toBe('Alice: hello');
    expect(msg?.senderName).toBe('Alice');
    expect(msg?.cleanBody).toBe('hello');
  });

  it('returns null below 12 bytes', () => {
    expect(parseChannelMsgV3(Buffer.alloc(11))).toBeNull();
  });
});

describe('parseChannelMsgV1 (legacy, no snr prefix)', () => {
  it('reports snrDb 0 and reads the older layout', () => {
    const body = Buffer.from('hi', 'utf8');
    const frame = Buffer.alloc(8 + body.length);
    frame[0] = 0x08;
    frame[1] = 1; // channel idx
    frame[2] = 2; // path_len
    frame[3] = 0; // txt_type
    frame.writeUInt32LE(42, 4);
    body.copy(frame, 8);
    const msg = parseChannelMsgV1(frame);
    expect(msg?.snrDb).toBe(0);
    expect(msg?.channelIdx).toBe(1);
    expect(msg?.timestampUnix).toBe(42);
    expect(msg?.body).toBe('hi');
  });

  it('returns null below 8 bytes', () => {
    expect(parseChannelMsgV1(Buffer.alloc(7))).toBeNull();
  });
});

describe('parseContactMsgV3', () => {
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
    const msg = parseContactMsgV3(frame);
    expect(msg?.snrDb).toBe(-1);
    expect(msg?.senderPubKeyPrefixHex).toBe('aabbccddeeff');
    expect(msg?.timestampUnix).toBe(99);
    expect(msg?.body).toBe('ping');
  });
});

describe('parseContactMsgV1 (legacy, no snr prefix)', () => {
  it('reads the 6-byte sender prefix and body, snrDb 0', () => {
    const body = Buffer.from('hey', 'utf8');
    const frame = Buffer.alloc(13 + body.length);
    frame[0] = 0x07;
    Buffer.from('aabbccddeeff', 'hex').copy(frame, 1); // sender prefix
    frame[7] = 3; // path_len
    frame[8] = 0; // txt_type
    frame.writeUInt32LE(123, 9);
    body.copy(frame, 13);
    const msg = parseContactMsgV1(frame);
    expect(msg?.snrDb).toBe(0);
    expect(msg?.senderPubKeyPrefixHex).toBe('aabbccddeeff');
    expect(msg?.pathLen).toBe(3);
    expect(msg?.timestampUnix).toBe(123);
    expect(msg?.body).toBe('hey');
  });

  it('returns null below 13 bytes', () => {
    expect(parseContactMsgV1(Buffer.alloc(12))).toBeNull();
  });
});

describe('parseContact', () => {
  it('reads pubkey, type/flags, out_path, name, gps, timestamps', () => {
    const frame = Buffer.alloc(148);
    frame[0] = 0x03;
    Buffer.alloc(32, 0x11).copy(frame, 1); // pubkey
    frame[33] = 2; // type (repeater)
    frame[34] = 0x05; // flags
    frame[35] = 2; // out_path_len
    Buffer.from([0xa1, 0xb2]).copy(frame, 36); // out_path
    Buffer.from('Repeater-1', 'utf8').copy(frame, 100); // name
    frame.writeUInt32LE(1000, 132); // last_advert
    frame.writeInt32LE(37_123456, 136); // gps_lat → 37.123456
    frame.writeInt32LE(-122_654321, 140); // gps_lon → -122.654321
    frame.writeUInt32LE(2000, 144); // lastmod
    const c = parseContact(frame);
    expect(c?.publicKeyHex).toBe('11'.repeat(32));
    expect(c?.type).toBe(2);
    expect(c?.flags).toBe(0x05);
    expect(c?.outPathLen).toBe(2);
    expect(c?.outPathHex).toBe('a1b2');
    expect(c?.name).toBe('Repeater-1');
    expect(c?.lastAdvertUnix).toBe(1000);
    expect(c?.gpsLat).toBeCloseTo(37.123456, 5);
    expect(c?.gpsLon).toBeCloseTo(-122.654321, 5);
    expect(c?.lastmod).toBe(2000);
  });

  it('returns null below 148 bytes', () => {
    expect(parseContact(Buffer.alloc(147))).toBeNull();
  });
});

describe('parseContactsStart / parseEndOfContacts', () => {
  it('read a u32 LE count / lastmod at offset 1', () => {
    const start = Buffer.from([0x02, 0x05, 0x00, 0x00, 0x00]);
    const end = Buffer.from([0x04, 0x10, 0x00, 0x00, 0x00]);
    expect(parseContactsStart(start)).toBe(5);
    expect(parseEndOfContacts(end)).toBe(16);
    expect(parseContactsStart(Buffer.alloc(4))).toBeNull();
  });
});

describe('parseSentAck / parseSendConfirmed', () => {
  it('parseSentAck reads flood flag, expected ack, and est timeout', () => {
    const frame = Buffer.alloc(10);
    frame[0] = 0x06;
    frame[1] = 1; // flood
    Buffer.from('deadbeef', 'hex').copy(frame, 2); // expected ack
    frame.writeUInt32LE(1500, 6); // est timeout ms
    const ack = parseSentAck(frame);
    expect(ack?.flood).toBe(true);
    expect(ack?.expectedAckHex).toBe('deadbeef');
    expect(ack?.estTimeoutMs).toBe(1500);
  });

  it('parseSendConfirmed reads ack hash and trip time', () => {
    const frame = Buffer.alloc(9);
    frame[0] = 0x82;
    Buffer.from('cafebabe', 'hex').copy(frame, 1);
    frame.writeUInt32LE(321, 5);
    const c = parseSendConfirmed(frame);
    expect(c?.ackHex).toBe('cafebabe');
    expect(c?.tripTimeMs).toBe(321);
  });
});

describe('parseStatusResponse', () => {
  it('reads the sender prefix and decodes the leading status fields', () => {
    const payload = Buffer.alloc(8); // battery(4) + tx queue(4)
    payload.writeUInt32LE(4020, 0); // 4.02 V
    payload.writeUInt32LE(2, 4); // TX queue = 2
    const frame = Buffer.concat([
      Buffer.from([0x87, 0x00]),
      Buffer.from('aabbccddeeff', 'hex'),
      payload,
    ]);
    const res = parseStatusResponse(frame);
    expect(res?.senderPubKeyPrefixHex).toBe('aabbccddeeff');
    expect(res?.fields[0]).toEqual({ name: 'Battery', value: 4.02, unit: 'V' });
    expect(res?.fields[1]).toEqual({ name: 'TX queue', value: 2, unit: undefined });
  });

  it('returns null below 8 bytes', () => {
    expect(parseStatusResponse(Buffer.alloc(7))).toBeNull();
  });
});

describe('parseTelemetryResponse (CayenneLPP)', () => {
  it('decodes a voltage field', () => {
    // channel 0, type 0x74 (Voltage, u16 BE /100), value 4.20 V → 420 = 0x01a4
    const payload = Buffer.from([0x00, 0x74, 0x01, 0xa4]);
    const frame = Buffer.concat([
      Buffer.from([0x8b, 0x00]),
      Buffer.from('aabbccddeeff', 'hex'),
      payload,
    ]);
    const res = parseTelemetryResponse(frame);
    expect(res?.fields[0]).toMatchObject({ channel: 0, name: 'Voltage', value: 4.2, unit: 'V' });
  });
});

describe('parseCustomVars', () => {
  it('parses newline-separated key:value pairs', () => {
    const frame = Buffer.concat([
      Buffer.from([0x15]),
      Buffer.from('gps:1\ngps_interval:30', 'utf8'),
    ]);
    expect(parseCustomVars(frame)).toEqual({ gps: '1', gps_interval: '30' });
  });

  it('returns an empty object for a too-short frame', () => {
    expect(parseCustomVars(Buffer.from([0x15]))).toEqual({});
  });
});
