import { create } from 'zustand';
import {
  type AppSettings,
  type BleDevice,
  type BridgeStatus,
  type Channel,
  type Contact,
  DEFAULT_APP_SETTINGS,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_SYNC_PROGRESS,
  DEFAULT_UI_STATE,
  type LeftNavGroupId,
  type MapSettings,
  type Message,
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
  type ThemePref,
  type TileManifest,
  type TransportState,
  type UiState,
} from '../../shared/types';

const DEFAULT_MAP_MANIFEST: TileManifest = { missing: true, basemap: null, terrain: null };

const MAX_PACKETS = 500;

interface SearchFilters {
  kinds: ('channel' | 'dm')[];
  key?: string;
  /** Sender hex public key or the literal 'self' for owner-sent. */
  fromPk?: string;
  tsFrom?: number;
  tsTo?: number;
}

const DEFAULT_SEARCH_FILTERS: SearchFilters = { kinds: ['channel', 'dm'] };

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

  // Domain data (mirrored from main)
  owner: Owner | null;
  channels: Channel[];
  /** Channel keys the connected radio reports owning right now. Empty when
   *  disconnected. Drives the "grayed missing channel" rendering in LeftNav. */
  channelPresence: Set<string>;
  contacts: Contact[];
  // Keyed by `key` (channel or contact key). The renderer is a cache —
  // authoritative history lives in main once Phase 3 lands.
  messagesByKey: Record<string, Message[]>;

  // Settings
  appSettings: AppSettings;
  radioSettings: RadioSettings;
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

  // Transient
  busy: boolean;
  // ID of the message currently expanded in the right rail. Clears when the
  // active key changes (the selection has no meaning outside its conversation).
  selectedMessageId: string | null;
  // Cmd+K palette open state. Not persisted across reloads.
  paletteOpen: boolean;

  // Sidebar quick-filter / search panel state. Single source of truth — both
  // the LeftNav input and the SearchResults panel input bind to this so they
  // stay in sync as the user moves between them.
  searchQuery: string;
  searchFilters: SearchFilters;
  searchSort: SearchSort;
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
  applyChannels: (channels: Channel[]) => void;
  applyChannelPresence: (keys: string[]) => void;
  applyContacts: (contacts: Contact[]) => void;
  applyOwner: (owner: Owner | null) => void;
  applyAppSettings: (settings: AppSettings) => void;
  applyRadioSettings: (settings: RadioSettings) => void;
  applyMapSettings: (settings: MapSettings) => void;
  applyMapManifest: (manifest: TileManifest) => void;
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

  // UI mutators (also persisted to main via api.putUiState; see App.tsx)
  setActiveKey: (key: string) => void;
  setSelectedContact: (key: string | null) => void;
  toggleLeftNav: () => void;
  toggleRightRail: () => void;
  setRightWidth: (w: number) => void;
  setRailSection: (id: string, open: boolean) => void;
  setLeftNavGroup: (id: LeftNavGroupId, open: boolean) => void;
  setDraft: (key: string, text: string) => void;
  setPacketLogFilter: (patch: Partial<UiState['packetLogFilter']>) => void;
  setThemePref: (mode: ThemePref) => void;
  togglePin: (key: string) => void;
  setSelectedMessage: (id: string | null) => void;
  markRead: (key: string, ts: number) => void;
  markAllRead: (key: string) => void;
  markAllReadGlobal: () => void;
  clearPackets: () => void;
  openPalette: () => void;
  closePalette: () => void;

  setSearchQuery: (query: string) => void;
  setSearchFilters: (patch: Partial<SearchFilters>) => void;
  setSearchSort: (sort: SearchSort) => void;
  clearSearch: () => void;
  /** Set by a search-result click. ChannelView/DMView consume it (scroll +
   *  flash) and then call this with null to clear. */
  setPendingJump: (mid: string | null) => void;
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

  owner: null,
  channels: [],
  channelPresence: new Set<string>(),
  contacts: [],
  messagesByKey: {},

  appSettings: DEFAULT_APP_SETTINGS,
  radioSettings: DEFAULT_RADIO_SETTINGS,
  mapSettings: DEFAULT_MAP_SETTINGS,
  mapManifest: DEFAULT_MAP_MANIFEST,

  repeaterStatusByKey: {},
  repeaterTelemetryByKey: {},

  ui: DEFAULT_UI_STATE,

  busy: false,
  selectedMessageId: null,
  paletteOpen: false,

  searchQuery: '',
  searchFilters: DEFAULT_SEARCH_FILTERS,
  searchSort: 'recency',
  pendingJumpMid: null,

  hydrate: (snapshot) =>
    set(() => ({
      transportState: snapshot.transport.state,
      connectedDeviceId: snapshot.transport.deviceId,
      syncProgress: snapshot.syncProgress ?? DEFAULT_SYNC_PROGRESS,
      bridge: snapshot.bridge,
      owner: snapshot.owner,
      channels: snapshot.channels,
      channelPresence: new Set(snapshot.channelPresence ?? []),
      contacts: snapshot.contacts,
      messagesByKey: groupMessagesByKey(snapshot.messages),
      appSettings: snapshot.appSettings,
      radioSettings: snapshot.radioSettings,
      mapSettings: snapshot.mapSettings,
      mapManifest: snapshot.mapManifest,
      ui: snapshot.uiState,
      // Seed in-session sort from the persisted default so an existing user
      // preference takes effect immediately on launch.
      searchSort: snapshot.appSettings.search?.defaultSort ?? 'recency',
    })),

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

  applyChannels: (channels) => set(() => ({ channels })),
  applyChannelPresence: (keys) => set(() => ({ channelPresence: new Set(keys) })),
  applyContacts: (contacts) => set(() => ({ contacts })),
  applyOwner: (owner) => set(() => ({ owner })),
  applyAppSettings: (settings) => set(() => ({ appSettings: settings })),
  applyRadioSettings: (settings) => set(() => ({ radioSettings: settings })),
  applyMapSettings: (settings) => set(() => ({ mapSettings: settings })),
  applyMapManifest: (manifest) => set(() => ({ mapManifest: manifest })),
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

  setActiveKey: (key) =>
    set((s) => {
      // Recents are a most-recently-visited stack: the freshly-active key
      // moves to the front, duplicates are removed, and the list is capped.
      const recentKeys = [key, ...s.ui.recentKeys.filter((k) => k !== key)].slice(
        0,
        RECENT_KEYS_MAX,
      );
      return {
        ui: { ...s.ui, activeKey: key, selectedContactKey: null, recentKeys },
        selectedMessageId: null,
      };
    }),
  setSelectedContact: (key) => set((s) => ({ ui: { ...s.ui, selectedContactKey: key } })),
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

  setSearchQuery: (query) => set(() => ({ searchQuery: query })),
  setSearchFilters: (patch) => set((s) => ({ searchFilters: { ...s.searchFilters, ...patch } })),
  setSearchSort: (sort) => set(() => ({ searchSort: sort })),
  clearSearch: () =>
    set(() => ({
      searchQuery: '',
      searchFilters: DEFAULT_SEARCH_FILTERS,
    })),
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

// Useful narrow selectors for components.
export const selectIsConnected = (s: CoreState) => s.transportState === 'connected';
export const selectActiveMessages = (s: CoreState) => s.messagesByKey[s.ui.activeKey] ?? [];
