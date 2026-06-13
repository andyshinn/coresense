import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { ProtocolError } from '../../../src/main/protocol/errors';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

const RESP_OK = Buffer.from([0x00]);
const RESP_ERR = Buffer.from([0x01, 0x03]); // ERR + TABLE_FULL

function attach(): FakeTransport {
  const fake = new FakeTransport();
  transportManager.setTransport(fake);
  protocolSession().start();
  return fake;
}

describe('outbound raw / control / channel data', () => {
  afterEach(() => protocolSession().stop());

  it('sendRawData writes [0x19][path_len][path][payload] and resolves on RESP_OK', async () => {
    const fake = attach();
    const p = protocolSession().sendRawData({
      pathHex: 'aabb',
      payload: Buffer.from([1, 2, 3, 4]),
    });
    expect(fake.sent.at(-1)?.toString('hex')).toBe('1902aabb01020304');
    emit.packet(companionPacket(RESP_OK));
    await expect(p).resolves.toBeUndefined();
  });

  it('sendControlData writes [0x37][data] and rejects ProtocolError on RESP_ERR', async () => {
    const fake = attach();
    const p = protocolSession().sendControlData(Buffer.from([0x81, 0x22]));
    expect(fake.sent.at(-1)?.toString('hex')).toBe('378122');
    emit.packet(companionPacket(RESP_ERR));
    await expect(p).rejects.toBeInstanceOf(ProtocolError);
  });

  it('sendChannelData writes the flood frame and resolves on RESP_OK', async () => {
    const fake = attach();
    const p = protocolSession().sendChannelData({
      channelIdx: 3,
      dataType: 0x1234,
      payload: Buffer.from([0xaa, 0xbb]),
    });
    expect(fake.sent.at(-1)?.toString('hex')).toBe('3e03ff3412aabb');
    emit.packet(companionPacket(RESP_OK));
    await expect(p).resolves.toBeUndefined();
  });

  it('sendRawPacket writes [0x41][priority][packet] and resolves on RESP_OK', async () => {
    const fake = attach();
    const p = protocolSession().sendRawPacket({ priority: 7, packetHex: 'aabbcc' });
    expect(fake.sent.at(-1)?.toString('hex')).toBe('4107aabbcc');
    emit.packet(companionPacket(RESP_OK));
    await expect(p).resolves.toBeUndefined();
  });

  it('routes inbound control/channel datagrams to their handler without error', () => {
    attach();
    // RESP_CHANNEL_DATA_RECV [0x1b][snr][rsv][rsv][ch][path][type LE][len][data]
    const chanData = Buffer.from([0x1b, 0x08, 0x00, 0x00, 0x03, 0xff, 0x34, 0x12, 0x02, 0xaa, 0xbb]);
    // PUSH_CONTROL_DATA [0x8e][snr][rssi][path_len][payload]
    const controlData = Buffer.from([0x8e, 0xfc, 0xce, 0x02, 0xaa, 0xbb]);
    expect(() => emit.packet(companionPacket(chanData))).not.toThrow();
    expect(() => emit.packet(companionPacket(controlData))).not.toThrow();
  });
});
