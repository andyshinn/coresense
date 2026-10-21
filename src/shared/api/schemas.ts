import { z } from 'zod';
import { type ActiveKey, isActiveKey } from '../keys';
import { LOG_LEVELS } from '../logLevels';
import type { MacroTemplate } from '../macros/types';
import { QUICK_ACTION_IDS } from '../quickActions';
import {
  type AppSettings,
  type AutoAddConfig,
  type BlockRule,
  type Channel,
  CONTACT_KINDS,
  type Contact,
  type DeviceIdentity,
  type GpsConfig,
  type MapSettings,
  type RadioSettings,
  type SearchOptions,
  type TelemetryPerms,
  type TelemetryPolicy,
  type UiState,
} from '../types';

// Request-body schemas for the HTTP API, and the parsers for the domain shapes
// those bodies carry. The TypeScript types in shared/types stay the source of
// truth: `exactly<T>()` makes tsc reject a schema whose output is not exactly
// `T`, so a field added to a type without its schema fails to compile instead
// of being silently stripped from every request that carries it.

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

function exactly<T>() {
  return <S extends z.ZodType>(schema: S & (Equals<z.output<S>, T> extends true ? unknown : never)): S => schema;
}

const contactKind = z.enum(CONTACT_KINDS);
const pathHashSize = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const telemetryMode = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const searchSort = z.enum(['relevance', 'recency']);
const messageStyle = z.enum(['compact', 'rich']);
const kindFlags = { chat: z.boolean(), repeater: z.boolean(), room: z.boolean(), sensor: z.boolean() };

// ---- Domain shapes ----------------------------------------------------------

export const appSettingsSchema = exactly<AppSettings>()(
  z.object({
    identityColorMode: z.enum(['byKey', 'byName']),
    messageStyle,
    unreadsStyle: messageStyle,
    timeFormat: z.enum(['auto', '12h', '24h']),
    composer: z.object({ returnToSend: z.boolean(), autoFocus: z.boolean() }),
    notifications: z.object({
      directMessage: z.boolean(),
      channelMention: z.boolean(),
      channelMessage: z.boolean(),
      repeaterAlert: z.boolean(),
      sensorAlert: z.boolean(),
      discoveredContact: z.boolean(),
      sound: z.boolean(),
      suppressWhenFocused: z.boolean(),
      dockBadge: z.boolean(),
      summarizeBacklog: z.boolean(),
    }),
    proxy: z.object({ enabled: z.boolean(), bindAll: z.boolean(), port: z.number().int(), mdns: z.boolean() }),
    toasts: z.object({ enabled: z.boolean(), durationSec: z.number() }),
    pinUnreadToTop: z.boolean(),
    autoReconnect: z.boolean(),
    hideUnsyncedChannels: z.boolean(),
    contactGrouping: z.enum(['nested', 'top-level']),
    leftNavCollapseLists: z.object({ enabled: z.boolean(), limit: z.number() }),
    showLeftNavSearch: z.boolean(),
    showLeftNavUnreads: z.boolean(),
    search: z.object({ defaultSort: searchSort }),
    commandPalette: z.object({ hintWeightPct: z.number() }),
    unreadsPreview: z.object({ enabled: z.boolean(), limit: z.number() }),
    logging: z.object({ fileEnabled: z.boolean(), level: z.enum(LOG_LEVELS) }),
    quickActions: z.array(z.enum(QUICK_ACTION_IDS)),
    updates: z.object({ channel: z.enum(['stable', 'development']), autoCheck: z.boolean() }),
    distanceUnit: z.enum(['metric', 'imperial']),
    // Clamped by main (telemetry/retention.ts), not here: an out-of-range
    // value is a hand edit to correct, not a malformed request.
    telemetry: z.object({ retentionPerNode: z.number() }),
  }),
);

export const radioSettingsSchema = exactly<RadioSettings>()(
  z.object({
    frequencyHz: z.number(),
    bandwidthHz: z.number(),
    spreadingFactor: z.number(),
    codingRate: z.number(),
    txPowerDbm: z.number(),
    repeatMode: z.boolean(),
    pathHashMode: pathHashSize,
  }),
);

