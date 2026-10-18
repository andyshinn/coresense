import {
  type BleDevice,
  type BridgeStatus,
  DEFAULT_SYNC_PROGRESS,
  type SyncProgress,
  type TransportState,
} from '../../../shared/types';
import type { CoreState, SliceCreator } from './coreState';

/** The radio link, the server's view of it, and window-level signals from main. */
export interface ConnectionSlice {
  // OS-level dark-mode signal pushed from main. Drives the resolved theme
  // (combined with ui.themePref) wherever app code wants to react to dark
  // mode — e.g. MapCanvas swapping basemap flavors.
  systemDark: boolean;

  // Authoritative window focus, pushed from main's BrowserWindow focus/blur.
  // Gates view-driven auto-mark-read (see MessageList) so messages arriving
  // while the app is backgrounded stay unread until the user looks at the app.
  windowFocused: boolean;

  // Connection
  transportState: TransportState;
  connectedDeviceId: string | undefined;
  syncProgress: SyncProgress;
  devices: BleDevice[];
  bridge: BridgeStatus | null;
  wsClients: number;

  // Transient
  busy: boolean;

  applyTransportState: (state: TransportState, deviceId?: string) => void;
  applySyncProgress: (progress: SyncProgress) => void;
  applyDevices: (devices: BleDevice[]) => void;
  applyBridge: (bridge: BridgeStatus) => void;
  setBusy: (b: boolean) => void;
  setSystemDark: (dark: boolean) => void;
  applyWindowFocus: (focused: boolean) => void;
  setWsClients: (n: number) => void;
}

export const createConnectionSlice: SliceCreator<ConnectionSlice> = (set) => ({
  systemDark:
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false,
  // Assume focused at startup; the connect-time windowFocus frame corrects it.
  windowFocused: true,
  transportState: 'idle',
  connectedDeviceId: undefined,
  syncProgress: DEFAULT_SYNC_PROGRESS,
  devices: [],
  bridge: null,
  wsClients: 0,
  busy: false,

  applyTransportState: (state, deviceId) => set(() => ({ transportState: state, connectedDeviceId: deviceId })),
  applySyncProgress: (progress) => set(() => ({ syncProgress: progress })),
  applyDevices: (devices) => set(() => ({ devices })),
  applyBridge: (bridge) => set(() => ({ bridge })),
  setBusy: (b) => set(() => ({ busy: b })),
  setSystemDark: (dark) => set(() => ({ systemDark: dark })),
  applyWindowFocus: (focused) => set(() => ({ windowFocused: focused })),
  setWsClients: (n) => set(() => ({ wsClients: n })),
});

export const selectIsConnected = (s: CoreState) => s.transportState === 'connected';
