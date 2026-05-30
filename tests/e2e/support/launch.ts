import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
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
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const close = async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  };

  return { app, page, userDataDir, close };
}
