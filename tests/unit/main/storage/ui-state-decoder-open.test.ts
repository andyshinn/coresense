import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setUserDataDir } from '../../../../src/main/runtime/userData';
import { flushSettings, settingsStore } from '../../../../src/main/storage/settings';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-decoder-open-'));
  setUserDataDir(dir);
});

afterEach(async () => {
  await flushSettings();
  setUserDataDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('decoderOpen retired from ui-state.json', () => {
  // mergeDefaults copies unknown stored keys through, so without an active
  // strip the flag would ride every hydrate → PUT round trip forever.
  test('strips a persisted decoderOpen and rewrites the file', async () => {
    writeFileSync(join(dir, 'ui-state.json'), JSON.stringify({ activeKey: 'tool:packetlog', decoderOpen: true }), 'utf8');

    const ui = settingsStore.loadUiState();
    await flushSettings();

    expect(ui).not.toHaveProperty('decoderOpen');
    const onDisk = JSON.parse(readFileSync(join(dir, 'ui-state.json'), 'utf8'));
    expect(onDisk).not.toHaveProperty('decoderOpen');
    expect(onDisk.activeKey).toBe('tool:packetlog');
  });
});
