import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeDeviceInfo,
  encodeDeviceQuery,
} from '../../../../../src/main/protocol/features/deviceInfo';
import { frameBuf } from '../../../../support/frames';

describe('deviceInfo encode/decode', () => {
  it('encodeDeviceQuery defaults to protocol version 4', () => {
    expect(encodeDeviceQuery().toString('hex')).toBe('1604');
  });

  it('encodeDeviceQuery(3) matches the byte sequence seen on the wire', () => {
    // Cross-checked against coresense.log: PROXY_RX cmd=0x16 hex=1603
    expect(encodeDeviceQuery(3).toString('hex')).toBe('1603');
  });

  it('decodeDeviceInfo reads firmware version, doubled max-contacts, and max-channels', () => {
    const info = decodeDeviceInfo(frameBuf('deviceInfo'));
    expect(info).not.toBeNull();
    expect(info?.firmwareVerCode).toBe(0x0b); // 11
    expect(info?.maxContacts).toBe(0xaf * 2); // firmware reports count/2 → 350
    expect(info?.maxChannels).toBe(0x28); // 40
    expect(info?.pathHashMode).toBe(1); // trailing byte
    expect(info?.clientRepeat).toBe(false);
  });

  it('decodeDeviceInfo returns null for a frame shorter than 4 bytes', () => {
    expect(decodeDeviceInfo(Buffer.from([0x0d, 0x0b]))).toBeNull();
  });
});
