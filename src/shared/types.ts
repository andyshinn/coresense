import type { QuickActionId } from '../renderer/features/quick-actions/ids';
import type { DiscoveredContact } from './contacts/discovered';

export type TransportState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface BleDevice {
  id: string;
  name: string | null;
  rssi: number;
}

export interface RawPacket {
  timestamp: number;
  transportType: 'ble' | 'serial';
  kind: 'mesh' | 'companion';
  // Verbatim transport frame — what the bridge fans out to TCP/WS proxy clients.
  // Companion: includes the type code byte. Mesh: includes the 0x84/0x88 + SNR/RSSI prefix.
  hex: string;
  bytes: number[];
  // Parsed payload — what the renderer displays / feeds to MeshCoreDecoder.
  // Companion: payload after the type code. Mesh: the mesh packet only.
  payloadHex: string;
  payloadBytes: number[];
  // Mesh-only: link metrics extracted from companion-radio RAW_DATA / LOG_RX_DATA frames.
  snr?: number;
  rssi?: number;
  // Companion-only: the frame-type byte (e.g. 0x84) and human-readable name.
  code?: number;
  codeName?: string;
}

// Default TCP ports for the bridge listener. Dev and prod use different ports
// so a developer can run an installed build alongside `pnpm start` without
// fighting over the same port. The values are also the seed for
// DEFAULT_APP_SETTINGS.proxy.port — first-run only; user edits take over.
export const BRIDGE_DEFAULT_TCP_PORT = 7655;
export const BRIDGE_DEFAULT_TCP_PORT_DEV = 7755;

export interface BridgeStatus {
  tcpPort: number | null;
  bindAddress: string;
  lanAddress: string | null;
  tcpClients: number;
  mdnsServiceName: string | null;
  radioConnected: boolean;
}

/** Post-connect handshake progress. `phase` is the high-level state the UI
 *  surfaces alongside the transport-level dot in the connection footer; the
 *  per-bucket counters for channels and contacts are summed to drive the
 *  "Syncing N/M" label and progress bar. `idle` = not currently syncing (either pre-connect
 *  or post-completion); `syncing` = handshake in flight; `done` = handshake
 *  finished this session. */
export interface SyncProgress {
  phase: 'idle' | 'syncing' | 'done';
  channels: { done: number; total: number };
  contacts: { done: number; total: number };
}

export const DEFAULT_SYNC_PROGRESS: SyncProgress = {
  phase: 'idle',
  channels: { done: 0, total: 0 },
  contacts: { done: 0, total: 0 },
};

export type ChannelKind = 'public' | 'hashtag' | 'private';

export interface Channel {
  key: string; // 'ch:<name>'
  name: string;
  kind: ChannelKind;
  secretHex?: string;
  muted?: boolean;
  pinned?: boolean;
  /** Slot index on the radio (0..N). Set after the protocol session learns it
   *  via RESP_CHANNEL_INFO. Required for outbound CMD_SEND_CHAN_TXT_MSG and
   *  used to dispatch incoming RESP_CHANNEL_MSG_RECV(_V3) frames to the right
   *  channel. */
  idx?: number;
  /** User-defined sort order in the LeftNav. Seeded from `idx` on first sync;
   *  thereafter set explicitly by drag-reorder. Lower = higher in the list. */
  order?: number;
}

export type ContactKind = 'chat' | 'repeater' | 'sensor' | 'room';

export type PathHashSize = 1 | 2 | 3;

export interface Contact {
  key: string; // 'c:<publicKeyHex>'
  publicKeyHex: string;
  name: string;
  kind: ContactKind;
  lastSeenMs?: number;
  rssi?: number;
  snr?: number;
  hops?: number;
  pinned?: boolean;
  /** Radio-level favourite — maps to the firmware contact flag bit 0, which
   *  protects the contact from overwrite-oldest eviction. Distinct from
   *  `pinned` (app-only pin-to-top in the nav). */
  favourite?: boolean;
  muted?: boolean;
  /** Hex-encoded out-path bytes (no separators) mirroring the firmware's
   *  advert.out_path. Empty / undefined means "flood" (no source-route). The
   *  byte length must be a multiple of `outPathHashSize`. */
  outPathHex?: string;
  /** Bytes per hop prefix (1, 2 or 4). Snapshot of the radio's `path.hash.mode`
   *  at the time the path was captured / written. Needed to split `outPathHex`
   *  into the per-hop chips the UI renders. */
  outPathHashSize?: PathHashSize;
  /** When true, the app skips mesh routing entirely and uses the companion-side
   *  direct flow for this contact (CMD_SEND_LOGIN for repeaters; direct DM
   *  otherwise). Takes precedence over `outPathHex`. */
  preferDirect?: boolean;
  /** True iff the current `outPathHex` was set by hand in the UI (not learned
   *  by the auto-retry pipeline). Drives the "overwrite manual path?" dialog. */
  pathManual?: boolean;
  /** Wall-clock ms of the most recent auto-learn that wrote `outPathHex`. */
  pathLearnedAt?: number;
  /** Last advertised position in WGS84 degrees. Both present together or both
   *  absent — a partial fix is never written. 0/0 from firmware is treated as
   *  absent (default for radios without a GPS module). */
  gpsLat?: number;
  gpsLon?: number;
}