export const mapSettingsSchema = exactly<MapSettings>()(
  z.object({
    hasProtomapsApiKey: z.boolean(),
    styleTheme: z.enum(['light', 'dark']),
    staleFadeDays: z.number(),
    lastHeardHours: z.number(),
    staleFadeEnabled: z.boolean(),
    kindFilters: z.object(kindFlags),
    favouritesOnly: z.boolean(),
    clusteringEnabled: z.boolean(),
    lightBasemap: z.boolean(),
    coLocationMeters: z.number(),
    showMarkerLabels: z.boolean(),
    tileCacheMaxBytes: z.number(),
    lastCenter: z.object({ lng: z.number(), lat: z.number() }).optional(),
    lastZoom: z.number().optional(),
    lastBearing: z.number().optional(),
    lastPitch: z.number().optional(),
  }),
);

/** UiState keys are checked for shape, not membership: a client restored from
 *  an older ui-state.json may still hold a tool key that no longer exists, and
 *  refusing it would fail every later save. The renderer falls back from an
 *  unknown tool key itself. */
const activeKeySchema = z.custom<ActiveKey>(
  (v) => typeof v === 'string' && isActiveKey(v),
  'expected a ch:, c: or tool: key',
);

const usageMap = z.record(z.string(), z.object({ count: z.number(), lastUsedMs: z.number() }));

export const uiStateSchema = exactly<UiState>()(
  z.object({
    activeKey: activeKeySchema,
    pinned: z.array(activeKeySchema),
    leftOpen: z.boolean(),
    rightOpen: z.boolean(),
    rightWidth: z.number(),
    openRailSections: z.record(z.string(), z.boolean()),
    leftNavOpen: z.object({ channels: z.boolean(), contacts: z.boolean(), ...kindFlags }),
    packetLogFilter: z.object({ source: z.enum(['both', 'rf', 'ble']) }),
    packetLog: z.object({ liveBufferSize: z.number(), storedHistorySize: z.number() }),
    channelActivityWindow: z.enum(['24h', '7d', '30d']),
    logsFilter: z.object({
      minLevel: z.enum(LOG_LEVELS),
      showMain: z.boolean(),
      showRenderer: z.boolean(),
      paused: z.boolean(),
    }),
    themePref: z.enum(['auto', 'dark', 'light']),
    selectedContactKey: z.string().nullable(),
    selectedSiteKey: z.string().nullable(),
    lastReadByKey: z.record(z.string(), z.number()),
    recentKeys: z.array(activeKeySchema),
    emojiUsage: usageMap,
    macroUsage: usageMap,
    peopleRail: z.record(
      z.string(),
      z.object({ sort: z.enum(['recent', 'loud', 'name']), filter: z.enum(['all', 'contacts']) }),
    ),
  }),
);

