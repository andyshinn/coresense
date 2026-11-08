import { Buffer } from 'node:buffer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileReplayTransport } from '../../../src/main/transport/replay';
import { captureBus } from '../../support/bus';

describe('FileReplayTransport', () => {
  it('replays fixture frames onto the bus as companion packets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    // RESP_DEVICE_INFO (0x0d) then a short RESP_SELF_INFO-ish (0x05) frame.
    writeFileSync(fixture, JSON.stringify([{ hex: '0d0babcd' }, '05aa']));

    const cap = captureBus('packet');

    await new FileReplayTransport(fixture).connect('replay');
    const packets = cap.values;

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

    const cap = captureBus('packet');

    await new FileReplayTransport(fixture).connect('replay');
    const packets = cap.values;

    expect(packets).toHaveLength(1);
    expect(packets[0].kind).toBe('mesh');
    expect(packets[0].snr).toBe(5);
    expect(packets[0].rssi).toBe(-40);
    expect(packets[0].payloadHex).toBe('aabbcc');
  });

  it('does not throw and emits no packets for a missing fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'does-not-exist.json');

    const cap = captureBus('packet');

    await expect(new FileReplayTransport(fixture).connect('x')).resolves.toBeUndefined();
    expect(cap.values).toHaveLength(0);
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

  it('accepts the object form and answers its auto-OK opcodes with RESP_OK', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    writeFileSync(fixture, JSON.stringify({ frames: ['0d0babcd'], autoOkOpcodes: [14] }));
    const cap = captureBus('packet');
    const t = new FileReplayTransport(fixture);
    const received: number[][] = [];
    t.libTransport.onData((chunk) => received.push([...chunk]));
    await t.connect('replay');
    expect(cap.values).toHaveLength(1);
    const replayed = [[0x0d, 0x0b, 0xab, 0xcd]];

    // CMD_SET_ADVERT_LATLON is listed: answered with a bare RESP_OK.
    await t.libTransport.send(Uint8Array.of(14, 1, 2, 3));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([...replayed, [0x00]]);
    expect(cap.values.at(-1)?.code).toBe(0x00);

    // Anything else still goes unanswered.
    await t.libTransport.send(Uint8Array.of(8));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([...replayed, [0x00]]);
  });

  it('drops a pending auto-OK when the link goes down first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    writeFileSync(fixture, JSON.stringify({ frames: [], autoOkOpcodes: [14] }));
    const t = new FileReplayTransport(fixture);
    const received: number[][] = [];
    t.libTransport.onData((chunk) => received.push([...chunk]));
    await t.connect('replay');
    await t.libTransport.send(Uint8Array.of(14, 1, 2, 3));
    await t.disconnect();
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([]);
  });

  it('answers nothing for a plain array fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    const fixture = join(dir, 'frames.json');
    writeFileSync(fixture, JSON.stringify([]));
    const t = new FileReplayTransport(fixture);
    const received: number[][] = [];
    t.libTransport.onData((chunk) => received.push([...chunk]));
    await t.connect('replay');
    await t.libTransport.send(Uint8Array.of(14, 1, 2, 3));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([]);
  });
});
