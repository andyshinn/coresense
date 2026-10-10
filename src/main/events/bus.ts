import { EventEmitter } from 'node:events';
import type { DiscoveredContact } from '../../shared/contacts/discovered';
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

/** Every bus event and its listener arguments. `bus.on`/`off`/`emit` are
 *  checked against it, so a listener can't drift from what the emitter sends. */
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
  repeaterTelemetry: [snap: RepeaterTelemetrySnapshot];
  pathLearned: [event: PathLearnedEvent];
  uiState: [state: UiState];
  windowFocus: [focused: boolean];
  deviceIdentity: [identity: DeviceIdentity];
  autoAddConfig: [cfg: AutoAddConfig];
  telemetryPolicy: [policy: TelemetryPolicy];
  gpsConfig: [cfg: GpsConfig];
  deviceInfo: [info: DeviceInfo];
  deviceCapabilities: [caps: DeviceCapabilities];
  blockRules: [rules: BlockRule[]];
  macros: [macros: MacroTemplate[]];
  'log:entry': [entry: LogEntry];
  updateState: [state: UpdateState];
};

export const bus = new EventEmitter<BusEventMap>();

/** A named emitter for one bus event, typed by the map. It emits through an
 *  unparameterised view of `bus` only because @types/node's conditional Args<>
 *  can't resolve an unbound K; the returned function's own signature is what
 *  every caller is checked against. */
const emitter = <K extends keyof BusEventMap>(event: K) => {
  const emitRaw: (event: string, ...args: unknown[]) => boolean = bus.emit.bind(bus);
  return (...args: BusEventMap[K]): boolean => emitRaw(event, ...args);
};

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
  repeaterTelemetry: emitter('repeaterTelemetry'),
  pathLearned: emitter('pathLearned'),
  uiState: emitter('uiState'),
  windowFocus: emitter('windowFocus'),
  deviceIdentity: emitter('deviceIdentity'),
  autoAddConfig: emitter('autoAddConfig'),
  telemetryPolicy: emitter('telemetryPolicy'),
  gpsConfig: emitter('gpsConfig'),
  deviceInfo: emitter('deviceInfo'),
  deviceCapabilities: emitter('deviceCapabilities'),
  blockRules: emitter('blockRules'),
  macros: emitter('macros'),
  logEntry: emitter('log:entry'),
  updateState: emitter('updateState'),
};
