import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import {
  type AppSettings,
  type Channel,
  type Contact,
  DEFAULT_APP_SETTINGS,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_UI_STATE,
  type MapSettings,
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
  map: 'map-settings.json',
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

// Serialize writes per-file so concurrent saves (e.g. two quick UI changes)
// can't interleave write+rename and corrupt the on-disk JSON. Callers stay
// synchronous-looking; the write is fire-and-forget.
const writeChains = new Map<string, Promise<void>>();

function writeJson(file: string, value: unknown): void {
  const target = pathFor(file);
  const tmp = `${target}.tmp`;
  // Snapshot the value synchronously so callers can mutate their copy after
  // this returns without affecting the on-disk payload.
  const body = JSON.stringify(value, null, 2);
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      try {
        await writeFile(tmp, body, 'utf8');
        await rename(tmp, target);
      } catch (err) {
        log.error(`failed to write ${file}: ${(err as Error).message}`);
      }
    });
  writeChains.set(file, next);
}

export async function flushSettings(): Promise<void> {
  await Promise.all(writeChains.values());
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

  loadMapSettings: (): MapSettings =>
    mergeDefaults(readJson(FILES.map, DEFAULT_MAP_SETTINGS), DEFAULT_MAP_SETTINGS),
  saveMapSettings: (v: MapSettings): void => writeJson(FILES.map, v),
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