/** True iff the contact carries a usable WGS84 fix: both coords present, not
 *  the 0/0 "no GPS" sentinel, and within valid lat/lon ranges. Corrupt adverts
 *  can yield out-of-range coords — treat those as no fix rather than letting
 *  them reach MapLibre, which throws on an invalid LngLat. */
export function hasValidFix(c: Contact): c is Contact & { gpsLat: number; gpsLon: number } {
  return (
    typeof c.gpsLat === 'number' &&
    typeof c.gpsLon === 'number' &&
    (c.gpsLat !== 0 || c.gpsLon !== 0) &&
    c.gpsLat >= -90 &&
    c.gpsLat <= 90 &&
    c.gpsLon >= -180 &&
    c.gpsLon <= 180
  );
}

export type MessageState = 'sending' | 'sent' | 'heard' | 'ack' | 'failed' | 'received';

/** One node in a routing path. `kind` distinguishes the message originator
 *  (sender, derived from the "name: " prefix in channel messages), intermediate
 *  repeaters, and the sink (our radio). `shortId` is the per-hop prefix hex
 *  (1, 2, or 3 bytes wide) as encoded by the firmware in the on-air path.
 *  `unnamed: true` means we only know the prefix byte(s) — no advert ever seen
 *  for that prefix, so the UI renders a dashed avatar + italic placeholder. */
export interface MessageHop {
  kind: 'origin' | 'hop' | 'sink';
  shortId: string;
  name?: string | null;
  pk?: string | null;
  unnamed?: boolean;
}

/** One observed reception of a flood message: the sequence of hops it took
 *  from origin to our radio. A single Message can carry multiple paths when
 *  the same packet arrived via multiple flood routes (merged on receipt by
 *  deterministic id). `hashMode` is the firmware-encoded per-hop hash byte
 *  count (1, 2, or 3 — 4 is reserved). `finalSnr` is the SNR our radio
 *  measured on the LAST hop only; per-hop SNR is never available on flood. */
export interface MessagePath {
  id: string;
  hops: MessageHop[];
  hashMode: number;
  finalSnr: number;
}

export interface MessageMeta {
  hops?: number;
  rssi?: number;
  snr?: number;
  /** Decoded route(s) the message travelled, populated when a matching mesh
   *  observation (PUSH_CODE_LOG_RX_DATA 0x88) preceded the channel-msg push. */
  paths?: MessagePath[];
  /** Number of distinct flood receptions merged into this Message row. Absent
   *  ⇒ treat as 1. Bumped by holder.upsertMessage on collision. */
  timesHeard?: number;
  signatureHex?: string;
  /** Set by main when the message matches an active block rule. The
   *  renderer hides annotated rows from MessageList, Unreads, and Search.
   *  Re-evaluated per query — disabling or deleting the rule clears the
   *  annotation on the next read (not sticky). */
  blocked?: boolean;
  /** The id of the first rule (by createdAt asc) that matched this message
   *  at first-match time. Used to attribute matchCount; not used for hiding. */
  blockedByRuleId?: string;
}

export interface Message {
  id: string;
  key: string; // channel or contact key the message belongs to
  fromPublicKeyHex?: string; // omitted when sent by the owner
  body: string;
  ts: number;
  state: MessageState;
  meta?: MessageMeta;
}

export type BlockRuleType = 'pubkey' | 'pubkeyPrefix' | 'name' | 'nameRegex';

export interface BlockRule {
  id: string;
  type: BlockRuleType;
  /** Storage form depends on type:
   *   pubkey / pubkeyPrefix — lowercase hex, no separators
   *   name                  — case-sensitive exact match
   *   nameRegex             — JS regex source string. Matcher applies the 'i' flag. */
  pattern: string;
  createdAt: number;
  /** Matches messages where msg.ts >= tsFrom. Encodes the retro-hide window. */
  tsFrom: number;
  enabled: boolean;
  note?: string;
  /** Bumped once per message on first match (new arrival or rule-creation backfill).
   *  Persisted on a debounce — see main/blocking/store.ts. */
  matchCount: number;
}

export interface Owner {
  name: string;
  publicKeyHex: string;
  publicKeyShort: string;
}

export type SearchSort = 'relevance' | 'recency';

export type SearchCategory = 'channel' | 'dm' | 'contact';

export interface SearchOptions {
  query: string;
  sort: SearchSort;
  /** Result categories to include. Omitted/empty → all three. 'channel' and
   *  'dm' gate message rows by m.kind; 'channel' also shows the Channels
   *  conversation section; 'contact' shows the Contacts conversation section. */
  categories?: SearchCategory[];
  /** Restrict to a single conversation key. */
  key?: string;
  /** Hex public key of sender. Self-sent messages have from_pk = NULL, so
   *  use the literal 'self' to filter for those. */
  fromPk?: string;
  tsFrom?: number;
  tsTo?: number;
  /** Default 100. Capped server-side to keep payloads bounded. */
  limit?: number;
  /** Pagination — fetched in lockstep with `limit`. Server clamps to a
   *  reasonable max to keep absurd offsets from scanning the world. */
  offset?: number;
}

