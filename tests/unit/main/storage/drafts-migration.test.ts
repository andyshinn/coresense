import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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
  dir = mkdtempSync(join(tmpdir(), 'coresense-drafts-'));
  setUserDataDir(dir);
});

afterEach(async () => {
  await flushSettings();
  setUserDataDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('composer drafts migration out of ui-state.json', () => {
  // The upgrade path: drafts used to be nested inside UiState. On first launch
  // after the split they must be lifted, not dropped.
  test('lifts legacy drafts into drafts.json and strips them from ui-state.json', async () => {
    write('ui-state.json', { activeKey: 'ch:one', drafts: { 'ch:one': 'half-written' } });

    // Holder order: drafts first, then ui-state (which rewrites the file).
    const drafts = settingsStore.loadDrafts();
    const ui = settingsStore.loadUiState();
    await flushSettings();

    expect(drafts).toEqual({ 'ch:one': 'half-written' });
    expect(read('drafts.json')).toEqual({ 'ch:one': 'half-written' });
    expect(ui).not.toHaveProperty('drafts');
    // mergeDefaults copies unknown stored keys straight through, so the strip
    // has to be durable or the key is resurrected on every launch.
    expect(read('ui-state.json')).not.toHaveProperty('drafts');
    expect(read('ui-state.json').activeKey).toBe('ch:one');
  });

  test('is idempotent — a second launch finds nothing left to migrate', async () => {
    write('ui-state.json', { activeKey: 'ch:one', drafts: { 'ch:one': 'half-written' } });
    settingsStore.loadDrafts();
    settingsStore.loadUiState();
    await flushSettings();

    expect(settingsStore.loadDrafts()).toEqual({ 'ch:one': 'half-written' });
    expect(settingsStore.loadUiState()).not.toHaveProperty('drafts');
    await flushSettings();
    expect(read('ui-state.json')).not.toHaveProperty('drafts');
  });

  test('an existing drafts.json wins over a stale legacy key', async () => {
    write('ui-state.json', { activeKey: 'ch:one', drafts: { 'ch:one': 'stale' } });
    write('drafts.json', { 'ch:one': 'current' });

    expect(settingsStore.loadDrafts()).toEqual({ 'ch:one': 'current' });
    settingsStore.loadUiState();
    await flushSettings();
    expect(read('drafts.json')).toEqual({ 'ch:one': 'current' });
  });

  test('a clean install writes no drafts.json and rewrites nothing', async () => {
    write('ui-state.json', { activeKey: 'ch:one' });

    expect(settingsStore.loadDrafts()).toEqual({});
    expect(settingsStore.loadUiState()).not.toHaveProperty('drafts');
    await flushSettings();
    expect(exists('drafts.json')).toBe(false);
  });

  test('drops the retired log-filter substrings from ui-state.json', async () => {
    write('ui-state.json', {
      activeKey: 'ch:one',
      logsFilter: {
        minLevel: 'warn',
        showMain: true,
        showRenderer: true,
        paused: false,
        loggerSubstring: 'ble',
        textSubstring: 'stale',
      },
    });

    const ui = settingsStore.loadUiState();
    await flushSettings();

    // Session-only now, and deliberately NOT migrated anywhere: a substring
    // typed a week ago silently emptying the Logs panel is the bug being fixed.
    expect(ui.logsFilter).not.toHaveProperty('loggerSubstring');
    expect(ui.logsFilter).not.toHaveProperty('textSubstring');
    expect(read('ui-state.json').logsFilter).not.toHaveProperty('loggerSubstring');
    expect(read('ui-state.json').logsFilter).not.toHaveProperty('textSubstring');
    // The options that DO persist survive untouched.
    expect(ui.logsFilter.minLevel).toBe('warn');
  });

  test('rewrites ui-state.json once when both retired fields are present', async () => {
    write('ui-state.json', {
      activeKey: 'ch:one',
      drafts: { 'ch:one': 'half-written' },
      logsFilter: { minLevel: 'silly', showMain: true, showRenderer: true, paused: false, textSubstring: 'stale' },
    });

    settingsStore.loadDrafts();
    settingsStore.loadUiState();
    await flushSettings();

    const onDisk = read('ui-state.json');
    expect(onDisk).not.toHaveProperty('drafts');
    expect(onDisk.logsFilter).not.toHaveProperty('textSubstring');
    expect(read('drafts.json')).toEqual({ 'ch:one': 'half-written' });
  });

  test('round-trips saved drafts', async () => {
    settingsStore.saveDrafts({ 'ch:one': 'hello', 'c:abc': 'hi' });
    await flushSettings();
    expect(settingsStore.loadDrafts()).toEqual({ 'ch:one': 'hello', 'c:abc': 'hi' });
  });
});
