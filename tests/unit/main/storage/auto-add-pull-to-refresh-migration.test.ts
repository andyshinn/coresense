import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setUserDataDir } from '../../../../src/main/runtime/userData';
import { flushSettings, settingsStore } from '../../../../src/main/storage/settings';

let dir: string;

const write = (value: unknown) => writeFileSync(join(dir, 'auto-add-config.json'), JSON.stringify(value), 'utf8');
const read = () => JSON.parse(readFileSync(join(dir, 'auto-add-config.json'), 'utf8'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-auto-add-'));
  setUserDataDir(dir);
});

afterEach(async () => {
  await flushSettings();
  setUserDataDir(null);
  rmSync(dir, { recursive: true, force: true });
});

// #45 item 6: `pullToRefresh` was a toggle nothing ever read, defaulting to
// true — so it is persisted as true for everyone who has ever opened Settings.
// Its replacement, `autoRefreshContacts`, drives a real periodic GET_CONTACTS
// walk (tens of seconds of companion-link traffic). Carrying the old value over
// would have opted the entire installed base into radio traffic on the strength
// of a setting that never did anything.
describe('retired AutoAddConfig.pullToRefresh migration out of auto-add-config.json', () => {
  test('does NOT inherit the old toggle as the new auto-refresh opt-in', async () => {
    write({ mode: 'all', pullToRefresh: true });

    const cfg = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(cfg.autoRefreshContacts).toBe(false);
  });

  test('strips the dead key from disk so it cannot be resurrected', async () => {
    write({ mode: 'selected', pullToRefresh: true, showPublicKeys: false });

    const cfg = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(cfg).not.toHaveProperty('pullToRefresh');
    // mergeDefaults copies unknown stored keys straight through, so the strip
    // has to be durable or the key rides along forever.
    expect(read()).not.toHaveProperty('pullToRefresh');
  });

  test('leaves every other stored auto-add setting untouched', async () => {
    write({ mode: 'selected', chat: false, repeater: true, radioMaxHops: 3, pullToRefresh: true, showPublicKeys: false });

    const cfg = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(cfg.mode).toBe('selected');
    expect(cfg.chat).toBe(false);
    expect(cfg.repeater).toBe(true);
    expect(cfg.radioMaxHops).toBe(3);
    expect(cfg.showPublicKeys).toBe(false);
    // Defaults still fill in for keys the stored file predates.
    expect(cfg.overwriteOldest).toBe(true);
  });

  test('keeps an explicit opt-in the user has since made', async () => {
    write({ mode: 'all', pullToRefresh: true, autoRefreshContacts: true });

    const cfg = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(cfg.autoRefreshContacts).toBe(true);
    expect(cfg).not.toHaveProperty('pullToRefresh');
  });

  test('is idempotent — a second launch finds nothing left to migrate', async () => {
    write({ mode: 'all', pullToRefresh: false });
    settingsStore.loadAutoAddConfig();
    await flushSettings();

    const second = settingsStore.loadAutoAddConfig();
    await flushSettings();

    expect(second).not.toHaveProperty('pullToRefresh');
    expect(second.autoRefreshContacts).toBe(false);
    expect(read()).not.toHaveProperty('pullToRefresh');
  });
});