export interface MessageHit {
  /** App-level message id (the `mid` column, matches Message.id). */
  id: string;
  key: string;
  ts: number;
  fromPublicKeyHex: string | null;
  body: string;
  /** Snippet with `<mark>…</mark>` around matched terms. Already
   *  HTML-escaped server-side except for the mark tags themselves. */
  snippet: string;
  score: number;
  /** Set by main when the hit matches an active block rule. The renderer
   *  filters annotated hits out of the rendered list. pubkey / pubkeyPrefix
   *  rules can't match channel-message hits in search because path data
   *  isn't persisted — only name / nameRegex apply for those. */
  blocked?: boolean;
}

export interface ConversationHit {
  key: string;
  kind: 'channel' | 'contact';
  name: string;
  /** For contacts: hex public key. For channels: undefined. */
  publicKeyHex?: string;
  /** Contact sub-kind; present only when kind === 'contact'. Drives the
   *  search row's icon + badge and (future) a kind filter. */
  contactKind?: ContactKind;
  score: number;
  /** Count of messages in this conversation matching the same query. */
  messageMatches: number;
}

export interface SearchResults {
  conversations: ConversationHit[];
  /** The current page of message hits. */
  messages: MessageHit[];
  /** `messages` is the FULL match count across all pages — drives Load more.
   *  `conversations` is the visible count (we don't paginate that section). */
  total: { conversations: number; messages: number };
}

export type LogLevel = 'silly' | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  id: string; // monotonically increasing, used as virtuoso key
  ts: number; // epoch ms
  level: LogLevel;
  levelId: number; // tslog numeric level (0..6)
  source: 'main' | 'renderer';
  logger: string; // tslog name / sub-logger name (e.g. 'coresense.ble')
  message: string; // pre-rendered single string
  args?: unknown[]; // structured extras (JSON-serializable), optional
}

export type ThemePrefValue = 'auto' | 'dark' | 'light';

export type MessageStyle = 'compact' | 'rich';

/** Clock format for rendered timestamps. 'auto' follows the OS locale; the
 *  explicit values force a 12- or 24-hour clock regardless of locale. */
export type TimeFormatPref = 'auto' | '12h' | '24h';

export interface AppSettings {
  theme: ThemePrefValue;
  /** Density for the channel/DM conversation message list. */
  messageStyle: MessageStyle;
  /** Density for the Unreads triage previews — separate from `messageStyle` so
   *  a busy triage list can stay denser than live conversations. */
  unreadsStyle: MessageStyle;
  /** 12/24-hour clock for all rendered timestamps. */
  timeFormat: TimeFormatPref;
  composer: {
    returnToSend: boolean;
    /** Focus the message field automatically when navigating to a channel or
     *  DM, so you can start typing right away. */
    autoFocus: boolean;
  };
  notifications: {
    directMessage: boolean;
    channelMention: boolean;
    channelMessage: boolean;
    repeaterAlert: boolean;
    sensorAlert: boolean;
    /** Fire a native notification the first time a contact is heard. */
    discoveredContact: boolean;
    sound: boolean;
    suppressWhenFocused: boolean;
    dockBadge: boolean;
  };
  proxy: {
    enabled: boolean;
    bindAll: boolean; // false = 127.0.0.1, true = 0.0.0.0
    port: number;
    mdns: boolean;
  };
  toasts: {
    enabled: boolean;
    /** Display duration in seconds. */
    durationSec: number;
  };
  pinUnreadToTop: boolean;
  autoReconnect: boolean;
  /** When true, channels stored in the app but not present on the currently
   *  connected radio are hidden from the LeftNav — matches the official app's
   *  device-is-truth view. When false (default), they appear grayed-out with
   *  history accessible. */
  hideUnsyncedChannels: boolean;
  /** How contacts are grouped by kind in the left nav.
   *  'nested': one Contacts section with four sub-collapsibles per kind.
   *  'top-level': four sibling sections (Users / Repeaters / Room Servers / Sensors). */
  contactGrouping: ContactGrouping;
  /** Cap the number of rows shown under each LeftNav branch (channels, each
   *  contact kind), with a "Show N more" button that reveals the rest for the
   *  current session. Reduces scroll fatigue when a node has hundreds of
   *  contacts. Reveal state is ephemeral — collapsing back to the limit on
   *  next launch is intentional. */
  leftNavCollapseLists: {
    enabled: boolean;
    /** Number of items shown before the "Show more" affordance. Minimum 1. */
    limit: number;
  };
  /** Show the quick-filter input above the Conversations section in the LeftNav.
   *  Cmd/Ctrl+F focuses it. Independent of the command palette. */
  showLeftNavSearch: boolean;
  /** Show the Unreads shortcut at the top of the Conversations section in the
   *  LeftNav. When off, the pane is still reachable from the command palette.
   *  Rendered independently of the unread count so the list never shifts. */
  showLeftNavUnreads: boolean;
  /** Persistent search defaults. The Search Results panel still toggles
   *  sort in-session, but writes back to AppSettings so the preference
   *  sticks across launches. */
  search: {
    defaultSort: SearchSort;
  };
  /** Command palette match ranking. */
  commandPalette: {
    /** How strongly a query match in an item's description/keywords counts
     *  relative to a match in its name, as a percentage. 100 = description
     *  text ranks equal to the name; 0 = description text is ignored and only
     *  names are searched. */
    hintWeightPct: number;
  };
  /** Unreads panel preview cap. Each conversation card renders only its most
   *  recent unread messages; the rest collapse behind a "+ N earlier" line.
   *  Disable the cap to render every unread message in full. */
  unreadsPreview: {
    enabled: boolean;
    /** Messages shown per conversation card before collapsing. Minimum 1. */
    limit: number;
  };
  logging: {
    fileEnabled: boolean;
    level: LogLevel;
  };
  /** Ordered owner-card quick-action ids (max 4; first renders as the primary
   *  button). Validated against the catalog on read, so unknown/removed ids are
   *  dropped. */
  quickActions: QuickActionId[];
}

