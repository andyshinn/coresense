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

export interface BridgeStatus {
  tcpPort: number | null;
  wsPort: number | null;
  bindAddress: string;
  lanAddress: string | null;
  tcpClients: number;
  wsClients: number;
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

export type PathHashSize = 1 | 2 | 4;

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
}

export type MessageState = 'sending' | 'sent' | 'ack' | 'failed' | 'received';

export interface MessageMeta {
  hops?: number;
  rssi?: number;
  snr?: number;
  path?: string[];
  signatureHex?: string;
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

export interface Owner {
  name: string;
  publicKeyHex: string;
  publicKeyShort: string;
}

export type ThemePrefValue = 'auto' | 'dark' | 'light';

export type MessageStyle = 'compact' | 'rich';

export interface AppSettings {
  theme: ThemePrefValue;
  messageStyle: MessageStyle;
  composer: {
    returnToSend: boolean;
  };
  notifications: {
    directMessage: boolean;
    channelMention: boolean;
    channelMessage: boolean;
    repeaterAlert: boolean;
    sensorAlert: boolean;
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
}

export type ContactGrouping = 'nested' | 'top-level';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'auto',
  messageStyle: 'rich',
  composer: { returnToSend: true },
  notifications: {
    directMessage: true,
    channelMention: true,
    channelMessage: false,
    repeaterAlert: true,
    sensorAlert: false,
    sound: true,
    suppressWhenFocused: true,
    dockBadge: true,
  },
  proxy: {
    enabled: true,
    bindAll: false,
    port: 5800,
    mdns: true,
  },
  toasts: { enabled: true, durationSec: 4 },
  pinUnreadToTop: false,
  autoReconnect: false,
  hideUnsyncedChannels: false,
  contactGrouping: 'nested',
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

export interface UiState {
  activeKey: string;
  pinned: string[]; // keys in pin order (channel + contact keys)
  leftOpen: boolean;
  rightOpen: boolean;
  rightWidth: number;
  // section id (e.g. 'channel.members') → collapsed/expanded
  openRailSections: Record<string, boolean>;
  // Contact key (`c:<pkhex>`) to surface in the right rail regardless of
  // activeKey. Set when the user clicks an @mention pill; cleared on
  // activeKey change. Takes precedence over the active conversation's
  // contact card when populated.
  selectedContactKey: string | null;
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
  selectedContactKey: null,
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
  messages: Message[];
  appSettings: AppSettings;
  radioSettings: RadioSettings;
  uiState: UiState;
}

export type MenuAction =
  | { kind: 'openSettings' }
  | { kind: 'openPalette' }
  | { kind: 'toggleRightRail' }
  | { kind: 'toggleLeftNav' }
  | { kind: 'focusSection'; section: 'channels' | 'contacts' | 'tools' | 'connection' }
  | { kind: 'cyclePinned'; direction: 'prev' | 'next' }
  | { kind: 'sendAdvert' }
  | { kind: 'focusKey'; key: string }
  | { kind: 'newChannel' }
  | { kind: 'addContact' }
  | { kind: 'pinToggle' }
  | { kind: 'disconnect' }
  | { kind: 'cycleTheme' };

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
  | { type: 'messages'; payload: { key: string; messages: Message[] } }
  | { type: 'messageState'; payload: { id: string; state: MessageState } }
  | { type: 'owner'; payload: Owner | null }
  | { type: 'appSettings'; payload: AppSettings }
  | { type: 'radioSettings'; payload: RadioSettings }
  | { type: 'repeaterStatus'; payload: RepeaterStatusSnapshot }
  | { type: 'repeaterTelemetry'; payload: RepeaterTelemetrySnapshot }
  | { type: 'pathLearned'; payload: PathLearnedEvent };

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
  platform: string;
  httpPort: number;
}

export interface ServerStatus {
  port: number;
  wsClients: number;
  transport: TransportState;
  deviceId?: string;
  bridge: BridgeStatus;
}
