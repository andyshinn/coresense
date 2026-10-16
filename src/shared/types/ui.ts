// Persisted renderer UI state (UiState) and its defaults.

import type { ActiveKey } from '../keys';
import type { LogLevel } from '../logLevels';
import type { ActivityWindowKey, ContactKind } from './domain';

export type PeopleSort = 'recent' | 'loud' | 'name';

export type PeopleFilter = 'all' | 'contacts';

/** Per-channel People rail view state. Persisted in UiState (Task 8). */
export interface PeopleRailPrefs {
  sort: PeopleSort;
  filter: PeopleFilter;
}

// LeftNav branch open/closed state. Keys cover the three Collapsible
// containers in LeftNav (Channels parent, Contacts wrapper in nested mode,
// and each ContactKind group).
export type LeftNavGroupId = 'channels' | 'contacts' | ContactKind;

export type ThemePref = 'auto' | 'dark' | 'light';

/** One entity's usage tally for frecency ranking (an emoji, a macro id, …). */
export interface UsageEntry {
  count: number;
  lastUsedMs: number;
}

export type UsageMap = Record<string, UsageEntry>;

/** Persisted Logs panel view options. */
export interface LogsFilter {
  minLevel: LogLevel;
  showMain: boolean;
  showRenderer: boolean;
  paused: boolean;
}

/** The Logs panel's two substring boxes. Session-only, at the store ROOT rather
 *  than in UiState — same reasoning as `peopleQuery` and the search query.
 *  They are live text inputs, so persisting them would put a keystroke back on
 *  the ui write path; and a substring typed last week silently emptying the
 *  Logs panel on the next launch is a bug, not a restored preference. */
export interface LogsSearch {
  loggerSubstring: string;
  textSubstring: string;
}

export const DEFAULT_LOGS_SEARCH: LogsSearch = { loggerSubstring: '', textSubstring: '' };

export interface UiState {
  activeKey: ActiveKey;
  pinned: ActiveKey[]; // keys in pin order
  leftOpen: boolean;
  rightOpen: boolean;
  rightWidth: number;
  // section id (e.g. 'channel.members') → collapsed/expanded
  openRailSections: Record<string, boolean>;
  // LeftNav Collapsible open/closed flags (Channels parent, Contacts wrapper,
  // and the four ContactKind groups).
  leftNavOpen: Record<LeftNavGroupId, boolean>;
  // Packet log source filter: RF (mesh) packets, BLE/companion frames, or both.
  packetLogFilter: { source: 'both' | 'rf' | 'ble' };
  // Packet log retention. liveBufferSize = packets kept in memory / shown.
  // storedHistorySize = packets persisted on disk (0 = off).
  packetLog: { liveBufferSize: number; storedHistorySize: number };
  /** Selected window in the channel rail's Activity section. Global rather than
   *  per-channel: it is a reading habit, and a per-channel map would grow one
   *  entry per channel ever opened. */
  channelActivityWindow: ActivityWindowKey;
  // Logs panel filter options. The two substring boxes are NOT here — see
  // LogsSearch.
  logsFilter: LogsFilter;
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
  // Retention: nothing in the renderer removes entries, so main prunes markers
  // whose channel/contact is gone (older than a grace window) on load only —
  // applyUiState max-merges this map and never deletes, so a prune done any
  // later is resurrected by the next full-object PUT. See pruneLastRead in
  // src/main/storage/settings.ts.
  lastReadByKey: Record<string, number>;
  // Most-recently-visited keys, newest first. Drives the Cmd+K "Recent"
  // section. Capped at RECENT_KEYS_MAX entries; persisted across sessions
  // so a relaunch resumes the same jump list.
  recentKeys: ActiveKey[];
  // Per-emoji usage counts driving quick-react auto-pinning. Account-global
  // (synced via applyUiState like pinned/recentKeys).
  emojiUsage: UsageMap;
  // Per-macro usage counts (macro id → tally) driving the quick bar's two
  // auto-pinned macro chips. Account-global, synced alongside emojiUsage.
  macroUsage: UsageMap;
  // Per-channel People rail sort + filter. Keyed by channel key. Grows
  // unboundedly, exactly like lastReadByKey. NOT in applyUiState's sync
  // whitelist, so this persists locally but does not cross-sync.
  peopleRail: Record<string, PeopleRailPrefs>;
}

/** The UiState fields a `uiState` broadcast may lack. Main relays whatever a
 *  client PUT (filling in only a missing packetLog), so a legacy or partial
 *  producer can omit these; the renderer's applyUiState coalesces each one. */
type UiStateUpdateOptional = 'lastReadByKey' | 'emojiUsage' | 'macroUsage' | 'packetLog';

/** UiState as a `uiState` broadcast carries it — see UiStateUpdateOptional. */
export type UiStateUpdate = Omit<UiState, UiStateUpdateOptional> & Partial<Pick<UiState, UiStateUpdateOptional>>;

export const PACKET_LOG_BOUNDS = {
  liveBufferSize: { min: 200, max: 20_000 },
  storedHistorySize: { min: 0, max: 200_000 },
} as const;

export const DEFAULT_PACKET_LOG_SETTINGS = { liveBufferSize: 2_000, storedHistorySize: 20_000 };

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
  packetLogFilter: { source: 'both' },
  packetLog: { ...DEFAULT_PACKET_LOG_SETTINGS },
  channelActivityWindow: '24h',
  logsFilter: {
    minLevel: 'silly',
    showMain: true,
    showRenderer: true,
    paused: false,
  },
  themePref: 'auto',
  selectedContactKey: null,
  selectedSiteKey: null,
  lastReadByKey: {},
  recentKeys: [],
  emojiUsage: {},
  macroUsage: {},
  peopleRail: {},
};