export type ContactGrouping = 'nested' | 'top-level';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'auto',
  messageStyle: 'rich',
  unreadsStyle: 'compact',
  timeFormat: 'auto',
  composer: { returnToSend: true, autoFocus: true },
  notifications: {
    directMessage: true,
    channelMention: true,
    channelMessage: false,
    repeaterAlert: true,
    sensorAlert: false,
    discoveredContact: true,
    sound: true,
    suppressWhenFocused: true,
    dockBadge: true,
  },
  proxy: {
    enabled: true,
    bindAll: false,
    port: BRIDGE_DEFAULT_TCP_PORT,
    mdns: true,
  },
  toasts: { enabled: true, durationSec: 4 },
  pinUnreadToTop: false,
  autoReconnect: false,
  hideUnsyncedChannels: false,
  contactGrouping: 'nested',
  leftNavCollapseLists: { enabled: true, limit: 10 },
  showLeftNavSearch: true,
  showLeftNavUnreads: true,
  search: { defaultSort: 'recency' },
  commandPalette: { hintWeightPct: 50 },
  unreadsPreview: { enabled: true, limit: 25 },
  logging: { fileEnabled: false, level: 'info' },
  quickActions: ['flood', 'gps', 'shareLoc', 'disconnect'],
};

/** Bundled vector basemap + raster terrain sources for the Map panel.
 *  The renderer fetches tiles via the local Hono server (`/api/tiles/:source`)
 *  using HTTP Range requests; the manifest summarizes each extract's header. */
export type TileSource = 'basemap' | 'terrain';

export interface TileManifestEntry {
  source: TileSource;
  bytes: number;
  minZoom: number;
  maxZoom: number;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  center: { lng: number; lat: number; zoom: number };
  /** PMTiles tileType enum (0=Unknown, 1=Mvt, 2=Png, 3=Jpeg, 4=Webp, 5=Avif). */
  tileType: number;
}

export interface TileManifest {
  /** True when neither basemap nor terrain is available on disk — the Map
   *  panel renders an empty-state with instructions instead of mounting MapLibre. */
  missing: boolean;
  basemap: TileManifestEntry | null;
  terrain: TileManifestEntry | null;
}

export interface MapSettings {
  /** Hillshade overlay rendered from the terrain source. */
  terrainHillshadeEnabled: boolean;
  /** 3D terrain via map.setTerrain(...). Independent of hillshade — hillshade
   *  is a 2D paint layer; 3D is exaggeration applied during render. */
  terrain3DEnabled: boolean;
  /** Derived from the existence of the encrypted blob on disk; never written
   *  by the renderer. When true, the renderer extends the map past the bundled
   *  extract's maxZoom by proxying tiles from the Protomaps hosted API through
   *  main (the API key never leaves main). */
  hasProtomapsApiKey: boolean;
  /** Which @protomaps/basemaps flavor to compose. Follows the app theme by default. */
  styleTheme: 'light' | 'dark';
  /** Deprecated — superseded by `lastHeardHours` + `staleFadeEnabled`. Kept on
   *  the type so older persisted settings deserialise without losing keys. */
  staleFadeDays: number;
  /** Markers from contacts not heard in the last N hours are either faded
   *  (`staleFadeEnabled = true`) or hidden (`= false`). UI slider runs 1..720
   *  (= 1h..30d). */
  lastHeardHours: number;
  /** When true, contacts older than `lastHeardHours` render faded; when false,
   *  they're hidden entirely. */
  staleFadeEnabled: boolean;
  /** Per-kind filter — when `false`, that kind's markers are hidden from the map. */
  kindFilters: { chat: boolean; repeater: boolean; room: boolean; sensor: boolean };
  /** Only show contacts with `pinned = true`. */
  favouritesOnly: boolean;
  /** Combine nearby markers into a type-breakdown donut when zoomed out. */
  clusteringEnabled: boolean;
  /** Force the light basemap flavor even when the app theme is dark. */
  lightBasemap: boolean;
  /** Contacts within this many meters collapse into a single horizontal chip-row
   *  marker ("co-located site"). */
  coLocationMeters: number;
  /** Show the contact's name as a small label next to each marker. */
  showMarkerLabels: boolean;
  /** Persisted viewport so the Map panel re-opens where the user left off. */
  lastCenter?: { lng: number; lat: number };
  lastZoom?: number;
  lastBearing?: number;
  lastPitch?: number;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  terrainHillshadeEnabled: true,
  terrain3DEnabled: false,
  hasProtomapsApiKey: false,
  styleTheme: 'light',
  staleFadeDays: 7,
  lastHeardHours: 24,
  staleFadeEnabled: true,
  kindFilters: { chat: true, repeater: true, room: true, sensor: true },
  favouritesOnly: false,
  clusteringEnabled: true,
  lightBasemap: false,
  coLocationMeters: 150,
  showMarkerLabels: false,
};

