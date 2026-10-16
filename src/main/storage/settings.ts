import { basename, join } from 'node:path';
import { conversationKind } from '../../shared/conversationKey';
import { errorMessage } from '../../shared/errors';
import type { MacroTemplate } from '../../shared/macros/types';
import { clampRetention } from '../../shared/packetLog';
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
import { createJsonWriter, isPlainObject, readJsonFile } from './jsonFile';

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

/** A settings file's parsed root, or undefined when it is missing or fails
 *  `guard` (logged), so the caller falls back to its defaults. */
function readJson<T>(file: string, guard: (v: unknown) => v is T): T | undefined {
  return readJsonFile(pathFor(file), guard, (reason) =>
    log.warn(`failed to read ${file}: ${reason} — falling back to defaults`),
  );
}

/** Root guard for the list files. Shallow on purpose: it turns a corrupt root
 *  (an object, a number) into an empty list, not a malformed element. */
function isList<T>(v: unknown): v is T[] {
  return Array.isArray(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return isPlainObject(v) && Object.values(v).every((x) => typeof x === 'string');
}

// Per-file serialized atomic writes; see createJsonWriter.
const writer = createJsonWriter((path, err) => log.error(`failed to write ${basename(path)}: ${errorMessage(err)}`));

function writeJson(file: string, value: unknown): void {
  writer.write(pathFor(file), value);
}

export async function flushSettings(): Promise<void> {
  await writer.flush();
}

/** Delete fields that have LEFT a settings type from a loaded object, returning
 *  the names actually removed. mergeDefaults copies every stored key through,
 *  defaults or not, so a retired field has to be deleted actively, or it is
 *  reloaded, re-broadcast and re-written forever. */
function stripRetired(target: object, keys: readonly string[]): string[] {
  const bag = target as Record<string, unknown>;
  return keys.filter((key) => {
    if (!(key in bag)) return false;
    delete bag[key];
    return true;
  });
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
 *  (mergeLastRead in src/renderer/lib/store/ui.ts), so a prune performed anywhere
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
    const isConversation = conversationKind(key) !== null;
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
    const merged = mergeDefaults(readJson(FILES.app, isPlainObject), seed);
    // Retired field (see stripRetired) — same trap as loadUiState.
    // `theme` is dropped rather than migrated into UiState.themePref: it was
    // written by a selector that never applied anything (issue #22), so
    // adopting it could override the theme the user really picked with the
    // Cmd-T cycle. Nothing is lost — the value never had an effect.
    if (stripRetired(merged, ['theme']).length > 0) {
      writeJson(FILES.app, merged);
      log.info('migrated retired field out of app-settings.json: theme');
    }
    return merged;
  },
  saveAppSettings: (v: AppSettings): void => writeJson(FILES.app, v),

  loadRadioSettings: (): RadioSettings => {
    const merged = mergeDefaults(readJson(FILES.radio, isPlainObject), DEFAULT_RADIO_SETTINGS);
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

  loadChannels: (): Channel[] => readJson(FILES.channels, isList<Channel>) ?? [],
  saveChannels: (v: Channel[]): void => writeJson(FILES.channels, v),

  loadContacts: (): Contact[] => readJson(FILES.contacts, isList<Contact>) ?? [],
  saveContacts: (v: Contact[]): void => writeJson(FILES.contacts, v),

  /** @param liveKeys Conversation keys (`ch:`/`c:`) that still exist, used to
   *  drop dead read markers — see pruneLastRead. Optional: omit it (or pass an
   *  empty set) to skip the prune entirely. */
  loadUiState: (liveKeys?: ReadonlySet<string>): UiState => {
    const merged = mergeDefaults(readJson(FILES.ui, isPlainObject), DEFAULT_UI_STATE);
    // mergeDefaults passes a stored `"packetLog": null` (or out-of-range numbers
    // from a hand edit) straight through, and the renderer reads it unguarded.
    merged.packetLog = clampRetention(merged.packetLog);
    // Retired fields (see stripRetired). Strip them and rewrite the file once.
    //  - drafts: loadDrafts() has already lifted these into drafts.json by now
    //    — holder constructs in that order.
    //  - decoderOpen: the packet decoder dialog's open flag was briefly
    //    persisted by pre-release Packet Log builds, which reopened the dialog
    //    on launch. It is session-only store state now.
    const retired = stripRetired(merged, ['drafts', 'decoderOpen']);
    // The Logs substring boxes are session-only now. Nothing is migrated:
    // a substring typed a week ago silently emptying the panel on launch is
    // the bug being fixed, so these are simply dropped.
    if (
      isPlainObject(merged.logsFilter) &&
      stripRetired(merged.logsFilter, ['loggerSubstring', 'textSubstring']).length > 0
    ) {
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
    const own = readJson(FILES.drafts, isStringRecord);
    if (own) return own;
    const legacy = readJson(FILES.ui, isPlainObject);
    const lifted = isStringRecord(legacy?.drafts) ? legacy.drafts : {};
    if (Object.keys(lifted).length > 0) writeJson(FILES.drafts, lifted);
    return lifted;
  },
  saveDrafts: (v: Record<string, string>): void => writeJson(FILES.drafts, v),

  loadMapSettings: (): MapSettings => mergeDefaults(readJson(FILES.map, isPlainObject), DEFAULT_MAP_SETTINGS),
  saveMapSettings: (v: MapSettings): void => writeJson(FILES.map, v),

  loadDeviceIdentity: (): DeviceIdentity =>
    mergeDefaults(readJson(FILES.deviceIdentity, isPlainObject), DEFAULT_DEVICE_IDENTITY),
  saveDeviceIdentity: (v: DeviceIdentity): void => writeJson(FILES.deviceIdentity, v),

  loadAutoAddConfig: (): AutoAddConfig => {
    const stored = readJson(FILES.autoAdd, isPlainObject) ?? {};
    const merged = mergeDefaults(stored, DEFAULT_AUTO_ADD_CONFIG);
    let migrated = false;
    // `mode` used to be independent app-side state; it is now a VIEW of
    // manual_add_contacts bit 0. A file written before that byte existed can
    // hold mode:'selected' with no byte at all, and mergeDefaults would supply
    // 0 — an internally inconsistent config that reads as "Selected" in the
    // panel while the radio auto-adds everything. Nothing would ever reconcile
    // it: the panel isn't dirty so Save is disabled, and RESP_SELF_INFO agrees
    // with the 0 so the library never emits a correction. Seed the bit from the
    // stored mode once, so the next save has a real change to push.
    if (!('manualAddContacts' in stored) && merged.mode === 'selected') {
      merged.manualAddContacts = 1;
      migrated = true;
      log.info('migrated auto-add-config.json: derived manual_add_contacts bit 0 from the stored mode');
    }
    // Retired fields (see stripRetired) — same trap as AppSettings.theme.
    //  - maxHops: an app-side advert filter that nothing on either side ever
    //    applied; the radio's own `autoadd_max_hops` (`radioMaxHops`) replaced
    //    it. It is NOT adopted as the new value — that would push a hop limit
    //    to the radio the user never actually got.
    //  - pullToRefresh: a toggle nothing ever read, persisted as `true` for
    //    everyone. Its replacement (`autoRefreshContacts`) drives a real
    //    periodic GET_CONTACTS walk, so the old value is deliberately NOT
    //    carried over — nobody gets opted into radio traffic by a setting that
    //    never did anything.
    for (const field of stripRetired(merged, ['maxHops', 'pullToRefresh'])) {
      migrated = true;
      log.info(`migrated retired field out of auto-add-config.json: ${field}`);
    }
    if (migrated) writeJson(FILES.autoAdd, merged);
    return merged;
  },
  saveAutoAddConfig: (v: AutoAddConfig): void => writeJson(FILES.autoAdd, v),

  loadTelemetryPolicy: (): TelemetryPolicy =>
    mergeDefaults(readJson(FILES.telemetryPolicy, isPlainObject), DEFAULT_TELEMETRY_POLICY),
  saveTelemetryPolicy: (v: TelemetryPolicy): void => writeJson(FILES.telemetryPolicy, v),

  loadGpsConfig: (): GpsConfig => mergeDefaults(readJson(FILES.gps, isPlainObject), DEFAULT_GPS_CONFIG),
  saveGpsConfig: (v: GpsConfig): void => writeJson(FILES.gps, v),

  loadDeviceInfo: (): DeviceInfo => mergeDefaults(readJson(FILES.deviceInfo, isPlainObject), DEFAULT_DEVICE_INFO),
  saveDeviceInfo: (v: DeviceInfo): void => writeJson(FILES.deviceInfo, v),

  loadBlockRules: (): BlockRule[] => readJson(FILES.blockRules, isList<BlockRule>) ?? [],
  saveBlockRules: (v: BlockRule[]): void => writeJson(FILES.blockRules, v),

  loadMacros: (): MacroTemplate[] => readJson(FILES.macros, isList<MacroTemplate>) ?? [],
  saveMacros: (v: MacroTemplate[]): void => writeJson(FILES.macros, v),
};

// Recursive merge so new fields added in code get default values when reading
// older files written before those fields existed — including fields nested
// inside an existing object (e.g. a new key under `composer`). Below the root,
// arrays and primitives are taken wholesale from the stored value. A root that
// is missing or not an object (a corrupt file holding `5` or `[]`) yields the
// defaults. The defaults are deep-cloned first, so the result never shares an
// array or nested object with a DEFAULT_* constant: loaders mutate what they
// get back.
function mergeDefaults<T extends object>(stored: unknown, defaults: T): T {
  const fresh = structuredClone(defaults);
  return mergeValue(isPlainObject(stored) ? stored : fresh, fresh) as T;
}

// JSON.parse makes `__proto__` an own key, and assigning it through `out[key]`
// would swap the merged object's prototype. A hand-edited file has no business
// setting these, so they are dropped.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function mergeValue(stored: unknown, defaults: unknown): unknown {
  if (!isPlainObject(stored) || !isPlainObject(defaults)) return stored;
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, storedVal] of Object.entries(stored)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = mergeValue(storedVal, defaults[key]);
  }
  return out;
}
