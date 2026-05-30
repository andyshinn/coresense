import { create } from 'zustand';
import type { DiscoveredContact } from '../../shared/contacts/discovered';
import {
  type AppSettings,
  type AutoAddConfig,
  type BleDevice,
  type BlockRule,
  type BridgeStatus,
  type Capabilities,
  type Channel,
  type Contact,
  DEFAULT_APP_SETTINGS,
  DEFAULT_AUTO_ADD_CONFIG,
  DEFAULT_DEVICE_CAPABILITIES,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_GPS_CONFIG,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_SYNC_PROGRESS,
  DEFAULT_TELEMETRY_POLICY,
  DEFAULT_UI_STATE,
  type DeviceCapabilities,
  type DeviceIdentity,
  type DeviceInfo,
  type GpsConfig,
  type LeftNavGroupId,
  type LogEntry,
  type MapSettings,
  type Message,
  type MessagePath,
  type MessageState,
  type Owner,
  type PathLearnedEvent,
  type RadioSettings,
  type RawPacket,
  type RepeaterStatusSnapshot,
  type RepeaterTelemetrySnapshot,
  type SearchSort,
  type StateSnapshot,
  type SyncProgress,
  type TelemetryPolicy,
  type ThemePref,
  type TileManifest,
  type TransportState,
  type UiState,
} from '../../shared/types';
import { setRendererLogLevel } from './logger';

const DEFAULT_MAP_MANIFEST: TileManifest = { missing: true, basemap: null, terrain: null };

const MAX_PACKETS = 500;
const MAX_LOGS = 5000;

export interface SearchFilters {
  kinds: ('channel' | 'dm')[];
  key?: string;
  /** Sender hex public key or the literal 'self' for owner-sent. */
  fromPk?: string;
  tsFrom?: number;
  tsTo?: number;
}

const DEFAULT_SEARCH_FILTERS: SearchFilters = { kinds: ['channel', 'dm'] };

// ---- Settings panel UI state ----------------------------------------------
// The redesigned Settings panel and the RightRail jump-list are sibling
// components under AppShell, so their shared state (which sections exist,
// which are dirty, the active section, the unsaved-changes prompt) lives here.
export type SettingsTab = 'app' | 'radio' | 'blocked' | 'extra';

export interface SettingsSectionMeta {
  id: string;
  title: string;
  tab: SettingsTab;
}

// Where the user was trying to go when a dirty section blocked them.
export type SettingsPendingTarget =
  | { kind: 'nav'; key: string }
  | { kind: 'tab'; tab: SettingsTab }
  | { kind: 'quit' };

interface SettingsUiState {
  activeTab: SettingsTab;
  /** Ordered section metadata for the active tab — drives the jump rail. */
  sections: SettingsSectionMeta[];
  dirtyById: Record<string, boolean>;
  /** Section currently scroll-spied into view; highlights in the jump rail. */
  activeSectionId: string | null;
  /** Set when navigation/quit was blocked by unsaved changes. */
  pendingTarget: SettingsPendingTarget | null;
  /** Jump-rail click target the panel should smooth-scroll to, then clear. */
  pendingScrollSectionId: string | null;
}

const DEFAULT_SETTINGS_UI: SettingsUiState = {
  activeTab: 'app',
  sections: [],
  dirtyById: {},
  activeSectionId: null,
  pendingTarget: null,
  pendingScrollSectionId: null,
};

// Per-section save/reset callbacks. Kept in a plain module map rather than the
// store so registering a section doesn't trigger a store-wide re-render — the
// UnsavedChangesDialog reads them imperatively when resolving "Save all".
interface SettingsSectionHandle {
  save: () => Promise<void>;
  reset: () => void;
}
const sectionHandles = new Map<string, SettingsSectionHandle>();

export function registerSectionHandle(id: string, handle: SettingsSectionHandle): void {
  sectionHandles.set(id, handle);
}
export function unregisterSectionHandle(id: string): void {
  sectionHandles.delete(id);
}
export function getSectionHandle(id: string): SettingsSectionHandle | undefined {
  return sectionHandles.get(id);
}

interface CoreState {
  // OS-level dark-mode signal pushed from main. Drives the resolved theme
  // (combined with ui.themePref) wherever app code wants to react to dark
  // mode — e.g. MapCanvas swapping basemap flavors.
  systemDark: boolean;

  // Connection
  transportState: TransportState;
  connectedDeviceId: string | undefined;
  syncProgress: SyncProgress;
  devices: BleDevice[];
  bridge: BridgeStatus | null;
  wsClients: number;