export interface RadioSettings {
  frequencyHz: number;
  bandwidthHz: number;
  spreadingFactor: number;
  codingRate: number;
  txPowerDbm: number;
  repeatMode: boolean;
  /** Firmware `path.hash.mode` — bytes per hop prefix used when source-routing.
   *  All contacts whose path is captured / learned while this radio is connected
   *  inherit this as their `outPathHashSize` default. */
  pathHashMode: PathHashSize;
}

// US-915 defaults from project/data/meshcore-config.json (the egrmesh Hand export).
export const DEFAULT_RADIO_SETTINGS: RadioSettings = {
  frequencyHz: 910_525_000,
  bandwidthHz: 62_500,
  spreadingFactor: 7,
  codingRate: 5,
  txPowerDbm: 20,
  repeatMode: false,
  pathHashMode: 2,
};

// ---- Device-side settings (cached locally, device is source of truth) ----

/** "Public info" the radio advertises about itself. Synced from RESP_SELF_INFO
 *  and mutated via CMD_SET_ADVERT_NAME / CMD_SET_ADVERT_LATLON /
 *  CMD_SET_OTHER_PARAMS.advertLocationPolicy. */
export interface DeviceIdentity {
  name: string;
  publicKeyHex: string;
  lat: number | null;
  lon: number | null;
  sharePositionInAdvert: boolean;
}
export const DEFAULT_DEVICE_IDENTITY: DeviceIdentity = {
  name: '',
  publicKeyHex: '',
  lat: null,
  lon: null,
  sharePositionInAdvert: true,
};

/** Auto-add behaviour (CMD_SET_AUTO_ADD_CONFIG / GET_AUTO_ADD_CONFIG). `mode`
 *  is an app-side convenience: "all" forces all four kind flags true on save;
 *  "selected" respects the per-kind booleans. The radio flag byte only carries
 *  the kinds + overwrite_oldest. */
export type AutoAddMode = 'all' | 'selected';
export interface AutoAddConfig {
  mode: AutoAddMode;
  chat: boolean;
  repeater: boolean;
  room: boolean;
  sensor: boolean;
  overwriteOldest: boolean;
  /** App-side filter: drop adverts whose path has more hops than this. `null`
   *  = no limit. The radio doesn't apply this; the companion does pre-upsert. */
  maxHops: number | null;
  /** App-side: pull-to-refresh in the contact list. */
  pullToRefresh: boolean;
  /** App-side: show pubkey prefix next to names in lists. */
  showPublicKeys: boolean;
}
export const DEFAULT_AUTO_ADD_CONFIG: AutoAddConfig = {
  mode: 'all',
  chat: true,
  repeater: true,
  room: true,
  sensor: true,
  overwriteOldest: true,
  maxHops: null,
  pullToRefresh: true,
  showPublicKeys: true,
};

/** Telemetry/messaging knobs from CMD_SET_OTHER_PARAMS. Each telemetry mode is
 *  0=deny, 1=allow-per-contact-flag, 2=allow-all. `multiAcks` is 0..2 typical;
 *  more ACKs increase reliability at the cost of airtime. */
export interface TelemetryPolicy {
  base: 0 | 1 | 2;
  loc: 0 | 1 | 2;
  env: 0 | 1 | 2;
  multiAcks: number;
}
export const DEFAULT_TELEMETRY_POLICY: TelemetryPolicy = {
  base: 1,
  loc: 1,
  env: 1,
  multiAcks: 1,
};

/** GPS module config exchanged via CMD_SET_CUSTOM_VAR("gps:1"/"gps_interval:N"). */
export interface GpsConfig {
  enabled: boolean;
  intervalSec: number;
}
export const DEFAULT_GPS_CONFIG: GpsConfig = {
  enabled: false,
  intervalSec: 300,
};

