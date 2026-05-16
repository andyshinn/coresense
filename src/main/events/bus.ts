import { EventEmitter } from 'node:events';
import type {
  AppSettings,
  BleDevice,
  Channel,
  Contact,
  MenuAction,
  Message,
  MessageState,
  Owner,
  PathLearnedEvent,
  RadioSettings,
  RawPacket,
  RepeaterStatusSnapshot,
  RepeaterTelemetrySnapshot,
  SyncProgress,
  ThemePush,
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
  messages: (key: string, messages: Message[]) => bus.emit('messages', key, messages),
  messageState: (id: string, state: MessageState) => bus.emit('messageState', id, state),
  owner: (owner: Owner | null) => bus.emit('owner', owner),
  appSettings: (settings: AppSettings) => bus.emit('appSettings', settings),
  radioSettings: (settings: RadioSettings) => bus.emit('radioSettings', settings),
  repeaterStatus: (snap: RepeaterStatusSnapshot) => bus.emit('repeaterStatus', snap),
  repeaterTelemetry: (snap: RepeaterTelemetrySnapshot) => bus.emit('repeaterTelemetry', snap),
  pathLearned: (event: PathLearnedEvent) => bus.emit('pathLearned', event),
  uiState: (state: UiState) => bus.emit('uiState', state),
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
  messages: (key: string, messages: Message[]) => void;
  messageState: (id: string, state: MessageState) => void;
  owner: (owner: Owner | null) => void;
  appSettings: (settings: AppSettings) => void;
  radioSettings: (settings: RadioSettings) => void;
  repeaterStatus: (snap: RepeaterStatusSnapshot) => void;
  repeaterTelemetry: (snap: RepeaterTelemetrySnapshot) => void;
  pathLearned: (event: PathLearnedEvent) => void;
  uiState: (state: UiState) => void;
};