  // Live packet log (capped ring buffer)
  packets: RawPacket[];

  // Live log entries (capped ring buffer)
  logs: LogEntry[];

  // Domain data (mirrored from main)
  owner: Owner | null;
  channels: Channel[];
  /** Channel keys the connected radio reports owning right now. Empty when
   *  disconnected. Drives the "grayed missing channel" rendering in LeftNav. */
  channelPresence: Set<string>;
  contacts: Contact[];
  discovered: DiscoveredContact[];
  // Keyed by `key` (channel or contact key). The renderer is a cache —
  // authoritative history lives in main once Phase 3 lands.
  messagesByKey: Record<string, Message[]>;

  // Server capabilities (version, platform, httpPort, config.json path).
  // Null until the first snapshot hydrates it.
  capabilities: Capabilities | null;

  // Settings
  appSettings: AppSettings;
  blockRules: BlockRule[];
  radioSettings: RadioSettings;
  deviceIdentity: DeviceIdentity;
  autoAddConfig: AutoAddConfig;
  telemetryPolicy: TelemetryPolicy;
  gpsConfig: GpsConfig;
  deviceInfo: DeviceInfo;
  deviceCapabilities: DeviceCapabilities;
  mapSettings: MapSettings;
  /** Snapshot of which bundled PMTiles extracts are available on disk.
   *  Pushed by the snapshot endpoint; the Map panel uses it to gate mounting
   *  MapLibre vs. showing a "missing tiles" empty-state. */
  mapManifest: TileManifest;

  // Latest repeater admin snapshots keyed by contact key. Only the last
  // response is retained — the RightRail / RepeaterAdmin show it; we don't
  // need a full history for v1.
  repeaterStatusByKey: Record<string, RepeaterStatusSnapshot>;
  repeaterTelemetryByKey: Record<string, RepeaterTelemetrySnapshot>;

  // UI state (left/right pane open, active key, pinned items, rail sections)
  ui: UiState;

  // Settings panel UI (active tab, registered sections, dirty map, prompts)
  settingsUi: SettingsUiState;

  // Transient
  busy: boolean;
  // ID of the message currently expanded in the right rail. Clears when the
  // active key changes (the selection has no meaning outside its conversation).
  selectedMessageId: string | null;
  // Cmd+K palette open state. Not persisted across reloads.
  paletteOpen: boolean;
  // Add Channel popover open state. Not persisted across reloads.
  addChannelOpen: boolean;

  // Sidebar quick-filter / search panel state. Single source of truth — both
  // the LeftNav input and the SearchResults panel input bind to this so they
  // stay in sync as the user moves between them.
  searchQuery: string;
  searchFilters: SearchFilters;
  searchSort: SearchSort;
  // Incremented when Cmd/Ctrl+F fires globally. The SearchResults panel
  // watches it to refocus its input even when the panel is already mounted.
  searchFocusNonce: number;
  // When set, the currently-active ChannelView/DMView should scroll the
  // matching message into view and briefly flash it, then clear this. Set by
  // a search-result click. Distinct from `selectedMessageId` (right-rail
  // expansion) because we don't want every right-rail open to trigger a flash.
  pendingJumpMid: string | null;

