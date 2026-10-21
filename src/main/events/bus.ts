import { EventEmitter } from 'node:events';
import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type { TelemetryDeletedPayload, TelemetryInFlightPayload, TelemetrySavedPayload } from '../../shared/telemetry/types';
import type {
  AppSettings,
  AutoAddConfig,
  BleDevice,
  BlockRule,
  Channel,
  Contact,
  ContactKind,
  DeviceCapabilities,
  DeviceIdentity,
  DeviceInfo,
  GpsConfig,
  LogEntry,
  MacroTemplate,
  MapSettings,
  MapTileStatus,
  MenuAction,
  Message,
  MessagePath,
  MessageState,
  NodeCache,
  Owner,
  PathLearnedEvent,
  RadioLimits,
  RadioSettings,
  RawPacket,
  RepeaterStatusSnapshot,
  SyncProgress,
  TelemetryPolicy,
  ThemePush,
  TileManifest,
  TransportState,
  UiState,
  UpdateState,
} from '../../shared/types';

/** Outcome of one GET_CONTACTS iteration: what the radio said it delivered vs
 *  what we actually persisted. The contact broadcasts are coalesced, so their
 *  count no longer tracks the number of contacts — this is the signal that
 *  answers "did everything land?". */
export interface ContactSyncSummary {
  /** RESP_CONTACT records the radio delivered in this iteration. */
  delivered: number;
  /** Contacts in the holder once the iteration settled. */
  stored: number;
  /** Discovered-pool rows currently marked on-radio. */
  onRadio: number;
  /** False when we persisted fewer contacts than the radio delivered. */
  complete: boolean;
}

/** Build a sync summary, deciding whether everything the radio sent landed.
 *
 *  `stored` can legitimately EXCEED `delivered` — a placeholder contact
 *  synthesised for an incoming DM from an unknown sender is in the holder
 *  without the radio having delivered it — so only a shortfall counts as
 *  incomplete. */
export function summarizeContactSync(delivered: number, stored: number, onRadio: number): ContactSyncSummary {
  return { delivered, stored, onRadio, complete: stored >= delivered };
}

/** Every bus event and its listener arguments. `bus` is typed against it (see
 *  `TypedBus`), so neither a misspelled event name nor a listener that drifts
 *  from what the emitter sends compiles. */
export type BusEventMap = {
  packet: [p: RawPacket];
  transportState: [state: TransportState, deviceId?: string];
  scanResults: [devices: BleDevice[]];
  errorMessage: [message: string];
  menuAction: [action: MenuAction];
  theme: [push: ThemePush];
  channels: [channels: Channel[]];
  channelPresence: [keys: string[]];
  syncProgress: [progress: SyncProgress];
  contacts: [contacts: Contact[]];
  discovered: [rows: DiscoveredContact[]];
  contactEvicted: [name: string];
  contactSyncSummary: [summary: ContactSyncSummary];
  contactDiscovered: [contact: { key: string; name: string; kind: ContactKind }];
  messages: [key: string, messages: Message[]];
  messageState: [id: string, state: MessageState];
  messagePathHeard: [payload: { id: string; path: MessagePath; state: MessageState }];
  messagesDeleted: [payload: { key: string; ids: string[] }];
  owner: [owner: Owner | null];
  appSettings: [settings: AppSettings];
  radioSettings: [settings: RadioSettings];
  mapSettings: [settings: MapSettings];
  mapManifest: [manifest: TileManifest];
  mapTileStatus: [status: MapTileStatus];
  repeaterStatus: [snap: RepeaterStatusSnapshot];
  telemetrySaved: [payload: TelemetrySavedPayload];
  telemetryDeleted: [payload: TelemetryDeletedPayload];
  telemetryInFlight: [payload: TelemetryInFlightPayload];
  pathLearned: [event: PathLearnedEvent];
  uiState: [state: UiState];
  windowFocus: [focused: boolean];
  deviceIdentity: [identity: DeviceIdentity];
  autoAddConfig: [cfg: AutoAddConfig];
  telemetryPolicy: [policy: TelemetryPolicy];
  gpsConfig: [cfg: GpsConfig];
  deviceInfo: [info: DeviceInfo];
  deviceCapabilities: [caps: DeviceCapabilities];
  radioLimits: [limits: RadioLimits];
  nodeCache: [cache: NodeCache];
  blockRules: [rules: BlockRule[]];
  macros: [macros: MacroTemplate[]];
  'log:entry': [entry: LogEntry];
  updateState: [state: UpdateState];
};