export const deviceIdentitySchema = exactly<DeviceIdentity>()(
  z.object({
    name: z.string(),
    publicKeyHex: z.string(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    sharePositionInAdvert: z.boolean(),
  }),
);

export const autoAddConfigSchema = exactly<AutoAddConfig>()(
  z.object({
    mode: z.enum(['all', 'selected']),
    ...kindFlags,
    overwriteOldest: z.boolean(),
    radioMaxHops: z.number().int().min(0),
    manualAddContacts: z.number().int().min(0).max(0xff),
    autoRefreshContacts: z.boolean(),
    showPublicKeys: z.boolean(),
  }),
);

export const telemetryPolicySchema = exactly<TelemetryPolicy>()(
  z.object({ base: telemetryMode, loc: telemetryMode, env: telemetryMode, multiAcks: z.number().int() }),
);

/** PUT /api/device/telemetry-policy: any non-empty subset of the policy, merged
 *  onto the radio's value (device/deviceSettings.applyTelemetryPolicy). A
 *  missing field would otherwise go to the radio as 0 — the library encodes it
 *  so — and be trusted as its policy. */
export const telemetryPolicyPatchSchema = z
  .object({
    base: telemetryMode.optional(),
    loc: telemetryMode.optional(),
    env: telemetryMode.optional(),
    multiAcks: z.number().int().min(0).max(0xff).optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'one of base, loc, env or multiAcks is required',
  });

export const telemetryPermsSchema = exactly<TelemetryPerms>()(
  z.object({ base: z.boolean(), loc: z.boolean(), env: z.boolean() }),
);

/** PUT /api/device/custom-vars: one sensor setting. The firmware frames the
 *  write as "key:value" and the read as "k:v,k:v", so neither separator may
 *  appear where it would split the frame. */
export const customVarBodySchema = z.object({
  key: z.string().regex(/^[^:,]+$/, "key must be non-empty without ':' or ','"),
  value: z.string().regex(/^[^,]*$/, "value must not contain ','"),
});

export const gpsConfigSchema = exactly<GpsConfig>()(z.object({ enabled: z.boolean(), intervalSec: z.number() }));

const channelKeySchema = z.templateLiteral(['ch:', z.string()]);
const contactKeySchema = z.templateLiteral(['c:', z.string()]);

export const channelSchema = exactly<Channel>()(
  z.object({
    key: channelKeySchema,
    name: z.string(),
    kind: z.enum(['public', 'hashtag', 'private']),
    secretHex: z.string().optional(),
    muted: z.boolean().optional(),
    pinned: z.boolean().optional(),
    idx: z.number().int().optional(),
    order: z.number().optional(),
    createdAt: z.number().optional(),
  }),
);

export const contactSchema = exactly<Contact>()(
  z.object({
    key: contactKeySchema,
    publicKeyHex: z.string(),
    name: z.string(),
    kind: contactKind,
    lastSeenMs: z.number().optional(),
    rssi: z.number().optional(),
    snr: z.number().optional(),
    hops: z.number().optional(),
    pinned: z.boolean().optional(),
    favourite: z.boolean().optional(),
    telemetryPerms: telemetryPermsSchema.optional(),
    muted: z.boolean().optional(),
    outPathHex: z.string().optional(),
    outPathHashSize: pathHashSize.optional(),
    preferDirect: z.boolean().optional(),
    pathManual: z.boolean().optional(),
    pathLearnedAt: z.number().optional(),
    gpsLat: z.number().optional(),
    gpsLon: z.number().optional(),
  }),
);

export const searchOptionsSchema = exactly<SearchOptions>()(
  z.object({
    query: z.string(),
    sort: searchSort,
    categories: z.array(z.enum(['channel', 'dm', 'contact'])).optional(),
    key: z.string().optional(),
    fromPk: z.string().optional(),
    tsFrom: z.number().optional(),
    tsTo: z.number().optional(),
    limit: z.number().int().min(0).optional(),
    offset: z.number().int().min(0).optional(),
  }),
);

// ---- Request bodies ---------------------------------------------------------

/** PUT /api/ui-state. `packetLog` may be absent (a client that predates it) or
 *  null (normalised to defaults); the route clamps whatever arrives. */
export const uiStateBodySchema = uiStateSchema.extend({
  packetLog: z.object({ liveBufferSize: z.number(), storedHistorySize: z.number() }).partial().nullable().optional(),
});

/** PUT /api/drafts. Empty text deletes the entry. */
export const draftBodySchema = z.object({ key: z.string(), text: z.string() });

/** PUT /api/settings/radio. `pushToDevice` defaults to true. */
export const radioSettingsBodySchema = radioSettingsSchema.extend({ pushToDevice: z.boolean().optional() });

/** PUT /api/settings/map. `hasProtomapsApiKey` is server-owned and ignored. */
export const mapSettingsBodySchema = mapSettingsSchema.extend({ hasProtomapsApiKey: z.boolean().optional() });

export const newBlockRuleSchema = exactly<Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'>>()(
  z.object({
    type: z.enum(['pubkey', 'pubkeyPrefix', 'name', 'nameRegex']),
    pattern: z.string().min(1),
    tsFrom: z.number(),
    enabled: z.boolean(),
    note: z.string().optional(),
  }),
);

