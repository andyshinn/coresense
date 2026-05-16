import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import {
  type AppSettings,
  type Channel,
  type Contact,
  DEFAULT_APP_SETTINGS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_UI_STATE,
  type RadioSettings,
  type UiState,
} from '../../shared/types';
import { child } from '../log';

const log = child('settings');

// Each concern lives in its own file so a corrupt one doesn't take down the
// rest of the app. Atomic write = write to .tmp then rename.
const FILES = {
  app: 'app-settings.json',
  radio: 'radio-settings.json',
  channels: 'channels.json',
  contacts: 'contacts.json',
  ui: 'ui-state.json',
} as const;

function pathFor(file: string): string {
  return join(app.getPath('userData'), file);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = readFileSync(pathFor(file), 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code && e.code !== 'ENOENT') {
      log.warn(`failed to read ${file}: ${e.message} — falling back to defaults`);
    }
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  const target = pathFor(file);
  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(tmp, target);
  } catch (err) {
    log.error(`failed to write ${file}: ${(err as Error).message}`);
  }
}

export const settingsStore = {
  loadAppSettings: (): AppSettings =>
    mergeDefaults(readJson(FILES.app, DEFAULT_APP_SETTINGS), DEFAULT_APP_SETTINGS),
  saveAppSettings: (v: AppSettings): void => writeJson(FILES.app, v),

  loadRadioSettings: (): RadioSettings =>
    mergeDefaults(readJson(FILES.radio, DEFAULT_RADIO_SETTINGS), DEFAULT_RADIO_SETTINGS),
  saveRadioSettings: (v: RadioSettings): void => writeJson(FILES.radio, v),

  loadChannels: (): Channel[] => readJson(FILES.channels, []),
  saveChannels: (v: Channel[]): void => writeJson(FILES.channels, v),

  loadContacts: (): Contact[] => readJson(FILES.contacts, []),
  saveContacts: (v: Contact[]): void => writeJson(FILES.contacts, v),

  loadUiState: (): UiState => mergeDefaults(readJson(FILES.ui, DEFAULT_UI_STATE), DEFAULT_UI_STATE),
  saveUiState: (v: UiState): void => writeJson(FILES.ui, v),
};

// Shallow merge so new fields added in code get default values when reading
// older files written before those fields existed. Skips top-level arrays.
function mergeDefaults<T>(stored: T, defaults: T): T {
  if (
    stored === null ||
    typeof stored !== 'object' ||
    Array.isArray(stored) ||
    typeof defaults !== 'object' ||
    defaults === null
  ) {
    return stored;
  }
  return { ...(defaults as object), ...(stored as object) } as T;
}
