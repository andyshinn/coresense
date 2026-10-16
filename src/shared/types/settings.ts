// Persisted app and device settings, each with its DEFAULT_*.

import type { LogLevel } from '../logLevels';
import type { DistanceUnit } from '../macros/types';
import { DEFAULT_QUICK_ACTION_IDS, type QuickActionId } from '../quickActions';
import type { ContactKind, PathHashSize } from './domain';
import { BRIDGE_DEFAULT_TCP_PORT, type UpdateChannel } from './platform';
import type { SearchSort } from './search';

/** How a person's identity colour is derived.
 *  'byKey'  — hue only when a real pubkey is known; everyone else is neutral.
 *  'byName' — hue from the display name, so everyone gets one. */
export type IdentityColorMode = 'byKey' | 'byName';

export type MessageStyle = 'compact' | 'rich';

/** Clock format for rendered timestamps. 'auto' follows the OS locale; the
 *  explicit values force a 12- or 24-hour clock regardless of locale. */
export type TimeFormatPref = 'auto' | '12h' | '24h';

export interface AppSettings {
  // No `theme` here on purpose: the live theme preference is `UiState.themePref`
  // (what App.tsx applies and Cmd-T cycles). An AppSettings.theme existed once,
  // was never read by anything, and is stripped on load — see issue #22.
  /** How a person's identity colour is derived — see `IdentityColorMode`. */
  identityColorMode: IdentityColorMode;
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
    /** Fold messages received while disconnected (stale ts) into a single
     *  per-conversation summary instead of one banner each. */
    summarizeBacklog: boolean;
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
  /** Auto-update channel + background-check toggle. */
  updates: {
    channel: UpdateChannel;
    autoCheck: boolean;
  };
  distanceUnit: DistanceUnit;
}

export type ContactGrouping = 'nested' | 'top-level';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  identityColorMode: 'byKey',
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
    summarizeBacklog: true,
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
  quickActions: [...DEFAULT_QUICK_ACTION_IDS],
  updates: { channel: 'stable', autoCheck: true },
  distanceUnit: 'metric',
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

/** Auto-add behaviour, spread across TWO firmware prefs and therefore two
 *  commands: the per-kind flags + overwrite_oldest + autoadd_max_hops live in
 *  `_prefs.autoadd_config`/`autoadd_max_hops` (CMD_SET_AUTO_ADD_CONFIG), and
 *  the master switch lives in `_prefs.manual_add_contacts` (byte 1 of
 *  CMD_SET_OTHER_PARAMS, reported in RESP_SELF_INFO byte 47).
 *
 *  `mode` is a derived VIEW of `manualAddContacts` bit 0, not independent app
 *  state: `MyMesh::shouldAutoAddContactType` returns true before it ever looks
 *  at `autoadd_config` while the bit is clear, so "all" (bit 0 clear) makes the
 *  four kind flags inert on the radio and "selected" (bit 0 set) makes the
 *  radio honour them. Writing `mode` without writing the bit is what made those
 *  four toggles decorative. */
export type AutoAddMode = 'all' | 'selected';

/** The per-kind auto-add flags stay flat (persisted and round-tripped to the
 *  radio as-is) but are keyed by ContactKind, so a new kind fails to compile
 *  here until it is mapped. */
export interface AutoAddConfig extends Record<ContactKind, boolean> {
  mode: AutoAddMode;
  overwriteOldest: boolean;
  /** Firmware `_prefs.autoadd_max_hops` — the radio drops adverts heard over
   *  more hops than this before auto-adding. 0 = no limit. Byte 2 of
   *  CMD_SET_AUTO_ADD_CONFIG, which the firmware reads only when the frame is
   *  ≥ 3 bytes, so the 2-byte form preserves whatever the radio has stored. */
  radioMaxHops: number;
  /** Firmware `_prefs.manual_add_contacts`. Bit 0 CLEAR = auto-add every
   *  advert and ignore the per-kind flags; bit 0 SET = honour them. Mirrored
   *  from RESP_SELF_INFO byte 47 and round-tripped on every write, because the
   *  firmware assigns this byte as the FIRST statement of its
   *  CMD_SET_OTHER_PARAMS handler — before any length guard — so a telemetry or
   *  share-position save that omits it silently rewrites the pref. Bits 1-7 are
   *  unused by the firmware; we preserve them rather than assume. */
  manualAddContacts: number;
  /** App-side: re-read the radio's contact store on a timer while connected
   *  (see main/state/contactRefresh.ts).
   *
   *  Defaults OFF and deliberately does NOT inherit the old `pullToRefresh`
   *  key. That key shipped as an unimplemented mobile "pull to refresh" idiom
   *  defaulting to true, so every existing user has it persisted as true
   *  without ever having asked for anything; reusing it would have opted the
   *  entire installed base into a ~15-25s companion-link contact walk every 15
   *  minutes. A background radio operation has to be something the user turned
   *  on (#45 item 6). */
  autoRefreshContacts: boolean;
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
  radioMaxHops: 0,
  manualAddContacts: 0,
  autoRefreshContacts: false,
  showPublicKeys: true,
};

/** A telemetry permission mode: 0 = deny, 1 = allow per contact flag, 2 = allow all. */
export type TelemetryMode = 0 | 1 | 2;

/** Telemetry/messaging knobs from CMD_SET_OTHER_PARAMS. Each telemetry field is
 *  a TelemetryMode. `multiAcks` is 0..2 typical; more ACKs increase reliability
 *  at the cost of airtime. */
export interface TelemetryPolicy {
  base: TelemetryMode;
  loc: TelemetryMode;
  env: TelemetryMode;
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
  /** Human-readable firmware version, e.g. "v1.15.0". Empty until DEVICE_INFO. */
  firmwareVersion: string;
  /** Firmware build date, e.g. "19 Apr 2026". Empty until DEVICE_INFO. */
  firmwareBuildDate: string;
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
  firmwareVersion: '',
  firmwareBuildDate: '',
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
