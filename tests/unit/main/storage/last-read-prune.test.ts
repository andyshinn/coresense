import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setUserDataDir } from '../../../../src/main/runtime/userData';
import { flushSettings, settingsStore } from '../../../../src/main/storage/settings';

// Spy on the write so "rewritten exactly once" is asserted directly rather than
// inferred from the file's shape.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

let dir: string;

const DAY = 24 * 60 * 60 * 1000;
const write = (file: string, value: unknown) => writeFileSync(join(dir, file), JSON.stringify(value), 'utf8');
const read = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const uiWrites = () => vi.mocked(fsp.writeFile).mock.calls.filter((c) => String(c[0]).endsWith('ui-state.json.tmp')).length;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-lastread-'));
  setUserDataDir(dir);
  vi.mocked(fsp.writeFile).mockClear();
});

afterEach(async () => {
  await flushSettings();
  setUserDataDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('lastReadByKey prune on load', () => {
  const now = Date.now();
  const old = now - 60 * DAY;

  test('drops markers whose conversation is gone and keeps the live ones', async () => {
    write('ui-state.json', {
      activeKey: 'ch:one',
      lastReadByKey: { 'ch:one': old, 'c:alive': old, 'c:gone': old, 'ch:left': old },
    });

    const ui = settingsStore.loadUiState(new Set(['ch:one', 'c:alive']));
    await flushSettings();

    expect(ui.lastReadByKey).toEqual({ 'ch:one': old, 'c:alive': old });
    // Durability matters more than the in-memory value: if the file still held
    // the dead keys, the next launch would load and re-broadcast them.
    expect(read('ui-state.json').lastReadByKey).toEqual({ 'ch:one': old, 'c:alive': old });
  });

  test('keeps a dead marker that is still inside the grace window', async () => {
    const fresh = now - 2 * DAY;
    write('ui-state.json', { lastReadByKey: { 'c:gone-recently': fresh, 'c:gone-ages-ago': old } });

    const ui = settingsStore.loadUiState(new Set(['c:alive']));
    await flushSettings();

    // The window exists so a contacts.json persisted partial by a kill
    // mid-first-sync can't cost the user the markers they just set.
    expect(ui.lastReadByKey).toEqual({ 'c:gone-recently': fresh });
  });

  test('a marker just past the grace window is dropped', async () => {
    write('ui-state.json', { lastReadByKey: { 'c:gone': now - 8 * DAY } });

    const ui = settingsStore.loadUiState(new Set(['c:alive']));
    await flushSettings();

    expect(ui.lastReadByKey).toEqual({});
  });

  test('an empty live set prunes nothing and rewrites nothing', async () => {
    const stored = { 'c:gone': old, 'ch:left': old };
    write('ui-state.json', { lastReadByKey: { ...stored } });

    // First run, or a missing/corrupt contacts.json falling back to []. Every
    // marker would look dead, so the prune must not run at all.
    const ui = settingsStore.loadUiState(new Set());
    await flushSettings();

    expect(ui.lastReadByKey).toEqual(stored);
    expect(uiWrites()).toBe(0);
  });

  test('calling loadUiState with no live set prunes nothing', async () => {
    const stored = { 'c:gone': old };
    write('ui-state.json', { lastReadByKey: { ...stored } });

    const ui = settingsStore.loadUiState();
    await flushSettings();

    expect(ui.lastReadByKey).toEqual(stored);
    expect(uiWrites()).toBe(0);
  });

  test('markers with a non-conversation prefix are never touched', async () => {
    write('ui-state.json', {
      lastReadByKey: { 'tool:packetlog': old, 'search:whatever': old, 'c:alive': old },
    });

    const ui = settingsStore.loadUiState(new Set(['c:alive']));
    await flushSettings();

    // `tool:` and anything added later have no channel/contact to be live
    // against, so liveness is not a question that can be asked of them.
    expect(ui.lastReadByKey).toEqual({ 'tool:packetlog': old, 'search:whatever': old, 'c:alive': old });
    expect(uiWrites()).toBe(0);
  });

  test('rewrites ui-state.json exactly once when something was pruned', async () => {
    write('ui-state.json', { lastReadByKey: { 'c:gone': old, 'c:also-gone': old, 'c:alive': old } });

    settingsStore.loadUiState(new Set(['c:alive']));
    await flushSettings();

    expect(uiWrites()).toBe(1);
  });

  test('does not rewrite when every marker is live', async () => {
    write('ui-state.json', { lastReadByKey: { 'c:alive': old, 'ch:one': old } });

    settingsStore.loadUiState(new Set(['c:alive', 'ch:one']));
    await flushSettings();

    expect(uiWrites()).toBe(0);
  });

  test('prune and retired-field stripping coalesce into a single rewrite', async () => {
    write('ui-state.json', {
      drafts: { 'ch:one': 'half-written' },
      logsFilter: { minLevel: 'warn', showMain: true, showRenderer: true, paused: false, textSubstring: 'stale' },
      lastReadByKey: { 'c:gone': old, 'c:alive': old },
    });

    settingsStore.loadDrafts();
    settingsStore.loadUiState(new Set(['c:alive']));
    await flushSettings();

    expect(uiWrites()).toBe(1);
    const onDisk = read('ui-state.json');
    expect(onDisk).not.toHaveProperty('drafts');
    expect(onDisk.logsFilter).not.toHaveProperty('textSubstring');
    expect(onDisk.lastReadByKey).toEqual({ 'c:alive': old });
  });

  test('is idempotent — a second launch finds nothing left to prune', async () => {
    write('ui-state.json', { lastReadByKey: { 'c:gone': old, 'c:alive': old } });

    settingsStore.loadUiState(new Set(['c:alive']));
    await flushSettings();
    vi.mocked(fsp.writeFile).mockClear();

    const ui = settingsStore.loadUiState(new Set(['c:alive']));
    await flushSettings();

    expect(ui.lastReadByKey).toEqual({ 'c:alive': old });
    expect(uiWrites()).toBe(0);
  });

  test('a ui-state.json with no lastReadByKey at all is left alone', async () => {
    write('ui-state.json', { activeKey: 'ch:one' });

    const ui = settingsStore.loadUiState(new Set(['ch:one']));
    await flushSettings();

    expect(ui.lastReadByKey).toEqual({});
    expect(uiWrites()).toBe(0);
  });

  test('the rest of UiState survives a prune untouched', async () => {
    write('ui-state.json', {
      activeKey: 'ch:one',
      pinned: ['ch:one'],
      recentKeys: ['ch:one', 'c:gone'],
      rightWidth: 420,
      lastReadByKey: { 'c:gone': old, 'ch:one': old },
    });

    const ui = settingsStore.loadUiState(new Set(['ch:one']));
    await flushSettings();

    // Only the read-marker map is in scope. `pinned`/`recentKeys` can also name
    // a dead conversation; both are bounded already and are not touched here.
    expect(ui.activeKey).toBe('ch:one');
    expect(ui.pinned).toEqual(['ch:one']);
    expect(ui.recentKeys).toEqual(['ch:one', 'c:gone']);
    expect(ui.rightWidth).toBe(420);
  });
});