  // Hydration helpers
  hydrate: (snapshot: StateSnapshot) => void;
  applyPacket: (p: RawPacket) => void;
  applyTransportState: (state: TransportState, deviceId?: string) => void;
  applySyncProgress: (progress: SyncProgress) => void;
  applyDevices: (devices: BleDevice[]) => void;
  applyBridge: (bridge: BridgeStatus) => void;
  applyMessages: (key: string, messages: Message[]) => void;
  applyMessageState: (id: string, state: MessageState) => void;
  /** Append a newly-heard relay path to an outgoing channel message (dedupe by
   *  MessagePath.id, bump timesHeard, advance state). Broadcast by the main
   *  process when a PUSH_CODE_LOG_RX_DATA observation is attributed to one of
   *  our recent channel sends. */
  appendMessagePath: (id: string, path: MessagePath, state: MessageState) => void;
  applyChannels: (channels: Channel[]) => void;
  applyChannelPresence: (keys: string[]) => void;
  applyContacts: (contacts: Contact[]) => void;
  applyDiscovered: (rows: DiscoveredContact[]) => void;
  applyOwner: (owner: Owner | null) => void;
  applyAppSettings: (settings: AppSettings) => void;
  applyBlockRules: (rules: BlockRule[]) => void;
  applyRadioSettings: (settings: RadioSettings) => void;
  applyDeviceIdentity: (identity: DeviceIdentity) => void;
  applyAutoAddConfig: (cfg: AutoAddConfig) => void;
  applyTelemetryPolicy: (policy: TelemetryPolicy) => void;
  applyGpsConfig: (cfg: GpsConfig) => void;
  applyDeviceInfo: (info: DeviceInfo) => void;
  applyDeviceCapabilities: (caps: DeviceCapabilities) => void;
  applyMapSettings: (settings: MapSettings) => void;
  applyMapManifest: (manifest: TileManifest) => void;
  /** Merge the account-global subset of a remote UiState broadcast (unread
   *  markers, pinned, theme pref, recents). Window-local fields are ignored so
   *  another client's pane layout / active conversation can't clobber ours. */
  applyUiState: (state: UiState) => void;
  applyRepeaterStatus: (snap: RepeaterStatusSnapshot) => void;
  applyRepeaterTelemetry: (snap: RepeaterTelemetrySnapshot) => void;
  applyPathLearned: (event: PathLearnedEvent) => void;
  setBusy: (b: boolean) => void;
  setSystemDark: (dark: boolean) => void;
  // A path-learn event waiting for a user verdict (Keep mine / Accept new).
  // Only populated when previousManual=true; auto-learn over an empty or
  // already-learned slot is applied silently with a toast.
  pendingPathLearn: PathLearnedEvent | null;
  dismissPathLearned: () => void;
  setWsClients: (n: number) => void;

  // Browser-style back/forward stacks. Session-only (deliberately NOT in
  // UiState/persisted) — a restart starts fresh, and entries pointing at
  // channels/contacts that no longer exist would be misleading. navCurrent
  // is implicit: it equals ui.activeKey.
  navPast: string[];
  navFuture: string[];

  // UI mutators (also persisted to main via api.putUiState; see App.tsx)
  // `skipHistory` opts out of pushing the prior activeKey onto navPast — used
  // by goBack/goForward themselves and by the few "restore previous view"
  // sites (Esc in the search input) that are conceptually an undo, not a
  // navigation. Default behaviour pushes history.
  setActiveKey: (key: string, opts?: { skipHistory?: boolean }) => void;
  goBack: () => void;
  goForward: () => void;
  /** Pick a contact. `keepSite: true` preserves any currently-selected
   *  co-located site (used by the Map view's spiderfy when a member is
   *  highlighted but the site should stay expanded). Default behaviour clears
   *  the site so the two selections are mutually exclusive. */
  setSelectedContact: (key: string | null, options?: { keepSite?: boolean }) => void;
  setSelectedSite: (key: string | null) => void;
  toggleLeftNav: () => void;
  toggleRightRail: () => void;
  setRightWidth: (w: number) => void;
  setRailSection: (id: string, open: boolean) => void;
  setLeftNavGroup: (id: LeftNavGroupId, open: boolean) => void;
  setDraft: (key: string, text: string) => void;
  setPacketLogFilter: (patch: Partial<UiState['packetLogFilter']>) => void;
  appendLog: (entry: LogEntry) => void;
  replaceLogs: (entries: LogEntry[]) => void;
  setLogsFilter: (patch: Partial<UiState['logsFilter']>) => void;
  clearLogs: () => void;
  setThemePref: (mode: ThemePref) => void;
  togglePin: (key: string) => void;
  setSelectedMessage: (id: string | null) => void;
  markRead: (key: string, ts: number) => void;
  markAllRead: (key: string) => void;
  markAllReadGlobal: () => void;
  clearPackets: () => void;
  openPalette: () => void;
  closePalette: () => void;
  setAddChannelOpen: (open: boolean) => void;

  setSearchQuery: (query: string) => void;
  setSearchFilters: (patch: Partial<SearchFilters>) => void;
  setSearchSort: (sort: SearchSort) => void;
  clearSearch: () => void;
  /** Bump the focus nonce so the SearchResults panel input grabs focus. */
  requestSearchFocus: () => void;
  /** Set by a search-result click. ChannelView/DMView consume it (scroll +
   *  flash) and then call this with null to clear. */
  setPendingJump: (mid: string | null) => void;