/** Aggregate read-only device info. firmwareVerCode 0 means "unknown/no
 *  device connected" — the renderer uses that to gate firmware-version
 *  features (identity key export needs ≥ 1.7.0, repeat mode needs ≥9, etc.). */
export interface DeviceInfo {
  firmwareVerCode: number;
  deviceModel: string;
  maxContacts: number;
  maxChannels: number;
  channelsUsed: number;
  contactsUsed: number;
  storageUsedKb: number;
  storageTotalKb: number;
  batteryMv: number;
}
export const DEFAULT_DEVICE_INFO: DeviceInfo = {
  firmwareVerCode: 0,
  deviceModel: '',
  maxContacts: 0,
  maxChannels: 0,
  channelsUsed: 0,
  contactsUsed: 0,
  storageUsedKb: 0,
  storageTotalKb: 0,
  batteryMv: 0,
};

/** Per-tab "the device firmware doesn't expose this over BLE" capability flags.
 *  Surfaced in the Settings tabs to disable rows the official open-source
 *  protocol doesn't define. */
export interface DeviceCapabilities {
  /** Firmware version ≥ 1.7.0 — required for CLI-based private key export. */
  identityKeyIO: boolean;
  /** Firmware ver_code ≥ 9 — repeat mode and client_repeat byte. */
  repeatMode: boolean;
}
export const DEFAULT_DEVICE_CAPABILITIES: DeviceCapabilities = {
  identityKeyIO: false,
  repeatMode: false,
};

// LeftNav branch open/closed state. Keys cover the three Collapsible
// containers in LeftNav (Channels parent, Contacts wrapper in nested mode,
// and each ContactKind group).
export type LeftNavGroupId = 'channels' | 'contacts' | 'chat' | 'repeater' | 'room' | 'sensor';

export type ThemePref = 'auto' | 'dark' | 'light';

export interface UiState {
  activeKey: string;
  pinned: string[]; // keys in pin order (channel + contact keys)
  leftOpen: boolean;
  rightOpen: boolean;
  rightWidth: number;
  // section id (e.g. 'channel.members') → collapsed/expanded
  openRailSections: Record<string, boolean>;
  // LeftNav Collapsible open/closed flags (Channels parent, Contacts wrapper,
  // and the four ContactKind groups).
  leftNavOpen: Record<LeftNavGroupId, boolean>;
  // Per-conversation composer drafts. Keyed by channel/contact key. Entries
  // are deleted when the message is sent or the textarea is cleared.
  drafts: Record<string, string>;
  // Packet log view options.
  packetLogFilter: { showCompanion: boolean };
  // Logs panel filter options.
  logsFilter: {
    minLevel: LogLevel;
    showMain: boolean;
    showRenderer: boolean;
    loggerSubstring: string;
    textSubstring: string;
    paused: boolean;
  };
  // Theme preference. Migrated from localStorage on first launch after this
  // field was added; see App.tsx hydration path.
  themePref: ThemePref;
  // Contact key (`c:<pkhex>`) to surface in the right rail regardless of
  // activeKey. Set when the user clicks an @mention pill; cleared on
  // activeKey change. Takes precedence over the active conversation's
  // contact card when populated.
  selectedContactKey: string | null;
  // Stable key for a co-located site (group of contacts within
  // `MapSettings.coLocationMeters`) — set when the user clicks the chip-row
  // marker on the Map view. Mutually exclusive with `selectedContactKey`.
  selectedSiteKey: string | null;
  // Per-conversation last-read marker (ms). A message with ts > marker is
  // unread. Drives the "scroll to first unread" behavior in MessageList and
  // the unread divider.
  lastReadByKey: Record<string, number>;
  // Most-recently-visited keys, newest first. Drives the Cmd+K "Recent"
  // section. Capped at RECENT_KEYS_MAX entries; persisted across sessions
  // so a relaunch resumes the same jump list.
  recentKeys: string[];
}

export const DEFAULT_UI_STATE: UiState = {
  activeKey: 'tool:packetlog',
  pinned: [],
  leftOpen: true,
  rightOpen: false,
  rightWidth: 320,
  openRailSections: {},
  leftNavOpen: {
    channels: true,
    contacts: true,
    chat: true,
    repeater: true,
    room: true,
    sensor: true,
  },
  drafts: {},
  packetLogFilter: { showCompanion: false },
  logsFilter: {
    minLevel: 'silly',
    showMain: true,
    showRenderer: true,
    loggerSubstring: '',
    textSubstring: '',
    paused: false,
  },
  themePref: 'auto',
  selectedContactKey: null,
  selectedSiteKey: null,
  lastReadByKey: {},
  recentKeys: [],
};

