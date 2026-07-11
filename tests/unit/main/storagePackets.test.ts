import { afterEach, describe, expect, it, vi } from 'vitest';

// packetStore uses openDb() → a real on-disk sqlite file. Point userDataDir at a
// fresh temp dir per test run so we exercise the real DDL + statements.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cs-packets-'));
vi.mock('../../../src/main/runtime/userData', () => ({ userDataDir: () => dir }));

import type { RawPacket } from '../../../src/shared/types';
import { closeDb } from '../../../src/main/storage/db';
import { packetStore } from '../../../src/main/storage/packets';

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

  it('clear empties the table', () => {
    packetStore.record(mk(1), 100);
    packetStore.clear();
    expect(packetStore.recent(10)).toEqual([]);
  });
});

// keep closeDb referenced so the import isn't tree-shaken in strict builds
void closeDb;