  // ---- Settings panel mutators ----
  /** Switch the active Settings tab. Guarded: prompts when a section is dirty. */
  setSettingsTab: (tab: SettingsTab) => void;
  /** Declared by SettingsPanel each tab change — the ordered jump-rail list. */
  registerSettingsSections: (sections: SettingsSectionMeta[]) => void;
  /** Each section reports its dirty flag here (drives rail + pill dots). */
  setSectionDirty: (id: string, dirty: boolean) => void;
  /** Scroll-spy result from the panel's IntersectionObserver. */
  setActiveSettingsSection: (id: string | null) => void;
  /** Jump-rail click — the panel watches this and smooth-scrolls. */
  requestScrollToSection: (id: string) => void;
  clearScrollRequest: () => void;
  /** Stash a blocked navigation/quit so the panel can show the prompt. */
  setPendingTarget: (target: SettingsPendingTarget) => void;
  clearPendingTarget: () => void;
  /** Run the blocked navigation/tab-switch after the user resolves the prompt. */
  commitPendingTarget: () => void;
  /** Reset settings UI state when the panel unmounts. */
  clearSettingsUi: () => void;
}

// Shared navigation update — used by setActiveKey, commitPendingTarget, and
// goBack/goForward so a deferred or backward navigation commits with exactly
// the same recents/selection logic. `historyDelta` lets the caller adjust the
// nav stacks (push prior key for forward nav; swap stacks for back/forward).
function navStateUpdate(
  s: CoreState,
  key: string,
  historyDelta?: { navPast?: string[]; navFuture?: string[] },
): Partial<CoreState> {
  const recentKeys = [key, ...s.ui.recentKeys.filter((k) => k !== key)].slice(0, RECENT_KEYS_MAX);
  const out: Partial<CoreState> = {
    ui: { ...s.ui, activeKey: key, selectedContactKey: null, selectedSiteKey: null, recentKeys },
    selectedMessageId: null,
  };
  if (historyDelta?.navPast !== undefined) out.navPast = historyDelta.navPast;
  if (historyDelta?.navFuture !== undefined) out.navFuture = historyDelta.navFuture;
  return out;
}

// Cap the back/forward stacks. Browsers use ~50; same here. Older entries are
// dropped from the front of navPast when exceeded.
const NAV_HISTORY_MAX = 50;

function pushPast(past: string[], key: string): string[] {
  // Dedupe consecutive duplicates so repeated clicks on the same item don't
  // bloat the stack.
  if (past.length > 0 && past[past.length - 1] === key) return past;
  const next = [...past, key];
  return next.length > NAV_HISTORY_MAX ? next.slice(-NAV_HISTORY_MAX) : next;
}

function anyDirty(dirtyById: Record<string, boolean>): boolean {
  return Object.values(dirtyById).some(Boolean);
}

const RECENT_KEYS_MAX = 10;

