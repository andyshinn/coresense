import { Buffer } from 'node:buffer';
import { Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { toRawPacket } from '../../../../src/main/transport/rawPacket';
import { companionFrameName } from '../../../../src/shared/companionFrames';

describe('shared companion frame names', () => {
  // The renderer can't import meshcore-ts, so shared/companionFrames.ts keeps
  // its own copy of the lib's PUSH_/RESP_ names. Every code the lib knows must
  // be named identically there, or the renderer's decoder and main's packet
  // log disagree about what a frame is.
  it.each([
    ['PUSH', Protocol.PUSH],
    ['RESP', Protocol.RESP],
  ] as const)('names every lib %s code the way the lib does', (prefix, codes) => {
    for (const [name, code] of Object.entries(codes)) {
      expect(companionFrameName(code), `${prefix} ${name} (${code})`).toBe(`${prefix}_${name}`);
    }
  });

  it('matches the lib parser for every code byte, including unknown ones', () => {
    for (let code = 0; code <= 0xff; code++) {
      // Skip the two mesh pushes: they parse to a mesh packet, not a name.
      if (code === Protocol.PUSH.RAW_DATA || code === Protocol.PUSH.LOG_RX_DATA) continue;
      const parsed = Protocol.parseCompanionFrame(Buffer.from([code]));
      expect(parsed?.kind).toBe('companion');
      if (parsed?.kind !== 'companion') continue;
      expect(companionFrameName(code)).toBe(parsed.codeName);
    }
  });
});

describe('toRawPacket', () => {
  it('builds a mesh packet from a LOG_RX_DATA push', () => {
    // [0x88][snr*4 = -10 → -2.5][rssi -90][mesh…]
    const frame = Buffer.from([0x88, 0xf6, 0xa6, 0x11, 0x22, 0x33]);
    const parsed = Protocol.parseCompanionFrame(frame);
    if (!parsed) throw new Error('unparsed');
    expect(toRawPacket(frame, parsed, { timestamp: 123, transportType: 'ble' })).toEqual({
      timestamp: 123,
      transportType: 'ble',
      kind: 'mesh',
      hex: '88f6a6112233',
      bytes: [0x88, 0xf6, 0xa6, 0x11, 0x22, 0x33],
      payloadHex: '112233',
      payloadBytes: [0x11, 0x22, 0x33],
      snr: -2.5,
      rssi: -90,
    });
  });

  it('builds a companion packet with the code and its name', () => {
    const frame = Buffer.from([Protocol.RESP.CURR_TIME, 0x01, 0x02]);
    const parsed = Protocol.parseCompanionFrame(frame);
    if (!parsed) throw new Error('unparsed');
    expect(toRawPacket(frame, parsed, { timestamp: 0, transportType: 'ble' })).toEqual({
      timestamp: 0,
      transportType: 'ble',
      kind: 'companion',
      hex: '090102',
      bytes: [0x09, 0x01, 0x02],
      payloadHex: '0102',
      payloadBytes: [0x01, 0x02],
      code: 0x09,
      codeName: 'RESP_CURR_TIME',
    });
  });
});