/** POST /api/blocks: one rule per identifier the dialog ticked. */
export const addBlockRulesBodySchema = z.object({ rules: z.array(newBlockRuleSchema).min(1) });

/** PUT /api/blocks/:id: the editable fields only. */
export const blockRulePatchSchema = newBlockRuleSchema
  .pick({ pattern: true, tsFrom: true, enabled: true, note: true })
  .partial();

/** PUT /api/device/identity: any subset of the identity. */
export const deviceIdentityPatchSchema = deviceIdentitySchema.partial();

/** PUT /api/radio/path-hash-mode. */
export const pathHashModeBodySchema = z.object({ size: pathHashSize });

/** POST /api/map/api-key. */
export const apiKeyBodySchema = z.object({ key: z.string().trim().min(1) });

/** POST /api/channels/reorder: the full key list in display order. */
export const reorderChannelsBodySchema = z.object({ keys: z.array(z.string()) });

/** PUT /api/contacts/:key/favourite. */
export const favouriteBodySchema = z.object({ favourite: z.boolean() });

/** PUT /api/contacts/:key/path. Non-hex characters in `outPathHex` are dropped
 *  by the route, so separators like `a1:b2` are accepted. */
export const contactPathBodySchema = z.object({ outPathHex: z.string().optional(), preferDirect: z.boolean().optional() });

/** POST /api/messages/:key. */
export const sendMessageBodySchema = z.object({ body: z.string().min(1) });

/** POST /api/repeater/:key/login. */
export const repeaterLoginBodySchema = z.object({ password: z.string() });

/** POST /api/repeater/:key/neighbours. Every field is optional. */
export const repeaterNeighboursBodySchema = z.object({
  count: z.number().int().optional(),
  offset: z.number().int().optional(),
  orderBy: z.number().int().optional(),
  prefixLen: z.number().int().optional(),
});

/** POST /api/repeater/:key/cli. `expectReply` defaults to true. */
export const repeaterCliBodySchema = z.object({ command: z.string().min(1), expectReply: z.boolean().optional() });

/** POST /api/repeater/:key/trace. */
export const repeaterTraceBodySchema = z.object({
  tag: z.number().int(),
  authCode: z.number().int().optional(),
  flags: z.number().int().optional(),
  pathHex: z.string(),
});

/** POST /api/repeater/local/stats. `subtype` defaults to CORE. */
export const localStatsBodySchema = z.object({ subtype: z.enum(['CORE', 'RADIO', 'PACKETS']).optional() });

/** POST /api/transport/advert. `flood` defaults to true. */
export const advertBodySchema = z.object({ flood: z.boolean().optional() });

/** POST /api/transport/connect. */
export const connectBodySchema = z.object({ deviceId: z.string().min(1) });

/** POST /api/macros/validate. */
export const validateMacroBodySchema = z.object({ template: z.string() });

const macroScope = z.enum(['global', 'channel', 'contact']);

/** POST /api/macros. */
export const newMacroBodySchema = exactly<Omit<MacroTemplate, 'id' | 'createdAt' | 'updatedAt'>>()(
  z.object({
    name: z.string().min(1),
    template: z.string(),
    scope: macroScope,
    channelKey: z.string().optional(),
    contactKey: z.string().optional(),
  }),
);

/** PUT /api/macros/:id. */
export const macroPatchBodySchema = newMacroBodySchema.partial();

/** POST /api/macros/render: a stored macro by id, or an ad-hoc template. */
export const renderMacroBodySchema = z
  .object({
    macroId: z.string().optional(),
    template: z.string().optional(),
    mode: z.enum(['reply', 'send']).optional(),
    messageId: z.string().optional(),
    contactKey: z.string().optional(),
    channelKey: z.string().optional(),
    placeholder: z.string().optional(),
  })
  .refine((b) => b.macroId !== undefined || b.template !== undefined, { message: 'macroId or template required' });
