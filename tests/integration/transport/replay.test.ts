import { Buffer } from 'node:buffer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { FileReplayTransport } from '../../../src/main/transport/replay';
import type { RawPacket } from '../../../src/shared/types';

describe('FileReplayTransport', () => {
  it('replays fixture frames onto the bus as companion packets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    // RESP_DEVICE_INFO (0x0d) then a short RESP_SELF_INFO-ish (0x05) frame.
    writeFileSync(fixture, JSON.stringify([{ hex: '0d0babcd' }, '05aa']));

    const packets: RawPacket[] = [];
    bus.on('packet', (p: RawPacket) => packets.push(p));

    await new FileReplayTransport(fixture).connect('replay');

    expect(packets).toHaveLength(2);
    expect(packets[0].kind).toBe('companion');
    expect(packets[0].code).toBe(0x0d);
    expect(packets[0].payloadHex).toBe('0babcd');
    expect(packets[1].code).toBe(0x05);
    expect(packets[1].payloadHex).toBe('aa');
  });

  it('replays a 0x88 PUSH_LOG_RX_DATA frame as a mesh packet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    // [0x88][snr*4 i8=0x14 → 20/4=5][rssi i8=0xd8 → -40][mesh=aabbcc]
    writeFileSync(fixture, JSON.stringify(['8814d8aabbcc']));

    const packets: RawPacket[] = [];
    bus.on('packet', (p: RawPacket) => packets.push(p));

    await new FileReplayTransport(fixture).connect('replay');

    expect(packets).toHaveLength(1);
    expect(packets[0].kind).toBe('mesh');
    expect(packets[0].snr).toBe(5);
    expect(packets[0].rssi).toBe(-40);
    expect(packets[0].payloadHex).toBe('aabbcc');
  });

  it('does not throw and emits no packets for a missing fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'does-not-exist.json');

    const packets: RawPacket[] = [];
    bus.on('packet', (p: RawPacket) => packets.push(p));

    await expect(new FileReplayTransport(fixture).connect('x')).resolves.toBeUndefined();
    expect(packets).toHaveLength(0);
  });

  it('records sendBytes without emitting packets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    writeFileSync(fixture, JSON.stringify([]));
    const t = new FileReplayTransport(fixture);
    await t.sendBytes(Buffer.from([1, 2, 3]));
    expect(t.sent).toHaveLength(1);
    expect([...t.sent[0]]).toEqual([1, 2, 3]);
  });
});
