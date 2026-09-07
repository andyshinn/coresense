import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test';
import type { Channel, Contact } from '../../../src/shared/types';

// Playwright runs from the repo root; the built main entry is the package
// `main` field. `electron-forge package` populates `.vite/build` at the root.
const MAIN_ENTRY = join(process.cwd(), '.vite', 'build', 'index.js');
const DEFAULT_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'frames', 'e2e-connect.json');

export interface LaunchOptions {
  /** Replay fixture path; defaults to the connect-session fixture. */
  fixture?: string;
  /** Seed `channels.json` in the temp userData dir before launch. */
  channels?: Channel[];
  /** Seed `contacts.json` in the temp userData dir before launch. */
  contacts?: Contact[];
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  close: () => Promise<void>;
}

export async function launchApp(opts: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'coresense-e2e-'));
  if (opts.channels) {
    writeFileSync(join(userDataDir, 'channels.json'), JSON.stringify(opts.channels));
  }
  if (opts.contacts) {
    writeFileSync(join(userDataDir, 'contacts.json'), JSON.stringify(opts.contacts));
  }

  // Some harnesses (e.g. the Claude Code shell) export ELECTRON_RUN_AS_NODE=1,
  // which makes the Electron binary run as plain Node — `require('electron')`
  // then returns a path string instead of the API, so `app.isPackaged` blows
  // up at startup with "Cannot read properties of undefined". Strip it so the
  // launched binary boots as a real Electron main process.
  // BRIDGE_MDNS_NAME is read at src/main/index.ts and would otherwise leak a
  // developer's shell value into the test run.
  const STRIP_ENV = new Set(['ELECTRON_RUN_AS_NODE', 'BRIDGE_MDNS_NAME']);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STRIP_ENV.has(key)) {
      env[key] = value;
    }
  }

  // Playwright resolves the locally-installed Electron binary automatically
  // when executablePath is omitted; launching the entry script (not a packaged
  // bundle) keeps app.isPackaged === false.
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...env,
      CORESENSE_USER_DATA: userDataDir,
      CORESENSE_FAKE_TRANSPORT: opts.fixture ?? DEFAULT_FIXTURE,
      CORESENSE_LOG_LEVEL: 'warn',
      // Bind an ephemeral port. Without this the test app claims a well-known
      // port (7654/7754) and, on macOS, a 127.0.0.1 bind coexists with a
      // running app's 0.0.0.0 bind and *wins loopback* with no EADDRINUSE —
      // silently stealing the real app's API traffic (issue #21).
      CORESENSE_HTTP_PORT: '0',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const close = async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  };

  try {
    await assertIsolated(app, page, userDataDir);
  } catch (err) {
    // Never leave a mis-isolated app running: it is exactly the process that
    // would keep holding the hijacked port.
    await close().catch(() => {});
    throw err;
  }

  return { app, page, userDataDir, close };
}

/**
 * Fail fast if the launched app is not fully isolated from a real installation.
 *
 * These are the two ways an e2e run can damage (or be damaged by) the user's
 * installed app, and both used to be silent:
 *  - a packaged launch ignores CORESENSE_USER_DATA (src/main/storage/paths.ts
 *    gates the redirect on `!app.isPackaged`) and would read and overwrite the
 *    real profile;
 *  - binding a well-known HTTP port hijacks the installed app's loopback API.
 */
async function assertIsolated(app: ElectronApplication, page: Page, userDataDir: string): Promise<void> {
  const runtime = await app.evaluate(({ app: electronApp }) => ({
    isPackaged: electronApp.isPackaged,
    userData: electronApp.getPath('userData'),
  }));
  if (runtime.isPackaged) {
    throw new Error('e2e launched a packaged app: CORESENSE_USER_DATA is ignored and the real profile would be used');
  }
  // macOS tmpdir() is a symlink (/var/folders -> /private/var/folders), so
  // compare resolved paths.
  const expected = realpathSync(userDataDir);
  const actual = realpathSync(runtime.userData);
  if (actual !== expected) {
    throw new Error(`e2e userData is ${actual}, expected the temp profile ${expected}`);
  }
  const httpPort = await page.evaluate(() => window.coresense?.httpPort ?? null);
  if (httpPort === null) {
    throw new Error('e2e window has no injected httpPort: the preload did not run');
  }
  if (httpPort === 7654 || httpPort === 7754) {
    throw new Error(
      `e2e bound the well-known port ${httpPort}; it must use an ephemeral port so it cannot hijack a running app`,
    );
  }
}
