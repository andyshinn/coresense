import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setAppInfo } from '../../../../src/main/runtime/appInfo';
import { setUserDataDir } from '../../../../src/main/runtime/userData';
import { flushSettings, settingsStore } from '../../../../src/main/storage/settings';

let dir: string;

const write = (file: string, value: unknown) => writeFileSync(join(dir, file), JSON.stringify(value), 'utf8');
const read = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const exists = (file: string) => {
  try {
    readFileSync(join(dir, file));
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-app-theme-'));
  setUserDataDir(dir);
  // appSettingsSeed() consults isPackaged() to pick the dev proxy port.
  setAppInfo({ isPackaged: true, appPath: process.cwd() });
});

afterEach(async () => {
  await flushSettings();
  setAppInfo(null);
  setUserDataDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('retired AppSettings.theme migration out of app-settings.json', () => {
  // Issue #22: the Appearance selector used to write AppSettings.theme, which
  // nothing ever applied. The live preference is UiState.themePref, so the dead
  // field is stripped from disk rather than migrated — adopting a value that
  // never had an effect could override the theme the user actually picked.
  test('strips theme from app-settings.json on first load', async () => {
    write('app-settings.json', { theme: 'light', messageStyle: 'compact', timeFormat: '24h' });

    const settings = settingsStore.loadAppSettings();
    await flushSettings();

    expect(settings).not.toHaveProperty('theme');
    // mergeDefaults copies unknown stored keys straight through, so the strip
    // has to be durable or the key is resurrected (and re-broadcast) forever.
    expect(read('app-settings.json')).not.toHaveProperty('theme');
  });

  test('leaves every other stored setting untouched', async () => {
    write('app-settings.json', {
      theme: 'dark',
      messageStyle: 'compact',
      identityColorMode: 'byName',
      composer: { returnToSend: false, autoFocus: true },
    });

    const settings = settingsStore.loadAppSettings();
    await flushSettings();

    expect(settings.messageStyle).toBe('compact');
    expect(settings.identityColorMode).toBe('byName');
    expect(settings.composer.returnToSend).toBe(false);
    // Defaults still fill in for keys the stored file predates.
    expect(settings.timeFormat).toBe('auto');
    const onDisk = read('app-settings.json');
    expect(onDisk.messageStyle).toBe('compact');
    expect(onDisk.composer.returnToSend).toBe(false);
  });

  test('does not migrate the dead value into the ui theme preference', async () => {
    write('app-settings.json', { theme: 'light' });
    write('ui-state.json', { themePref: 'dark' });

    settingsStore.loadAppSettings();
    const ui = settingsStore.loadUiState();
    await flushSettings();

    // The theme the user really chose (Cmd-T writes ui.themePref) wins; the
    // never-applied AppSettings value is dropped, not adopted.
    expect(ui.themePref).toBe('dark');
  });

  test('is idempotent — a second launch finds nothing left to migrate', async () => {
    write('app-settings.json', { theme: 'light', messageStyle: 'compact' });
    settingsStore.loadAppSettings();
    await flushSettings();

    const second = settingsStore.loadAppSettings();
    await flushSettings();

    expect(second).not.toHaveProperty('theme');
    expect(second.messageStyle).toBe('compact');
    expect(read('app-settings.json')).not.toHaveProperty('theme');
  });

  test('a clean install writes nothing and gets no theme field', async () => {
    const settings = settingsStore.loadAppSettings();
    await flushSettings();

    expect(settings).not.toHaveProperty('theme');
    expect(exists('app-settings.json')).toBe(false);
  });
});