export interface StateSnapshot {
  capabilities: Capabilities;
  bridge: BridgeStatus;
  transport: { state: TransportState; deviceId?: string };
  owner: Owner | null;
  channels: Channel[];
  /** Channel keys the currently-connected radio reports owning. Empty when
   *  disconnected. Renderer grays out channels not in this set. */
  channelPresence: string[];
  syncProgress: SyncProgress;
  contacts: Contact[];
  discoveredContacts: DiscoveredContact[];
  messages: Message[];
  appSettings: AppSettings;
  radioSettings: RadioSettings;
  mapSettings: MapSettings;
  /** Snapshot of which bundled PMTiles extracts exist on disk + their headers.
   *  Renderer uses this to gate the Map panel's empty-state and pick an
   *  initial view if no last-position is persisted. */
  mapManifest: TileManifest;
  uiState: UiState;
  deviceIdentity: DeviceIdentity;
  autoAddConfig: AutoAddConfig;
  telemetryPolicy: TelemetryPolicy;
  gpsConfig: GpsConfig;
  deviceInfo: DeviceInfo;
  deviceCapabilities: DeviceCapabilities;
  blockRules: BlockRule[];
}

export type MenuAction =
  | { kind: 'openSettings' }
  | { kind: 'openPalette' }
  | { kind: 'toggleRightRail' }
  | { kind: 'toggleLeftNav' }
  | { kind: 'openPacketLog' }
  | { kind: 'reconnect' }
  | { kind: 'toggleRepeat' }
  | { kind: 'cyclePinned'; direction: 'prev' | 'next' }
  | { kind: 'sendAdvert' }
  | { kind: 'focusKey'; key: string }
  | { kind: 'newChannel' }
  | { kind: 'addContact' }
  | { kind: 'pinToggle' }
  | { kind: 'disconnect' }
  | { kind: 'cycleTheme' }
  // Broadcast by the main process when a window-close / app-quit is attempted.
  // The renderer decides whether unsaved Settings changes need a prompt.
  | { kind: 'requestQuit' }
  // Browser-style back/forward navigation. Sourced from menu accelerators
  // (Cmd+Left/Right on macOS, Alt+Left/Right elsewhere), the macOS BrowserWindow
  // 'swipe' event (3-finger trackpad), and the 'app-command' event (mouse
  // back/forward buttons on Win/Linux). macOS mouse XButton1/XButton2 are
  // handled renderer-side via mousedown button 3/4.
  | { kind: 'navigate'; direction: 'back' | 'forward' };

export interface ThemePush {
  systemDark: boolean;
}

/** Decoded admin-response surfaced to the UI. `payloadHex` is always populated
 *  so views can show raw bytes when decoding can't make sense of them; `fields`
 *  is the best-effort decode (status: well-known firmware layout; telemetry:
 *  CayenneLPP). */
export interface RepeaterStatusSnapshot {
  contactKey: string;
  receivedAt: number;
  payloadHex: string;
  fields: Array<{ name: string; value: number | string; unit?: string }>;
}

// Decoded admin-session state for a repeater contact. Lives in main-process
// memory only — admin auth is bound to the live radio connection, so reloads
// require a fresh login.
export type RepeaterAdminMode = 'local' | 'remote';
export type RepeaterAdminRole = 'admin' | 'guest';

export interface RepeaterAdminSession {
  contactKey: string;
  publicKeyHex: string;
  mode: RepeaterAdminMode;
  role: RepeaterAdminRole;
  permissionsBits: number;
  aclPermissionsBits: number | null;
  firmwareVerLevel: number | null;
  loggedInAt: number;
}

export interface RepeaterLoginResult {
  permissions: number;
  pubKeyPrefixHex: string;
  serverTagHex: string | null;
  aclPermissions: number | null;
  firmwareVerLevel: number | null;
  isAdmin: boolean;
}

export interface RepeaterAclEntry {
  pubKeyPrefixHex: string;
  permissions: number;
  isAdmin: boolean;
  isGuest: boolean;
}

export interface RepeaterNeighbour {
  pubKeyPrefixHex: string;
  heardSecsAgo: number;
  snrDb: number;
}

export interface RepeaterNeighboursPage {
  total: number;
  neighbours: RepeaterNeighbour[];
}

export interface RepeaterOwnerInfo {
  firmwareVersion: string;
  nodeName: string;
  ownerInfo: string;
}

export interface RepeaterTraceHop {
  hashHex: string;
  snrDb: number;
}

export interface RepeaterTrace {
  pubKeyPrefixHex: string;
  tagHex: string;
  authHex: string;
  flags: number;
  pathHashSize: number;
  hops: RepeaterTraceHop[];
  finalSnrDb: number;
}

export type RepeaterLocalStats =
  | {
      kind: 'core';
      battMv: number;
      uptimeSecs: number;
      errFlags: number;
      queueLen: number;
    }
  | {
      kind: 'radio';
      noiseFloor: number;
      lastRssi: number;
      lastSnrDb: number;
      txAirSecs: number;
      rxAirSecs: number;
    }
  | {
      kind: 'packets';
      recv: number;
      sent: number;
      nSentFlood: number;
      nSentDirect: number;
      nRecvFlood: number;
      nRecvDirect: number;
      nRecvErrors: number;
    };

