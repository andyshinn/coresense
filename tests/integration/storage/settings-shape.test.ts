import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { userDataDir } from '../../../src/main/runtime/userData';
import { createJsonWriter } from '../../../src/main/storage/jsonFile';
import { flushSettings, settingsStore } from '../../../src/main/storage/settings';
import { DEFAULT_MAP_SETTINGS, DEFAULT_UI_STATE } from '../../../src/shared/types';

const write = (file: string, raw: string) => writeFileSync(join(userDataDir(), file), raw, 'utf8');

// Regression: readJson used to return JSON.parse's result typed as the settings
// object, and mergeDefaults passed a non-object root straight through, so a
// corrupt file holding `5` or `[]` reached the holder (and the renderer) as if
// it were the settings — and a list file holding an object came back as one.
describe('settings loaders — corrupt root shapes fall back to defaults', () => {
  it.each(['5', '[]', 'null', '"text"'])('an object settings file holding %s yields the defaults', (raw) => {
    write('map-settings.json', raw);
    expect(settingsStore.loadMapSettings()).toEqual(DEFAULT_MAP_SETTINGS);
  });

  it('returns a fresh copy of the defaults, not the shared constant', () => {
    write('ui-state.json', '[]');
    const ui = settingsStore.loadUiState();
    expect(ui).toEqual({ ...DEFAULT_UI_STATE, packetLog: ui.packetLog });
    expect(ui).not.toBe(DEFAULT_UI_STATE);
    expect(ui.logsFilter).not.toBe(DEFAULT_UI_STATE.logsFilter);
  });

  it.each(['{}', '5', '{"a":1}'])('a list file holding %s yields an empty list', (raw) => {
    write('channels.json', raw);
    write('contacts.json', raw);
    write('block-rules.json', raw);
    write('macros.json', raw);
    expect(settingsStore.loadChannels()).toEqual([]);
    expect(settingsStore.loadContacts()).toEqual([]);
    expect(settingsStore.loadBlockRules()).toEqual([]);
    expect(settingsStore.loadMacros()).toEqual([]);
  });

  it('still reads a well-formed list file', () => {
    write('channels.json', JSON.stringify([{ key: 'ch:Ops', name: 'Ops' }]));
    expect(settingsStore.loadChannels()).toEqual([{ key: 'ch:Ops', name: 'Ops' }]);
  });

  it('ignores a drafts.json that is not a string map', async () => {
    write('drafts.json', '{"ch:Ops": 5}');
    expect(settingsStore.loadDrafts()).toEqual({});
    await flushSettings();
  });
});

describe('createJsonWriter', () => {
  it('serializes writes to one path so the last call wins', async () => {
    const errors: unknown[] = [];
    const writer = createJsonWriter((_path, err) => errors.push(err));
    const path = join(userDataDir(), 'w.json');
    for (let i = 0; i < 20; i++) writer.write(path, { i });
    await writer.flush();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ i: 19 });
    expect(errors).toEqual([]);
  });

  it('snapshots the value at call time and reports failures to onError', async () => {
    const errors: string[] = [];
    const writer = createJsonWriter((path) => errors.push(path));
    const path = join(userDataDir(), 'snap.json');
    const value = { n: 1 };
    writer.write(path, value);
    value.n = 2;
    const bad = join(userDataDir(), 'missing-dir', 'x.json');
    writer.write(bad, {});
    await writer.flush();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 1 });
    expect(errors).toEqual([bad]);
  });
});