export const useStore = create<CoreState>((set) => ({
  systemDark:
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  transportState: 'idle',
  connectedDeviceId: undefined,
  syncProgress: DEFAULT_SYNC_PROGRESS,
  devices: [],
  bridge: null,
  wsClients: 0,

  packets: [],
  logs: [],

  owner: null,
  channels: [],
  channelPresence: new Set<string>(),
  contacts: [],
  discovered: [],
  messagesByKey: {},

  capabilities: null,

  appSettings: DEFAULT_APP_SETTINGS,
  blockRules: [],
  radioSettings: DEFAULT_RADIO_SETTINGS,
  deviceIdentity: DEFAULT_DEVICE_IDENTITY,
  autoAddConfig: DEFAULT_AUTO_ADD_CONFIG,
  telemetryPolicy: DEFAULT_TELEMETRY_POLICY,
  gpsConfig: DEFAULT_GPS_CONFIG,
  deviceInfo: DEFAULT_DEVICE_INFO,
  deviceCapabilities: DEFAULT_DEVICE_CAPABILITIES,
  mapSettings: DEFAULT_MAP_SETTINGS,
  mapManifest: DEFAULT_MAP_MANIFEST,

  repeaterStatusByKey: {},
  repeaterTelemetryByKey: {},

  ui: DEFAULT_UI_STATE,
  settingsUi: DEFAULT_SETTINGS_UI,
  navPast: [],
  navFuture: [],

  busy: false,
  selectedMessageId: null,
  paletteOpen: false,
  addChannelOpen: false,

  searchQuery: '',
  searchFilters: DEFAULT_SEARCH_FILTERS,
  searchSort: 'recency',
  searchFocusNonce: 0,
  pendingJumpMid: null,

  hydrate: (snapshot) => {
    setRendererLogLevel(snapshot.appSettings.logging.level);
    set(() => ({
      transportState: snapshot.transport.state,
      connectedDeviceId: snapshot.transport.deviceId,
      syncProgress: snapshot.syncProgress ?? DEFAULT_SYNC_PROGRESS,
      bridge: snapshot.bridge,
      owner: snapshot.owner,
      channels: snapshot.channels,
      channelPresence: new Set(snapshot.channelPresence ?? []),
      contacts: snapshot.contacts,
      discovered: snapshot.discoveredContacts ?? [],
      messagesByKey: groupMessagesByKey(snapshot.messages),
      capabilities: snapshot.capabilities,
      appSettings: snapshot.appSettings,
      blockRules: snapshot.blockRules,
      radioSettings: snapshot.radioSettings,
      deviceIdentity: snapshot.deviceIdentity ?? DEFAULT_DEVICE_IDENTITY,
      autoAddConfig: snapshot.autoAddConfig ?? DEFAULT_AUTO_ADD_CONFIG,
      telemetryPolicy: snapshot.telemetryPolicy ?? DEFAULT_TELEMETRY_POLICY,
      gpsConfig: snapshot.gpsConfig ?? DEFAULT_GPS_CONFIG,
      deviceInfo: snapshot.deviceInfo ?? DEFAULT_DEVICE_INFO,
      deviceCapabilities: snapshot.deviceCapabilities ?? DEFAULT_DEVICE_CAPABILITIES,
      // Merge snapshot over defaults so any fields added to MapSettings in
      // newer builds get sensible values when reading older persisted state.
      mapSettings: { ...DEFAULT_MAP_SETTINGS, ...snapshot.mapSettings },
      mapManifest: snapshot.mapManifest,
      ui: snapshot.uiState,
      // Seed in-session sort from the persisted default so an existing user
      // preference takes effect immediately on launch.
      searchSort: snapshot.appSettings.search?.defaultSort ?? 'recency',
    }));
  },

  applyPacket: (p) =>
    set((s) => {
      const next =
        s.packets.length >= MAX_PACKETS ? s.packets.slice(-(MAX_PACKETS - 1)) : s.packets;
      return { packets: [...next, p] };
    }),

  applyTransportState: (state, deviceId) =>
    set(() => ({ transportState: state, connectedDeviceId: deviceId })),

  applySyncProgress: (progress) => set(() => ({ syncProgress: progress })),

  applyDevices: (devices) => set(() => ({ devices })),
  applyBridge: (bridge) => set(() => ({ bridge })),

  applyMessages: (key, messages) =>
    set((s) => ({ messagesByKey: { ...s.messagesByKey, [key]: messages } })),

  applyMessageState: (id, state) =>
    set((s) => {
      // Searching every key is fine for normal volumes; if this becomes a hot
      // path we can switch to an id→key index.
      const next: Record<string, Message[]> = {};
      for (const [k, list] of Object.entries(s.messagesByKey)) {
        next[k] = list.map((m) => (m.id === id ? { ...m, state } : m));
      }
      return { messagesByKey: next };
    }),

  appendMessagePath: (id, path, state) =>
    set((s) => {
      const next: Record<string, Message[]> = {};
      for (const [k, list] of Object.entries(s.messagesByKey)) {
        next[k] = list.map((m) => {
          if (m.id !== id) return m;
          const existingPaths = m.meta?.paths ?? [];
          if (existingPaths.some((p) => p.id === path.id)) return { ...m, state };
          return {
            ...m,
            state,
            meta: {
              ...m.meta,
              paths: [...existingPaths, path],
              timesHeard: (m.meta?.timesHeard ?? 0) + 1,
            },
          };
        });
      }
      return { messagesByKey: next };
    }),

  applyChannels: (channels) => set(() => ({ channels })),
  applyChannelPresence: (keys) => set(() => ({ channelPresence: new Set(keys) })),
  applyContacts: (contacts) => set(() => ({ contacts })),
  applyDiscovered: (rows) => set(() => ({ discovered: rows })),
  applyOwner: (owner) => set(() => ({ owner })),
  applyAppSettings: (settings) => {
    setRendererLogLevel(settings.logging.level);
    set(() => ({ appSettings: settings }));
  },
  applyBlockRules: (rules) => set(() => ({ blockRules: rules })),
  applyRadioSettings: (settings) => set(() => ({ radioSettings: settings })),
  applyDeviceIdentity: (identity) => set(() => ({ deviceIdentity: identity })),
  applyAutoAddConfig: (cfg) => set(() => ({ autoAddConfig: cfg })),
  applyTelemetryPolicy: (policy) => set(() => ({ telemetryPolicy: policy })),
  applyGpsConfig: (cfg) => set(() => ({ gpsConfig: cfg })),
  applyDeviceInfo: (info) => set(() => ({ deviceInfo: info })),
  applyDeviceCapabilities: (caps) => set(() => ({ deviceCapabilities: caps })),
  applyMapSettings: (settings) => set(() => ({ mapSettings: settings })),
  applyMapManifest: (manifest) => set(() => ({ mapManifest: manifest })),
  applyUiState: (incoming) =>
    set((s) => {
      // Idempotent: when the synced subset already matches, return {} so `ui`
      // keeps its object identity and App.tsx's debounced PUT effect doesn't
      // re-fire — otherwise a client would loop forever on its own echo.
      const same =
        shallowEqualRecord(s.ui.lastReadByKey, incoming.lastReadByKey) &&
        arraysEqual(s.ui.pinned, incoming.pinned) &&
        arraysEqual(s.ui.recentKeys, incoming.recentKeys) &&
        s.ui.themePref === incoming.themePref;
      if (same) return {};
      return {
        ui: {
          ...s.ui,
          lastReadByKey: incoming.lastReadByKey,
          pinned: incoming.pinned,
          recentKeys: incoming.recentKeys,
          themePref: incoming.themePref,
        },
      };
    }),
  applyRepeaterStatus: (snap) =>
    set((s) => ({
      repeaterStatusByKey: { ...s.repeaterStatusByKey, [snap.contactKey]: snap },
    })),
  applyRepeaterTelemetry: (snap) =>
    set((s) => ({
      repeaterTelemetryByKey: { ...s.repeaterTelemetryByKey, [snap.contactKey]: snap },
    })),

  pendingPathLearn: null,
  applyPathLearned: (event) =>
    set(() => ({
      // Only block on a manual-path overwrite. Auto-learn over an empty slot or
      // an already-auto-learned path is silently absorbed — the App-level toast
      // surfaces it.
      pendingPathLearn: event.previousManual ? event : null,
    })),
  dismissPathLearned: () => set(() => ({ pendingPathLearn: null })),

  setBusy: (b) => set(() => ({ busy: b })),
  setSystemDark: (dark) => set(() => ({ systemDark: dark })),
  setWsClients: (n) => set(() => ({ wsClients: n })),

  setActiveKey: (key, opts) =>
    set((s) => {
      // No-op when the user clicks the already-active entry. Avoids polluting
      // history with a dedupe-able entry, and short-circuits the unsaved-guard
      // check that would otherwise trigger on Settings → Settings.
      if (key === s.ui.activeKey) return {};
      // Guard: if the user is leaving the Settings panel with unsaved section
      // changes, stash the target and let the panel raise the prompt instead
      // of navigating. recentKeys + nav stacks stay untouched until the move
      // commits via commitPendingTarget.
      const leavingSettings =
        s.ui.activeKey.startsWith('tool:settings') && !key.startsWith('tool:settings');
      if (leavingSettings && anyDirty(s.settingsUi.dirtyById)) {
        return { settingsUi: { ...s.settingsUi, pendingTarget: { kind: 'nav', key } } };
      }
      // Forward navigation: push current onto past, clear future. Restore-from-
      // search-Esc and goBack/goForward itself opt out via skipHistory.
      if (opts?.skipHistory) return navStateUpdate(s, key);
      return navStateUpdate(s, key, {
        navPast: pushPast(s.navPast, s.ui.activeKey),
        navFuture: [],
      });
    }),
  goBack: () =>
    set((s) => {
      if (s.navPast.length === 0) return {};
      const target = s.navPast[s.navPast.length - 1];
      // Same Settings unsaved-guard as forward nav — back through a dirty
      // Settings panel still needs the prompt. The deferred commit replays
      // the goBack by routing through navStateUpdate with swapped stacks.
      const leavingSettings =
        s.ui.activeKey.startsWith('tool:settings') && !target.startsWith('tool:settings');
      if (leavingSettings && anyDirty(s.settingsUi.dirtyById)) {
        return { settingsUi: { ...s.settingsUi, pendingTarget: { kind: 'nav', key: target } } };
      }
      return navStateUpdate(s, target, {
        navPast: s.navPast.slice(0, -1),
        navFuture: [...s.navFuture, s.ui.activeKey],
      });
    }),
  goForward: () =>
    set((s) => {
      if (s.navFuture.length === 0) return {};
      const target = s.navFuture[s.navFuture.length - 1];
      const leavingSettings =
        s.ui.activeKey.startsWith('tool:settings') && !target.startsWith('tool:settings');
      if (leavingSettings && anyDirty(s.settingsUi.dirtyById)) {
        return { settingsUi: { ...s.settingsUi, pendingTarget: { kind: 'nav', key: target } } };
      }
      return navStateUpdate(s, target, {
        navPast: pushPast(s.navPast, s.ui.activeKey),
        navFuture: s.navFuture.slice(0, -1),
      });
    }),
  setSelectedContact: (key, options) =>
    // Picking a contact clears any selected site so the Map rail routes
    // unambiguously to the node card. Auto-open the rail so the resulting
    // node card is immediately visible (a no-op when already open or when the
    // selection is being cleared). When `keepSite` is set, leave the site
    // selection alone — used by the spiderfied member click so the spread
    // stays open with the chosen member highlighted.
    set((s) => ({
      ui: {
        ...s.ui,
        selectedContactKey: key,
        selectedSiteKey: options?.keepSite ? s.ui.selectedSiteKey : null,
        rightOpen: key ? true : s.ui.rightOpen,
      },
    })),
  setSelectedSite: (key) =>
    set((s) => ({
      ui: {
        ...s.ui,
        selectedSiteKey: key,
        selectedContactKey: null,
        rightOpen: key ? true : s.ui.rightOpen,
      },
    })),
  setSelectedMessage: (id) => set(() => ({ selectedMessageId: id })),
  toggleLeftNav: () => set((s) => ({ ui: { ...s.ui, leftOpen: !s.ui.leftOpen } })),
  toggleRightRail: () => set((s) => ({ ui: { ...s.ui, rightOpen: !s.ui.rightOpen } })),
  setRightWidth: (w) => set((s) => ({ ui: { ...s.ui, rightWidth: w } })),
  setRailSection: (id, open) =>
    set((s) => ({ ui: { ...s.ui, openRailSections: { ...s.ui.openRailSections, [id]: open } } })),
  setLeftNavGroup: (id, open) =>
    set((s) => ({ ui: { ...s.ui, leftNavOpen: { ...s.ui.leftNavOpen, [id]: open } } })),
  setDraft: (key, text) =>
    set((s) => {
      const next = { ...s.ui.drafts };
      if (text) next[key] = text;
      else delete next[key];
      return { ui: { ...s.ui, drafts: next } };
    }),
  setPacketLogFilter: (patch) =>
    set((s) => ({ ui: { ...s.ui, packetLogFilter: { ...s.ui.packetLogFilter, ...patch } } })),
  appendLog: (entry) =>
    set((s) => {
      // snapshot+live can overlap during ws connect, so dedupe by id
      for (let i = s.logs.length - 1; i >= Math.max(0, s.logs.length - 10); i--) {
        if (s.logs[i].id === entry.id) return s;
      }
      const next = s.logs.length >= MAX_LOGS ? s.logs.slice(-(MAX_LOGS - 1)) : s.logs;
      return { logs: [...next, entry] };
    }),
  replaceLogs: (entries) => set(() => ({ logs: entries.slice(-MAX_LOGS) })),
  setLogsFilter: (patch) =>
    set((s) => ({ ui: { ...s.ui, logsFilter: { ...s.ui.logsFilter, ...patch } } })),
  clearLogs: () => set(() => ({ logs: [] })),
  setThemePref: (mode) => set((s) => ({ ui: { ...s.ui, themePref: mode } })),
  togglePin: (key) =>
    set((s) => {
      const has = s.ui.pinned.includes(key);
      return {
        ui: {
          ...s.ui,
          pinned: has ? s.ui.pinned.filter((k) => k !== key) : [...s.ui.pinned, key],
        },
      };
    }),
  openPalette: () => set(() => ({ paletteOpen: true })),
  closePalette: () => set(() => ({ paletteOpen: false })),
  setAddChannelOpen: (open) => set({ addChannelOpen: open }),

  setSearchQuery: (query) => set(() => ({ searchQuery: query })),
  setSearchFilters: (patch) => set((s) => ({ searchFilters: { ...s.searchFilters, ...patch } })),
  setSearchSort: (sort) => set(() => ({ searchSort: sort })),
  clearSearch: () =>
    set(() => ({
      searchQuery: '',
      searchFilters: DEFAULT_SEARCH_FILTERS,
    })),
  requestSearchFocus: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
  setPendingJump: (mid) => set(() => ({ pendingJumpMid: mid })),
  markRead: (key, ts) =>
    set((s) => {
      const prev = s.ui.lastReadByKey[key] ?? 0;
      if (ts <= prev) return {};
      return {
        ui: { ...s.ui, lastReadByKey: { ...s.ui.lastReadByKey, [key]: ts } },
      };
    }),
  markAllRead: (key) =>
    set((s) => ({
      ui: { ...s.ui, lastReadByKey: { ...s.ui.lastReadByKey, [key]: Date.now() } },
    })),
  markAllReadGlobal: () =>
    set((s) => {
      const now = Date.now();
      const next: Record<string, number> = { ...s.ui.lastReadByKey };
      for (const ch of s.channels) next[ch.key] = now;
      for (const c of s.contacts) next[c.key] = now;
      return { ui: { ...s.ui, lastReadByKey: next } };
    }),
  clearPackets: () => set(() => ({ packets: [] })),

  setSettingsTab: (tab) =>
    set((s) => {
      if (tab === s.settingsUi.activeTab) return {};
      // Switching tabs unmounts the current tab's sections (losing their
      // drafts), so prompt first when anything is dirty.
      if (anyDirty(s.settingsUi.dirtyById)) {
        return { settingsUi: { ...s.settingsUi, pendingTarget: { kind: 'tab', tab } } };
      }
      return { settingsUi: { ...s.settingsUi, activeTab: tab } };
    }),
  registerSettingsSections: (sections) =>
    set((s) => ({ settingsUi: { ...s.settingsUi, sections } })),
  setSectionDirty: (id, dirty) =>
    set((s) => {
      if ((s.settingsUi.dirtyById[id] ?? false) === dirty) return {};
      return {
        settingsUi: { ...s.settingsUi, dirtyById: { ...s.settingsUi.dirtyById, [id]: dirty } },
      };
    }),
  setActiveSettingsSection: (id) =>
    set((s) => {
      if (s.settingsUi.activeSectionId === id) return {};
      return { settingsUi: { ...s.settingsUi, activeSectionId: id } };
    }),
  requestScrollToSection: (id) =>
    set((s) => ({ settingsUi: { ...s.settingsUi, pendingScrollSectionId: id } })),
  clearScrollRequest: () =>
    set((s) => ({ settingsUi: { ...s.settingsUi, pendingScrollSectionId: null } })),
  setPendingTarget: (target) =>
    set((s) => ({ settingsUi: { ...s.settingsUi, pendingTarget: target } })),
  clearPendingTarget: () => set((s) => ({ settingsUi: { ...s.settingsUi, pendingTarget: null } })),
  commitPendingTarget: () =>
    set((s) => {
      const t = s.settingsUi.pendingTarget;
      if (!t) return {};
      if (t.kind === 'nav') {
        // Treat the deferred nav as a fresh forward navigation — push current
        // onto past, clear future. If the original gesture was Cmd+Left, the
        // user resolving the unsaved-changes dialog effectively committed to
        // a new nav rather than a strict pop; this matches what a browser does
        // when "Leave this page?" is confirmed.
        return {
          ...navStateUpdate(s, t.key, {
            navPast: pushPast(s.navPast, s.ui.activeKey),
            navFuture: [],
          }),
          settingsUi: { ...s.settingsUi, pendingTarget: null },
        };
      }
      if (t.kind === 'tab') {
        return { settingsUi: { ...s.settingsUi, pendingTarget: null, activeTab: t.tab } };
      }
      // 'quit' is resolved by the dialog (POST /api/app/quit); just clear it.
      return { settingsUi: { ...s.settingsUi, pendingTarget: null } };
    }),
  clearSettingsUi: () => set(() => ({ settingsUi: DEFAULT_SETTINGS_UI })),
}));

function groupMessagesByKey(messages: Message[]): Record<string, Message[]> {
  const out: Record<string, Message[]> = {};
  for (const m of messages) {
    const list = out[m.key] ?? [];
    list.push(m);
    out[m.key] = list;
  }
  return out;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function shallowEqualRecord(a: Record<string, number>, b: Record<string, number>): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

// Useful narrow selectors for components.
export const selectIsConnected = (s: CoreState) => s.transportState === 'connected';
export const selectActiveMessages = (s: CoreState) => s.messagesByKey[s.ui.activeKey] ?? [];
export const selectAnySettingsDirty = (s: CoreState) => anyDirty(s.settingsUi.dirtyById);
