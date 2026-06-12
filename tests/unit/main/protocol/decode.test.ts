import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseStatusResponse, parseTelemetryResponse } from '../../../../src/main/protocol/decode';

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