type BusEvent = keyof BusEventMap;

/** The slice of EventEmitter the app uses, keyed strictly by `BusEventMap`.
 *  @types/node's typed `EventEmitter<T>` still accepts ANY string as an event
 *  name (`bus.on('contactEvicted ', …)` compiles and silently never fires), so
 *  `bus` is exported through this narrower view instead. */
export interface TypedBus {
  on<K extends BusEvent>(event: K, listener: (...args: BusEventMap[K]) => void): this;
  once<K extends BusEvent>(event: K, listener: (...args: BusEventMap[K]) => void): this;
  off<K extends BusEvent>(event: K, listener: (...args: BusEventMap[K]) => void): this;
  emit<K extends BusEvent>(event: K, ...args: BusEventMap[K]): boolean;
  removeAllListeners(event?: BusEvent): this;
  listenerCount(event: BusEvent): number;
  eventNames(): BusEvent[];
}

// The cast only bridges @types/node's conditional listener types, which can't
// resolve against an unbound K; at runtime this IS the EventEmitter.
export const bus = new EventEmitter<BusEventMap>() as unknown as TypedBus;

/** A named emitter for one bus event, typed by the map. It looks `bus.emit` up
 *  on every call (not bound once) so a later spy or patch on it still sees
 *  these emits. */
const emitter =
  <K extends BusEvent>(event: K) =>
  (...args: BusEventMap[K]): boolean =>
    bus.emit(event, ...args);

// Note: avoid Node EventEmitter's reserved 'error' event — it throws when
// emitted with no listeners, and listeners can come and go across shutdown.
export const emit = {
  packet: emitter('packet'),
  transportState: emitter('transportState'),
  scanResults: emitter('scanResults'),
  error: emitter('errorMessage'),
  menuAction: emitter('menuAction'),
  theme: emitter('theme'),
  channels: emitter('channels'),
  channelPresence: emitter('channelPresence'),
  syncProgress: emitter('syncProgress'),
  contacts: emitter('contacts'),
  discovered: emitter('discovered'),
  contactEvicted: emitter('contactEvicted'),
  contactSyncSummary: emitter('contactSyncSummary'),
  contactDiscovered: emitter('contactDiscovered'),
  messages: emitter('messages'),
  messageState: emitter('messageState'),
  messagePathHeard: emitter('messagePathHeard'),
  messagesDeleted: emitter('messagesDeleted'),
  owner: emitter('owner'),
  appSettings: emitter('appSettings'),
  radioSettings: emitter('radioSettings'),
  mapSettings: emitter('mapSettings'),
  mapManifest: emitter('mapManifest'),
  mapTileStatus: emitter('mapTileStatus'),
  repeaterStatus: emitter('repeaterStatus'),
  telemetrySaved: emitter('telemetrySaved'),
  telemetryDeleted: emitter('telemetryDeleted'),
  telemetryInFlight: emitter('telemetryInFlight'),
  pathLearned: emitter('pathLearned'),
  uiState: emitter('uiState'),
  windowFocus: emitter('windowFocus'),
  deviceIdentity: emitter('deviceIdentity'),
  autoAddConfig: emitter('autoAddConfig'),
  telemetryPolicy: emitter('telemetryPolicy'),
  gpsConfig: emitter('gpsConfig'),
  deviceInfo: emitter('deviceInfo'),
  deviceCapabilities: emitter('deviceCapabilities'),
  radioLimits: emitter('radioLimits'),
  nodeCache: emitter('nodeCache'),
  blockRules: emitter('blockRules'),
  macros: emitter('macros'),
  logEntry: emitter('log:entry'),
  updateState: emitter('updateState'),
};
