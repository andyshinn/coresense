// The app shell: transport and bridge status, the capabilities handshake, the preload bridge, updates and logs.

import type { LogLevel } from '../logLevels';

export type TransportState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface BleDevice {
  id: string;
  name: string | null;
  rssi: number;
}

// Default TCP ports for the bridge listener. Dev and prod use different ports
// so a developer can run an installed build alongside `pnpm start` without
// fighting over the same port. The values are also the seed for
// DEFAULT_APP_SETTINGS.proxy.port — first-run only; user edits take over.
//
// Every port CoreSense claims is even and at least 2 clear of the next, so no
// default can collide with another (issue #21): HTTP 7654 / bridge 7656 for an
// installed build, HTTP 7754 / bridge 7756 for dev. Nothing probes or walks —
// see src/main/http-port.ts.
export const BRIDGE_DEFAULT_TCP_PORT = 7656;

export const BRIDGE_DEFAULT_TCP_PORT_DEV = 7756;

export interface BridgeStatus {
  tcpPort: number | null;
  bindAddress: string;
  lanAddress: string | null;
  tcpClients: number;
  mdnsServiceName: string | null;
  radioConnected: boolean;
  /** Why the TCP listener is not running, when the configured port is one the
   *  app cannot give it (see shared/ports.ts). Null in the normal case. This
   *  rides along in the status snapshot so the reason survives until the
   *  renderer connects — a boot-time toast would be emitted before any client
   *  is listening. */
  portConflict: string | null;
}

export interface LogEntry {
  id: string; // monotonically increasing, used as virtuoso key
  ts: number; // epoch ms
  level: LogLevel;
  levelId: number; // tslog numeric level (0..6)
  source: 'main' | 'renderer';
  logger: string; // tslog name / sub-logger name (e.g. 'coresense.ble')
  message: string; // pre-rendered single string
  args?: unknown[]; // structured extras (JSON-serializable), optional
}

export type UpdateChannel = 'stable' | 'development';

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  /** Which mechanism applies right now, from (platform, channel). */
  mode: 'silent' | 'notify';
  channel: UpdateChannel;
  currentVersion: string;
  latestVersion?: string;
  /** Notify path only: the GitHub release page to open. */
  releaseUrl?: string;
  lastCheckedAt?: number;
  error?: string;
}

export interface ThemePush {
  systemDark: boolean;
}

export interface Capabilities {
  isElectron: boolean;
  version: string;
  /** Abbreviated git SHA (7 chars) of the build, or `"unknown"` when the
   *  build wasn't from a git checkout (e.g. tarball). Injected by
   *  unplugin-info at main-process build time. */
  gitSha: string;
  /** `process.versions.electron` of the running main process. */
  electronVersion: string;
  /** `process.versions.chrome` (Chromium version) of the running window. */
  chromeVersion: string;
  platform: string;
  httpPort: number;
  /** Absolute path of the config.json that holds the shared API key. Surfaced
   *  so browser clients can be told exactly where to read the key, and the
   *  in-app API Access settings section can show it. */
  configPath: string;
  /** Absolute path to the userData/logs folder. */
  logsFolder: string;
  /** Absolute path to today's log file. */
  logsCurrentFile: string;
}

/** Shape of `window.coresense`, injected by the Electron preload script.
 *  Present only in the bundled desktop window — a plain browser never has it,
 *  which is how the renderer tells "official app window" from "any browser". */
export interface CoreSenseBridge {
  /** The shared API key, handed to the first-party window so it skips the
   *  manual paste gate. */
  apiKey: string;
  /** The port the local Hono server bound to. Lets the renderer skip the
   *  capabilities probe and avoid the dev/prod port-default mismatch. null when
   *  main had no server to report (e.g. mid-shutdown). */
  httpPort: number | null;
  /** Open the logs folder in the OS file manager. */
  revealLogs: () => void;
}

export interface ServerStatus {
  port: number;
  wsClients: number;
  transport: TransportState;
  deviceId?: string;
  bridge: BridgeStatus;
}
