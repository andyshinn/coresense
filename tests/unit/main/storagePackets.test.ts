// packetStore uses openDb() → a real on-disk sqlite file. Point userDataDir at a
// fresh temp dir per test run so we exercise the real DDL + statements.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'cs-packets-'));
vi.mock('../../../src/main/runtime/userData', () => ({ userDataDir: () => dir }));

import { closeDb } from '../../../src/main/storage/db';
import { clampRetention, packetStore } from '../../../src/main/storage/packets';
import { DEFAULT_PACKET_LOG_SETTINGS, PACKET_LOG_BOUNDS, type RawPacket } from '../../../src/shared/types';

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

afterEach(() => {
  packetStore.clear();
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

describe('clampRetention', () => {
  it('passes through in-bounds values unchanged', () => {
    expect(clampRetention({ liveBufferSize: 500, storedHistorySize: 1000 })).toEqual({
      liveBufferSize: 500,
      storedHistorySize: 1000,
    });
  });

  it('clamps a huge hand-edited storedHistorySize down to the max bound', () => {
    expect(clampRetention({ liveBufferSize: 500, storedHistorySize: 999_999_999 })).toEqual({
      liveBufferSize: 500,
      storedHistorySize: PACKET_LOG_BOUNDS.storedHistorySize.max,
    });
  });

  it('clamps below-minimum values up to the min bound', () => {
    expect(clampRetention({ liveBufferSize: 1, storedHistorySize: -5 })).toEqual({
      liveBufferSize: PACKET_LOG_BOUNDS.liveBufferSize.min,
      storedHistorySize: PACKET_LOG_BOUNDS.storedHistorySize.min,
    });
  });

  it('falls back to defaults for non-numeric/corrupted values', () => {
    expect(clampRetention({ liveBufferSize: 'nope' as unknown as number, storedHistorySize: Number.NaN })).toEqual(
      DEFAULT_PACKET_LOG_SETTINGS,
    );
  });
});

// keep closeDb referenced so the import isn't tree-shaken in strict builds
void closeDb;
