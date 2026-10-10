// packetStore uses openDb() → a real on-disk sqlite file in the per-test temp
// userData dir from the integration setup, so this exercises the real DDL +
// statements.
import { describe, expect, it } from 'vitest';
import { packetStore } from '../../../src/main/storage/packets';
import type { RawPacket } from '../../../src/shared/types';

const mk = (ts: number): RawPacket => ({
  timestamp: ts,
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [0x88],
  payloadHex: '1501782abbcc',
  payloadBytes: [0x15, 0x01, 0x78, 0x2a, 0xbb, 0xcc],
  snr: 5,
  rssi: -80,
});

const mkCompanion = (ts: number): RawPacket => ({
  timestamp: ts,
  transportType: 'ble',
  kind: 'companion',
  hex: '83',
  bytes: [0x83],
  payloadHex: '2a01aabbccdd6869',
  payloadBytes: [0x2a, 0x01, 0xaa, 0xbb, 0xcc, 0xdd, 0x68, 0x69],
  code: 0x83,
  codeName: 'RESP_CHANNEL_MSG_RECV',
});

describe('packetStore', () => {
  it('records and returns packets oldest→newest', () => {
    packetStore.record(mk(1000), 100);
    packetStore.record(mk(2000), 100);
    const rows = packetStore.recent(10);
    expect(rows.map((r) => r.timestamp)).toEqual([1000, 2000]);
    expect(rows[0].payloadBytes).toEqual([0x15, 0x01, 0x78, 0x2a, 0xbb, 0xcc]);
  });

  it('prunes to the keep cap, retaining the newest', () => {
    for (let i = 0; i < 5; i++) packetStore.record(mk(i + 1), 3);
    const rows = packetStore.recent(100);
    expect(rows.map((r) => r.timestamp)).toEqual([3, 4, 5]);
  });

  it('skips persistence when keep <= 0', () => {
    packetStore.record(mk(1), 0);
    expect(packetStore.recent(10)).toEqual([]);
  });

  it('returns [] for a non-positive limit', () => {
    packetStore.record(mk(1), 100);
    expect(packetStore.recent(0)).toEqual([]);
    expect(packetStore.recent(-1)).toEqual([]);
  });

  it("never persists the radio's private key (RESP_PRIVATE_KEY)", () => {
    packetStore.record({ ...mkCompanion(6000), code: 14, codeName: 'RESP_PRIVATE_KEY' }, 100);
    expect(packetStore.recent(10)).toEqual([]);
  });

  it('prunes to a smaller keep on demand, and to nothing at 0', () => {
    for (let i = 0; i < 5; i++) packetStore.record(mk(i + 1), 100);
    packetStore.prune(2);
    expect(packetStore.recent(100).map((r) => r.timestamp)).toEqual([4, 5]);
    packetStore.prune(0);
    expect(packetStore.recent(100)).toEqual([]);
  });

  it('clear empties the table', () => {
    packetStore.record(mk(1), 100);
    packetStore.clear();
    expect(packetStore.recent(10)).toEqual([]);
  });

  it('round-trips a companion-shaped packet with code/codeName and no snr/rssi', () => {
    packetStore.record(mkCompanion(5000), 100);
    const rows = packetStore.recent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('companion');
    expect(rows[0].code).toBe(0x83);
    expect(rows[0].codeName).toBe('RESP_CHANNEL_MSG_RECV');
    expect(rows[0]).not.toHaveProperty('snr');
    expect(rows[0]).not.toHaveProperty('rssi');
  });
});
