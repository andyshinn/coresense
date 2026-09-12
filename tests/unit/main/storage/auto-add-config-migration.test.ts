import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setAppInfo } from '../../../../src/main/runtime/appInfo';
import { setUserDataDir } from '../../../../src/main/runtime/userData';
import { flushSettings, settingsStore } from '../../../../src/main/storage/settings';

let dir: string;

const FILE = 'auto-add-config.json';
const write = (value: unknown) => writeFileSync(join(dir, FILE), JSON.stringify(value), 'utf8');
const read = () => JSON.parse(readFileSync(join(dir, FILE), 'utf8'));
const exists = () => {
  try {
    readFileSync(join(dir, FILE));
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-auto-add-'));
  setUserDataDir(dir);
  setAppInfo({ isPackaged: true, appPath: process.cwd() });
});

afterEach(async () => {
  await flushSettings();
  setAppInfo(null);
  setUserDataDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('auto-add-config.json migration', () => {
  // `mode` used to be independent app-side state; it is now a view of
  // manual_add_contacts bit 0. A file that predates the byte would otherwise
  // load as "Selected" with the bit clear — a config that can never reconcile
  // itself: the panel isn't dirty so Save is disabled, and RESP_SELF_INFO
  // agrees with the 0 so the library never emits a correction. The user gets
  // none of the fix while the UI claims their selection is in force.
  test('derives manual_add_contacts bit 0 from a stored mode of "selected"', async () => {
    write({ mode: 'selected', chat: true, repeater: false, room: false, sensor: false, maxHops: null });

    const cfg = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(cfg.mode).toBe('selected');
    expect(cfg.manualAddContacts).toBe(1);
    expect(read().manualAddContacts).toBe(1);
    // The kind selection the user made is what the bit now makes effective.
    expect(cfg.chat).toBe(true);
    expect(cfg.repeater).toBe(false);
  });

  test('leaves a stored mode of "all" at bit 0 clear', async () => {
    write({ mode: 'all', chat: true, repeater: true, room: true, sensor: true });

    const cfg = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(cfg.manualAddContacts).toBe(0);
  });

  test('never overrides a byte the radio has already reported', async () => {
    // Bit 0 clear with mode 'selected' is a legitimate mid-flight state once the
    // byte exists (the radio said "all", the user has not saved yet), so the
    // seed must only fire when the field is absent altogether.
    write({ mode: 'selected', manualAddContacts: 0 });

    expect(settingsStore.loadAutoAddConfig().manualAddContacts).toBe(0);
    await flushSettings();
  });

  test('strips the retired app-side maxHops filter without adopting it', async () => {
    write({ mode: 'all', maxHops: 2, radioMaxHops: 0 });

    const cfg = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(cfg).not.toHaveProperty('maxHops');
    // Adopting it would push a hop limit to the radio that the app-side filter
    // never actually applied to anything.
    expect(cfg.radioMaxHops).toBe(0);
    // mergeDefaults copies unknown stored keys straight through, so the strip
    // has to be durable or the key is resurrected forever.
    expect(read()).not.toHaveProperty('maxHops');
  });

  test('is idempotent — a second launch finds nothing left to migrate', async () => {
    write({ mode: 'selected', maxHops: null });
    settingsStore.loadAutoAddConfig();
    await flushSettings();

    const second = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(second.manualAddContacts).toBe(1);
    expect(second).not.toHaveProperty('maxHops');
    expect(read()).not.toHaveProperty('maxHops');
  });

  test('a clean install writes nothing and gets the defaults', async () => {
    const cfg = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(cfg.mode).toBe('all');
    expect(cfg.manualAddContacts).toBe(0);
    expect(cfg.radioMaxHops).toBe(0);
    expect(exists()).toBe(false);
  });
});
