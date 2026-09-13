import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setUserDataDir } from '../../../../src/main/runtime/userData';
import { flushSettings, settingsStore } from '../../../../src/main/storage/settings';
import { DEFAULT_PACKET_LOG_SETTINGS, PACKET_LOG_BOUNDS } from '../../../../src/shared/types';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-packetlog-'));
  setUserDataDir(dir);
});

afterEach(async () => {
  await flushSettings();
  setUserDataDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const load = (stored: unknown) => {
  writeFileSync(join(dir, 'ui-state.json'), JSON.stringify(stored), 'utf8');
  return settingsStore.loadUiState();
};

// mergeDefaults passes stored values through untouched, and the renderer reads
// ui.packetLog unguarded (applyPacket, applyUiState, the settings section).
describe('loadUiState normalises packetLog', () => {
  test('a stored null becomes the defaults', () => {
    expect(load({ packetLog: null }).packetLog).toEqual(DEFAULT_PACKET_LOG_SETTINGS);
  });

  test('hand-edited out-of-range values are clamped', () => {
    expect(load({ packetLog: { liveBufferSize: 5, storedHistorySize: 9e9 } }).packetLog).toEqual({
      liveBufferSize: PACKET_LOG_BOUNDS.liveBufferSize.min,
      storedHistorySize: PACKET_LOG_BOUNDS.storedHistorySize.max,
    });
  });
});
