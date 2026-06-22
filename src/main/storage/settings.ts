import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MacroTemplate } from '../../shared/macros/types';
import {
  type AppSettings,
  type AutoAddConfig,
  type BlockRule,
  BRIDGE_DEFAULT_TCP_PORT_DEV,
  type Channel,
  type Contact,
  DEFAULT_APP_SETTINGS,
  DEFAULT_AUTO_ADD_CONFIG,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_GPS_CONFIG,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_TELEMETRY_POLICY,
  DEFAULT_UI_STATE,
  type DeviceIdentity,
  type DeviceInfo,
  type GpsConfig,
  type MapSettings,
  type RadioSettings,
  type TelemetryPolicy,
  type UiState,
} from '../../shared/types';
import { child } from '../log';
import { isPackaged } from '../runtime/appInfo';
import { userDataDir } from '../runtime/userData';

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
  deviceIdentity: 'device-identity.json',
  autoAdd: 'auto-add-config.json',
  telemetryPolicy: 'telemetry-policy.json',
  gps: 'gps-config.json',
  deviceInfo: 'device-info.json',
  blockRules: 'block-rules.json',
  macros: 'macros.json',
} as const;

function pathFor(file: string): string {
  return join(userDataDir(), file);
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

// First-run seed for AppSettings. In dev (`pnpm start`), substitute the dev
// proxy port so an installed build can run on its own port alongside the dev
// instance. Once `app-settings.json` has been written once, this seed no
// longer applies — `mergeDefaults` takes the stored value over the default.
function appSettingsSeed(): AppSettings {
  if (isPackaged()) return DEFAULT_APP_SETTINGS;
  return {
    ...DEFAULT_APP_SETTINGS,
    proxy: { ...DEFAULT_APP_SETTINGS.proxy, port: BRIDGE_DEFAULT_TCP_PORT_DEV },
  };
}

export const settingsStore = {
  loadAppSettings: (): AppSettings => {
    const seed = appSettingsSeed();
    return mergeDefaults(readJson(FILES.app, seed), seed);
  },
  saveAppSettings: (v: AppSettings): void => writeJson(FILES.app, v),

  loadRadioSettings: (): RadioSettings => {
    const merged = mergeDefaults(readJson(FILES.radio, DEFAULT_RADIO_SETTINGS), DEFAULT_RADIO_SETTINGS);
    // Legacy migration: PathHashSize used to allow 4, but firmware only
    // accepts 1/2/3 bytes per hop. Coerce anything else to the default.
    if (merged.pathHashMode !== 1 && merged.pathHashMode !== 2 && merged.pathHashMode !== 3) {
      log.warn(
        `radio-settings.json had invalid pathHashMode=${merged.pathHashMode}; coercing to ${DEFAULT_RADIO_SETTINGS.pathHashMode}`,
      );
      merged.pathHashMode = DEFAULT_RADIO_SETTINGS.pathHashMode;
      writeJson(FILES.radio, merged);
    }
    return merged;
  },
  saveRadioSettings: (v: RadioSettings): void => writeJson(FILES.radio, v),

  loadChannels: (): Channel[] => readJson(FILES.channels, []),
  saveChannels: (v: Channel[]): void => writeJson(FILES.channels, v),

  loadContacts: (): Contact[] => readJson(FILES.contacts, []),
  saveContacts: (v: Contact[]): void => writeJson(FILES.contacts, v),

  loadUiState: (): UiState => mergeDefaults(readJson(FILES.ui, DEFAULT_UI_STATE), DEFAULT_UI_STATE),
  saveUiState: (v: UiState): void => writeJson(FILES.ui, v),

  loadMapSettings: (): MapSettings => mergeDefaults(readJson(FILES.map, DEFAULT_MAP_SETTINGS), DEFAULT_MAP_SETTINGS),
  saveMapSettings: (v: MapSettings): void => writeJson(FILES.map, v),

  loadDeviceIdentity: (): DeviceIdentity =>
    mergeDefaults(readJson(FILES.deviceIdentity, DEFAULT_DEVICE_IDENTITY), DEFAULT_DEVICE_IDENTITY),
  saveDeviceIdentity: (v: DeviceIdentity): void => writeJson(FILES.deviceIdentity, v),

  loadAutoAddConfig: (): AutoAddConfig =>
    mergeDefaults(readJson(FILES.autoAdd, DEFAULT_AUTO_ADD_CONFIG), DEFAULT_AUTO_ADD_CONFIG),
  saveAutoAddConfig: (v: AutoAddConfig): void => writeJson(FILES.autoAdd, v),

  loadTelemetryPolicy: (): TelemetryPolicy =>
    mergeDefaults(readJson(FILES.telemetryPolicy, DEFAULT_TELEMETRY_POLICY), DEFAULT_TELEMETRY_POLICY),
  saveTelemetryPolicy: (v: TelemetryPolicy): void => writeJson(FILES.telemetryPolicy, v),

  loadGpsConfig: (): GpsConfig => mergeDefaults(readJson(FILES.gps, DEFAULT_GPS_CONFIG), DEFAULT_GPS_CONFIG),
  saveGpsConfig: (v: GpsConfig): void => writeJson(FILES.gps, v),

  loadDeviceInfo: (): DeviceInfo => mergeDefaults(readJson(FILES.deviceInfo, DEFAULT_DEVICE_INFO), DEFAULT_DEVICE_INFO),
  saveDeviceInfo: (v: DeviceInfo): void => writeJson(FILES.deviceInfo, v),

  loadBlockRules: (): BlockRule[] => readJson(FILES.blockRules, [] as BlockRule[]),
  saveBlockRules: (v: BlockRule[]): void => writeJson(FILES.blockRules, v),

  loadMacros: (): MacroTemplate[] => readJson(FILES.macros, [] as MacroTemplate[]),
  saveMacros: (v: MacroTemplate[]): void => writeJson(FILES.macros, v),
};

// Recursive merge so new fields added in code get default values when reading
// older files written before those fields existed — including fields nested
// inside an existing object (e.g. a new key under `composer`). Arrays and
// primitives are taken wholesale from the stored value.
function mergeDefaults<T>(stored: T, defaults: T): T {
  if (
    stored === null ||
    typeof stored !== 'object' ||
    Array.isArray(stored) ||
    typeof defaults !== 'object' ||
    defaults === null ||
    Array.isArray(defaults)
  ) {
    return stored;
  }
  const out: Record<string, unknown> = { ...(defaults as object) };
  for (const [key, storedVal] of Object.entries(stored as object)) {
    out[key] = mergeDefaults(storedVal, (defaults as Record<string, unknown>)[key]);
  }
  return out as T;
}
