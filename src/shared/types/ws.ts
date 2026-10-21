// The websocket protocol: the hydration snapshot, push messages and menu actions.

import type { MacroTemplate } from '../macros/types';
import type {
  TelemetryDeletedPayload,
  TelemetryInFlight,
  TelemetryInFlightPayload,
  TelemetrySavedPayload,
} from '../telemetry/types';
import type {
  BlockRule,
  Channel,
  Contact,
  DiscoveredContact,
  Message,
  MessagePath,
  MessageState,
  Owner,
  PathLearnedEvent,
  RawPacket,
  SyncProgress,
} from './domain';
import type { MapSettings, MapTileStatus, TileManifest } from './map';
import type { NodeCache } from './node';
import type { BleDevice, BridgeStatus, Capabilities, LogEntry, ThemePush, TransportState, UpdateState } from './platform';
import type { RepeaterStatusSnapshot } from './repeater';
import type {
  AppSettings,
  AutoAddConfig,
  DeviceCapabilities,
  DeviceIdentity,
  DeviceInfo,
  GpsConfig,
  RadioLimits,
  RadioSettings,
  TelemetryPolicy,
} from './settings';
import type { UiState, UiStateUpdate } from './ui';

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
  /** Runtime online-tile status (key configured / key rejected). */
  mapTileStatus: MapTileStatus;
  uiState: UiState;
  /** Per-conversation composer drafts, keyed by channel/contact key. A sibling
   *  of uiState rather than a field inside it: drafts change on every keystroke,
   *  and folding them into UiState drags every ui consumer onto that path (and
   *  every draft onto the uiState WS broadcast). Persisted to drafts.json. */
  drafts: Record<string, string>;
  deviceIdentity: DeviceIdentity;
  autoAddConfig: AutoAddConfig;
  telemetryPolicy: TelemetryPolicy;
  gpsConfig: GpsConfig;
  deviceInfo: DeviceInfo;
  deviceCapabilities: DeviceCapabilities;
  /** The connected radio's TX power range. Optional so a renderer hydrating
   *  from an older main reads it as unknown. */
  radioLimits?: RadioLimits;
  /** Last-known state per connected radio, for My Node while disconnected.
   *  Optional so a renderer hydrating from an older main reads it as empty. */
  nodeCache?: NodeCache;
  blockRules: BlockRule[];
  macros: MacroTemplate[];
  /** Newest persisted packets (min(liveBufferSize, storedHistorySize)), oldest→newest. */
  packets: RawPacket[];
  /** Pending telemetry requests, the same snapshot `telemetryInFlight` pushes.
   *  Optional so a renderer hydrating from an older main reads it as empty. */
  telemetryInFlight?: TelemetryInFlight[];
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
  // Notification click → open a conversation and scroll to a specific message.
  | { kind: 'focusMessage'; key: string; messageId: string }
  // Summary-notification click → open a conversation at its first unread message.
  | { kind: 'focusFirstUnread'; key: string }
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
  | { type: 'messagesDeleted'; payload: { key: string; ids: string[] } }
  | { type: 'owner'; payload: Owner | null }
  | { type: 'appSettings'; payload: AppSettings }
  | { type: 'radioSettings'; payload: RadioSettings }
  | { type: 'mapSettings'; payload: MapSettings }
  | { type: 'mapManifest'; payload: TileManifest }
  | { type: 'mapTileStatus'; payload: MapTileStatus }
  | { type: 'repeaterStatus'; payload: RepeaterStatusSnapshot }
  // Saved telemetry requests (shared/telemetry). `telemetrySaved` carries the
  // decoded DTO, so the rail and open tabs update without a refetch;
  // `telemetryInFlight` is a full snapshot of pending requests every time.
  | { type: 'telemetrySaved'; payload: TelemetrySavedPayload }
  | { type: 'telemetryDeleted'; payload: TelemetryDeletedPayload }
  | { type: 'telemetryInFlight'; payload: TelemetryInFlightPayload }
  | { type: 'pathLearned'; payload: PathLearnedEvent }
  | { type: 'deviceIdentity'; payload: DeviceIdentity }
  | { type: 'autoAddConfig'; payload: AutoAddConfig }
  | { type: 'telemetryPolicy'; payload: TelemetryPolicy }
  | { type: 'gpsConfig'; payload: GpsConfig }
  | { type: 'deviceInfo'; payload: DeviceInfo }
  | { type: 'deviceCapabilities'; payload: DeviceCapabilities }
  | { type: 'radioLimits'; payload: RadioLimits }
  | { type: 'nodeCache'; payload: NodeCache }
  | { type: 'uiState'; payload: UiStateUpdate }
  // Authoritative window focus, sourced from BrowserWindow focus/blur events in
  // main. The renderer gates view-driven auto-mark-read on this so messages
  // arriving while the window is backgrounded stay unread (and their
  // notifications stay standing) until the user actually looks at the app.
  | { type: 'windowFocus'; payload: { focused: boolean } }
  | { type: 'wsClients'; payload: { count: number } }
  | { type: 'blockRules'; payload: BlockRule[] }
  | { type: 'macros'; payload: MacroTemplate[] }
  | { type: 'log'; payload: LogEntry }
  | { type: 'log:snapshot'; payload: LogEntry[] }
  | { type: 'updateState'; payload: UpdateState };