export interface RepeaterTelemetrySnapshot {
  contactKey: string;
  receivedAt: number;
  payloadHex: string;
  fields: Array<{
    channel: number;
    typeHex: string;
    name: string;
    value: number | string;
    unit?: string;
  }>;
}

export type WsMessage =
  | { type: 'packet'; payload: RawPacket }
  | { type: 'transportState'; payload: { state: TransportState; deviceId?: string } }
  | { type: 'scanResults'; payload: BleDevice[] }
  | { type: 'error'; payload: { message: string } }
  | { type: 'bridgeStatus'; payload: BridgeStatus }
  | { type: 'menuAction'; payload: MenuAction }
  | { type: 'theme'; payload: ThemePush }
  // Data-slice push events — main process publishes these whenever the
  // authoritative store (storage layer + protocol decode) changes. Renderer
  // is a cache.
  | { type: 'channels'; payload: Channel[] }
  | { type: 'channelPresence'; payload: { keys: string[] } }
  | { type: 'syncProgress'; payload: SyncProgress }
  | { type: 'contacts'; payload: Contact[] }
  | { type: 'discovered'; payload: DiscoveredContact[] }
  | { type: 'contactEvicted'; payload: { name: string } }
  | { type: 'messages'; payload: { key: string; messages: Message[] } }
  | { type: 'messageState'; payload: { id: string; state: MessageState } }
  | { type: 'messagePathHeard'; payload: { id: string; path: MessagePath; state: MessageState } }
  | { type: 'owner'; payload: Owner | null }
  | { type: 'appSettings'; payload: AppSettings }
  | { type: 'radioSettings'; payload: RadioSettings }
  | { type: 'mapSettings'; payload: MapSettings }
  | { type: 'mapManifest'; payload: TileManifest }
  | { type: 'repeaterStatus'; payload: RepeaterStatusSnapshot }
  | { type: 'repeaterTelemetry'; payload: RepeaterTelemetrySnapshot }
  | { type: 'pathLearned'; payload: PathLearnedEvent }
  | { type: 'deviceIdentity'; payload: DeviceIdentity }
  | { type: 'autoAddConfig'; payload: AutoAddConfig }
  | { type: 'telemetryPolicy'; payload: TelemetryPolicy }
  | { type: 'gpsConfig'; payload: GpsConfig }
  | { type: 'deviceInfo'; payload: DeviceInfo }
  | { type: 'deviceCapabilities'; payload: DeviceCapabilities }
  | { type: 'uiState'; payload: UiState }
  | { type: 'wsClients'; payload: { count: number } }
  | { type: 'blockRules'; payload: BlockRule[] }
  | { type: 'log'; payload: LogEntry }
  | { type: 'log:snapshot'; payload: LogEntry[] };

export interface PathLearnedEvent {
  contactKey: string;
  /** New out-path bytes the radio observed when the send succeeded. May be
   *  empty (e.g. a path-known send fell back to flood and the radio still
   *  hasn't a path it trusts). */
  newOutPathHex: string;
  newOutPathHashSize: PathHashSize;
  /** Path that was on the contact immediately before the learn. */
  previousOutPathHex: string;
  /** True iff the previous path was set manually — the renderer uses this to
   *  decide whether to prompt or apply silently. */
  previousManual: boolean;
  /** Wall-clock ms of the learn event. */
  learnedAt: number;
}

export interface Capabilities {
  isElectron: boolean;
  version: string;
  /** Abbreviated git SHA (7 chars) of the build, or `"unknown"` when the
   *  build wasn't from a git checkout (e.g. tarball). Injected by
   *  unplugin-info at main-process build time. */
  gitSha: string;
  /** `process.versions.electron` of the running main process. */
  electronVersion: string;
  /** `process.versions.chrome` (Chromium version) of the running window. */
  chromeVersion: string;
  platform: string;
  httpPort: number;
  /** Absolute path of the config.json that holds the shared API key. Surfaced
   *  so browser clients can be told exactly where to read the key, and the
   *  in-app API Access settings section can show it. */
  configPath: string;
  /** Absolute path to the userData/logs folder. */
  logsFolder: string;
  /** Absolute path to today's log file. */
  logsCurrentFile: string;
}

/** Shape of `window.coresense`, injected by the Electron preload script.
 *  Present only in the bundled desktop window — a plain browser never has it,
 *  which is how the renderer tells "official app window" from "any browser". */
export interface CoreSenseBridge {
  /** The shared API key, handed to the first-party window so it skips the
   *  manual paste gate. */
  apiKey: string;
  /** The port the local Hono server bound to. Lets the renderer skip the
   *  capabilities probe and avoid the dev/prod port-default mismatch. */
  httpPort: number;
  /** Ship a renderer-side LogEntry into the main-process log pipeline. */
  shipLogEntry: (entry: LogEntry) => void;
  /** Open the logs folder in the OS file manager. */
  revealLogs: () => void;
}

export interface ServerStatus {
  port: number;
  wsClients: number;
  transport: TransportState;
  deviceId?: string;
  bridge: BridgeStatus;
}
