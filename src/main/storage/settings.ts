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
  drafts: 'drafts.json',
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

/** Grace period before a read marker with no live conversation is dropped.
 *  It guards exactly one hazard: contacts.json persisted PARTIAL because the
 *  app was killed mid-first-sync (holder persistence is coalesced at 1s), which
 *  would make freshly-set markers look dead on the next launch. That is a
 *  session-scale risk, so the window is days rather than months — a 30-day one
 *  would retain a third of the dead markers on real data for no extra
 *  protection. Worst case if it is ever too short is a stale unread badge for
 *  one conversation: every unread consumer counts MESSAGES, not markers, so a
 *  marker with no messages behind it is a no-op. */
const LAST_READ_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Drop read markers whose conversation is gone. `lastReadByKey` only ever
 *  grows — markRead adds a key per conversation visited and markAllRead* seeds
 *  one per channel AND contact — and nothing removes entries when a contact is
 *  deleted or a discovered node ages out, so the map grows without bound with
 *  mesh size (98% of a 106 KB real-world ui-state.json).
 *
 *  Pure, and only ever called from the LOAD path. That is not a style choice:
 *  applyUiState merges read markers per key by MAX and never deletes
 *  (mergeLastRead in src/renderer/lib/store.ts), so a prune performed anywhere
 *  a client has already hydrated — on save, on a timer, in removeContact — is
 *  undone by that client's next full-object PUT. */
function pruneLastRead(
  map: Record<string, number>,
  liveKeys: ReadonlySet<string>,
  now: number,
): { next: Record<string, number>; dropped: number } {
  const next: Record<string, number> = {};
  let dropped = 0;
  for (const [key, ts] of Object.entries(map)) {
    // Conversation keys only. `tool:` and anything added later have no
    // channel/contact to be live against, so they are never candidates.
    const isConversation = key.startsWith('ch:') || key.startsWith('c:');
    if (isConversation && !liveKeys.has(key) && now - ts > LAST_READ_GRACE_MS) {
      dropped++;
      continue;
    }
    next[key] = ts;
  }
  return { next, dropped };
}

export const settingsStore = {
  loadAppSettings: (): AppSettings => {
    const seed = appSettingsSeed();
    const merged = mergeDefaults(readJson(FILES.app, seed), seed);
    const bag = merged as unknown as Record<string, unknown>;
    // mergeDefaults copies every stored key through, defaults or not. A field
    // that has LEFT AppSettings therefore has to be deleted actively, or it is
    // reloaded, re-broadcast and re-written forever — same trap as loadUiState.
    // `theme` is dropped rather than migrated into UiState.themePref: it was
    // written by a selector that never applied anything (issue #22), so
    // adopting it could override the theme the user really picked with the
    // Cmd-T cycle. Nothing is lost — the value never had an effect.
    if ('theme' in bag) {
      delete bag.theme;
      writeJson(FILES.app, merged);
      log.info('migrated retired field out of app-settings.json: theme');
    }
    return merged;
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

  /** @param liveKeys Conversation keys (`ch:`/`c:`) that still exist, used to
   *  drop dead read markers — see pruneLastRead. Optional: omit it (or pass an
   *  empty set) to skip the prune entirely. */
  loadUiState: (liveKeys?: ReadonlySet<string>): UiState => {
    const raw = readJson<Record<string, unknown>>(FILES.ui, {});
    const merged = mergeDefaults(raw as unknown as UiState, DEFAULT_UI_STATE);
    const bag = merged as unknown as Record<string, unknown>;
    // mergeDefaults copies every stored key through, defaults or not. A field
    // that has LEFT UiState therefore has to be deleted actively, or it is
    // reloaded, re-broadcast and re-written forever. Strip the retired ones and
    // rewrite the file once.
    const retired: string[] = [];
    if ('drafts' in raw) {
      // loadDrafts() has already lifted these into drafts.json by now — holder
      // constructs in that order.
      delete bag.drafts;
      retired.push('drafts');
    }
    const logsFilter = bag.logsFilter as Record<string, unknown> | undefined;
    if (logsFilter && ('loggerSubstring' in logsFilter || 'textSubstring' in logsFilter)) {
      // The Logs substring boxes are session-only now. Nothing is migrated:
      // a substring typed a week ago silently emptying the panel on launch is
      // the bug being fixed, so these are simply dropped.
      delete logsFilter.loggerSubstring;
      delete logsFilter.textSubstring;
      retired.push('logsFilter substrings');
    }
    // Read markers for conversations that no longer exist. Skipped when the
    // caller has no live keys — first run, or a missing/corrupt contacts.json
    // falling back to [] — since every marker would look dead against an empty
    // set.
    const pruned = liveKeys && liveKeys.size > 0 ? pruneLastRead(merged.lastReadByKey ?? {}, liveKeys, Date.now()) : null;
    if (pruned && pruned.dropped > 0) merged.lastReadByKey = pruned.next;
    // One rewrite covers both migrations; the log lines stay distinct so a
    // support log says which one actually fired.
    if (retired.length > 0 || (pruned && pruned.dropped > 0)) {
      writeJson(FILES.ui, merged);
      if (retired.length > 0) log.info(`migrated retired fields out of ui-state.json: ${retired.join(', ')}`);
      if (pruned && pruned.dropped > 0) {
        log.info(`pruned ${pruned.dropped} read marker(s) for gone conversations from ui-state.json`);
      }
    }
    return merged;
  },
  saveUiState: (v: UiState): void => writeJson(FILES.ui, v),

  /** Composer drafts, split out of ui-state.json so they get their own write
   *  cadence and stay off the uiState WS broadcast. Falls back to lifting them
   *  out of a legacy ui-state.json on first run after the split. MUST be called
   *  before loadUiState(), which strips and rewrites that file. */
  loadDrafts: (): Record<string, string> => {
    const own = readJson<Record<string, string> | null>(FILES.drafts, null);
    if (own) return own;
    const legacy = readJson<Record<string, unknown>>(FILES.ui, {});
    const lifted = (legacy.drafts as Record<string, string> | undefined) ?? {};
    if (Object.keys(lifted).length > 0) writeJson(FILES.drafts, lifted);
    return lifted;
  },
  saveDrafts: (v: Record<string, string>): void => writeJson(FILES.drafts, v),

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
