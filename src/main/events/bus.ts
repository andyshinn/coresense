import { EventEmitter } from 'node:events';
import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type {
  AppSettings,
  AutoAddConfig,
  BleDevice,
  BlockRule,
  Channel,
  Contact,
  DeviceCapabilities,
  DeviceIdentity,
  DeviceInfo,
  GpsConfig,
  LogEntry,
  MapSettings,
  MenuAction,
  Message,
  MessagePath,
  MessageState,
  Owner,
  PathLearnedEvent,
  RadioSettings,
  RawPacket,
  RepeaterStatusSnapshot,
  RepeaterTelemetrySnapshot,
  SyncProgress,
  TelemetryPolicy,
  ThemePush,
  TileManifest,
  TransportState,
  UiState,
} from '../../shared/types';

export const bus = new EventEmitter();

// Note: avoid Node EventEmitter's reserved 'error' event — it throws when
// emitted with no listeners, and listeners can come and go across shutdown.
export const emit = {
  packet: (p: RawPacket) => bus.emit('packet', p),
  transportState: (s: TransportState, id?: string) => bus.emit('transportState', s, id),
  scanResults: (devices: BleDevice[]) => bus.emit('scanResults', devices),
  error: (message: string) => bus.emit('errorMessage', message),
  menuAction: (action: MenuAction) => bus.emit('menuAction', action),
  theme: (push: ThemePush) => bus.emit('theme', push),
  channels: (channels: Channel[]) => bus.emit('channels', channels),
  channelPresence: (keys: string[]) => bus.emit('channelPresence', keys),
  syncProgress: (progress: SyncProgress) => bus.emit('syncProgress', progress),
  contacts: (contacts: Contact[]) => bus.emit('contacts', contacts),
  discovered: (rows: DiscoveredContact[]) => bus.emit('discovered', rows),
  contactEvicted: (name: string) => bus.emit('contactEvicted', name),
  messages: (key: string, messages: Message[]) => bus.emit('messages', key, messages),
  messageState: (id: string, state: MessageState) => bus.emit('messageState', id, state),
  messagePathHeard: (payload: { id: string; path: MessagePath; state: MessageState }) =>
    bus.emit('messagePathHeard', payload),
  owner: (owner: Owner | null) => bus.emit('owner', owner),
  appSettings: (settings: AppSettings) => bus.emit('appSettings', settings),
  radioSettings: (settings: RadioSettings) => bus.emit('radioSettings', settings),
  mapSettings: (settings: MapSettings) => bus.emit('mapSettings', settings),
  mapManifest: (manifest: TileManifest) => bus.emit('mapManifest', manifest),
  repeaterStatus: (snap: RepeaterStatusSnapshot) => bus.emit('repeaterStatus', snap),
  repeaterTelemetry: (snap: RepeaterTelemetrySnapshot) => bus.emit('repeaterTelemetry', snap),
  pathLearned: (event: PathLearnedEvent) => bus.emit('pathLearned', event),
  uiState: (state: UiState) => bus.emit('uiState', state),
  deviceIdentity: (identity: DeviceIdentity) => bus.emit('deviceIdentity', identity),
  autoAddConfig: (cfg: AutoAddConfig) => bus.emit('autoAddConfig', cfg),
  telemetryPolicy: (policy: TelemetryPolicy) => bus.emit('telemetryPolicy', policy),
  gpsConfig: (cfg: GpsConfig) => bus.emit('gpsConfig', cfg),
  deviceInfo: (info: DeviceInfo) => bus.emit('deviceInfo', info),
  deviceCapabilities: (caps: DeviceCapabilities) => bus.emit('deviceCapabilities', caps),
  blockRules: (rules: BlockRule[]) => bus.emit('blockRules', rules),
  logEntry: (entry: LogEntry) => bus.emit('log:entry', entry),
};

export type BusEvents = {
  packet: (p: RawPacket) => void;
  transportState: (s: TransportState, id?: string) => void;
  scanResults: (devices: BleDevice[]) => void;
  errorMessage: (message: string) => void;
  menuAction: (action: MenuAction) => void;
  theme: (push: ThemePush) => void;
  channels: (channels: Channel[]) => void;
  channelPresence: (keys: string[]) => void;
  syncProgress: (progress: SyncProgress) => void;
  contacts: (contacts: Contact[]) => void;
  discovered: (rows: DiscoveredContact[]) => void;
  contactEvicted: (name: string) => void;
  messages: (key: string, messages: Message[]) => void;
  messageState: (id: string, state: MessageState) => void;
  messagePathHeard: (payload: { id: string; path: MessagePath; state: MessageState }) => void;
  owner: (owner: Owner | null) => void;
  appSettings: (settings: AppSettings) => void;
  radioSettings: (settings: RadioSettings) => void;
  mapSettings: (settings: MapSettings) => void;
  mapManifest: (manifest: TileManifest) => void;
  repeaterStatus: (snap: RepeaterStatusSnapshot) => void;
  repeaterTelemetry: (snap: RepeaterTelemetrySnapshot) => void;
  pathLearned: (event: PathLearnedEvent) => void;
  uiState: (state: UiState) => void;
  deviceIdentity: (identity: DeviceIdentity) => void;
  autoAddConfig: (cfg: AutoAddConfig) => void;
  telemetryPolicy: (policy: TelemetryPolicy) => void;
  gpsConfig: (cfg: GpsConfig) => void;
  deviceInfo: (info: DeviceInfo) => void;
  deviceCapabilities: (caps: DeviceCapabilities) => void;
  blockRules: (rules: BlockRule[]) => void;
  'log:entry': (entry: LogEntry) => void;
};
