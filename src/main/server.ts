import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type WebSocket, WebSocketServer } from 'ws';
import type { DiscoveredContact } from '../shared/contacts/discovered';
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
  WsMessage,
} from '../shared/types';
import { apiKeyAuth, checkWsKey } from './api/middleware/auth';
import { createRoutes } from './api/routes';
import type { BridgeHandle } from './bridge';
import { bus } from './events/bus';
import { getLogBuffer } from './log';
import { stateHolder } from './state/holder';
import { discoveredStore } from './storage/discoveredContacts';
import { transportManager } from './transport/manager';
import { currentUpdateState } from './updates/controller';
import { isMainWindowFocused } from './window/registry';

const DEFAULT_PORT_PROD = 7654;
const DEFAULT_PORT_DEV = 7754;
const MAX_PORT_PROBES = 50;

interface StartServerResult {
  port: number;
  close: () => Promise<void>;
}

interface StartServerOptions {
  dev?: boolean;
  bindAddress?: string;
}

export async function startServer(
  rendererDir: string | null,
  bridge: BridgeHandle,
  opts: StartServerOptions = {},
): Promise<StartServerResult> {
  const defaultPort = opts.dev ? DEFAULT_PORT_DEV : DEFAULT_PORT_PROD;
  const bindAddress = opts.bindAddress ?? '127.0.0.1';
  const app = new Hono();
  const clients = new Set<WebSocket>();

  // The renderer is served from Vite's dev server (a different origin) during
  // development, and any external browser client lives on a different origin too.
  // The API is API-key authenticated, so allow any origin.
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      credentials: false,
      maxAge: 600,
    }),
  );
  app.use('/api/*', apiKeyAuth);
  app.route(
    '/',
    createRoutes({
      port: () => boundPort,
      wsClients: () => clients.size,
      bridgeStatus: () => bridge.getStatus(),
    }),
  );

  if (rendererDir) {
    // Preload index.html once at startup; the production bundle is immutable.
    const indexHtml = await readFile(join(rendererDir, 'index.html'), 'utf8');
    const normalizedRoot = normalize(rendererDir);
    app.get('/', (c) => c.html(indexHtml));
    app.get('/*', async (c) => {
      const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
      const filePath = normalize(join(rendererDir, reqPath));
      if (!filePath.startsWith(normalizedRoot)) {
        return c.json({ error: 'Forbidden' }, 403);
      }
      try {
        const s = await stat(filePath);
        if (!s.isFile()) throw new Error('not a file');
      } catch {
        if (extname(c.req.path) === '') return c.html(indexHtml);
        return c.json({ error: 'Not found' }, 404);
      }
      const body = await readFile(filePath);
      return c.body(body, 200, { 'Content-Type': mimeFor(extname(filePath)) });
    });
  }

  let boundPort = defaultPort;
  const httpServer = await listenWithFallback(app.fetch, defaultPort, bindAddress, (p) => {
    boundPort = p;
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!checkWsKey(url.searchParams.get('key'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  const broadcast = (msg: WsMessage) => {
    const data = JSON.stringify(msg);
    for (const c of clients) {
      if (c.readyState === c.OPEN) c.send(data);
    }
  };
  const broadcastClientCount = () => broadcast({ type: 'wsClients', payload: { count: clients.size } });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    clients.add(ws);
    const initialState: WsMessage = {
      type: 'transportState',
      payload: transportManager.getState(),
    };
    ws.send(JSON.stringify(initialState));
    const initialBridge: WsMessage = {
      type: 'bridgeStatus',
      payload: bridge.getStatus(),
    };
    ws.send(JSON.stringify(initialBridge));
    ws.send(JSON.stringify({ type: 'wsClients', payload: { count: clients.size } } as WsMessage));
    const logSnapshotMsg: WsMessage = {
      type: 'log:snapshot',
      payload: [...getLogBuffer()],
    };
    ws.send(JSON.stringify(logSnapshotMsg));
    const holder = stateHolder();
    ws.send(
      JSON.stringify({
        type: 'discovered',
        payload: discoveredStore.list(holder.getBlockRules()),
      }),
    );
    ws.send(JSON.stringify({ type: 'updateState', payload: currentUpdateState() } satisfies WsMessage));
    ws.send(JSON.stringify({ type: 'windowFocus', payload: { focused: isMainWindowFocused() } } satisfies WsMessage));
    // Other clients should learn that the population just grew/shrank too.
    broadcastClientCount();
    const drop = () => {
      if (clients.delete(ws)) broadcastClientCount();
    };
    ws.on('close', drop);
    ws.on('error', drop);
  });

  const onPacket = (p: RawPacket) => broadcast({ type: 'packet', payload: p });
  const onTransportState = (state: TransportState, deviceId?: string) => {
    transportManager.setState(state, deviceId);
    broadcast({ type: 'transportState', payload: { state, deviceId } });
  };
  const onScanResults = (devices: BleDevice[]) => broadcast({ type: 'scanResults', payload: devices });
  const onError = (message: string) => broadcast({ type: 'error', payload: { message } });
  const onBridgeStatus = () => broadcast({ type: 'bridgeStatus', payload: bridge.getStatus() });
  const onMenuAction = (action: MenuAction) => broadcast({ type: 'menuAction', payload: action });
  const onTheme = (push: ThemePush) => broadcast({ type: 'theme', payload: push });
  const onChannels = (channels: Channel[]) => broadcast({ type: 'channels', payload: channels });
  const onChannelPresence = (keys: string[]) => broadcast({ type: 'channelPresence', payload: { keys } });
  const onSyncProgress = (progress: SyncProgress) => broadcast({ type: 'syncProgress', payload: progress });
  const onContacts = (contacts: Contact[]) => broadcast({ type: 'contacts', payload: contacts });
  const onDiscovered = (rows: DiscoveredContact[]) => broadcast({ type: 'discovered', payload: rows });
  const onContactEvicted = (name: string) => broadcast({ type: 'contactEvicted', payload: { name } });
  const onMessages = (key: string, messages: Message[]) => broadcast({ type: 'messages', payload: { key, messages } });
  const onMessageState = (id: string, state: MessageState) => broadcast({ type: 'messageState', payload: { id, state } });
  const onMessagePathHeard = (payload: { id: string; path: MessagePath; state: MessageState }) =>
    broadcast({ type: 'messagePathHeard', payload });
  const onOwner = (owner: Owner | null) => broadcast({ type: 'owner', payload: owner });
  const onAppSettings = (settings: AppSettings) => broadcast({ type: 'appSettings', payload: settings });
  const onRadioSettings = (settings: RadioSettings) => broadcast({ type: 'radioSettings', payload: settings });
  const onMapSettings = (settings: MapSettings) => broadcast({ type: 'mapSettings', payload: settings });
  const onMapManifest = (manifest: TileManifest) => broadcast({ type: 'mapManifest', payload: manifest });
  const onMapTileStatus = (status: MapTileStatus) => broadcast({ type: 'mapTileStatus', payload: status });
  const onRepeaterStatus = (snap: RepeaterStatusSnapshot) => broadcast({ type: 'repeaterStatus', payload: snap });
  const onRepeaterTelemetry = (snap: RepeaterTelemetrySnapshot) => broadcast({ type: 'repeaterTelemetry', payload: snap });
  const onPathLearned = (event: PathLearnedEvent) => broadcast({ type: 'pathLearned', payload: event });
  const onDeviceIdentity = (identity: DeviceIdentity) => broadcast({ type: 'deviceIdentity', payload: identity });
  const onAutoAddConfig = (cfg: AutoAddConfig) => broadcast({ type: 'autoAddConfig', payload: cfg });
  const onTelemetryPolicy = (policy: TelemetryPolicy) => broadcast({ type: 'telemetryPolicy', payload: policy });
  const onGpsConfig = (cfg: GpsConfig) => broadcast({ type: 'gpsConfig', payload: cfg });
  const onDeviceInfo = (info: DeviceInfo) => broadcast({ type: 'deviceInfo', payload: info });
  const onDeviceCapabilities = (caps: DeviceCapabilities) => broadcast({ type: 'deviceCapabilities', payload: caps });
  const onBlockRules = (rules: BlockRule[]) => broadcast({ type: 'blockRules', payload: rules });
  const onUiState = (state: UiState) => broadcast({ type: 'uiState', payload: state });
  const onWindowFocus = (focused: boolean) => broadcast({ type: 'windowFocus', payload: { focused } });
  const onUpdateState = (state: UpdateState) => broadcast({ type: 'updateState', payload: state });
  const onLogEntry = (entry: LogEntry) => broadcast({ type: 'log', payload: entry });

  bus.on('packet', onPacket);
  bus.on('transportState', onTransportState);
  bus.on('scanResults', onScanResults);
  bus.on('errorMessage', onError);
  bus.on('menuAction', onMenuAction);
  bus.on('theme', onTheme);
  bus.on('channels', onChannels);
  bus.on('channelPresence', onChannelPresence);
  bus.on('syncProgress', onSyncProgress);
  bus.on('contacts', onContacts);
  bus.on('discovered', onDiscovered);
  bus.on('contactEvicted', onContactEvicted);
  bus.on('messages', onMessages);
  bus.on('messageState', onMessageState);
  bus.on('messagePathHeard', onMessagePathHeard);
  bus.on('owner', onOwner);
  bus.on('appSettings', onAppSettings);
  bus.on('radioSettings', onRadioSettings);
  bus.on('mapSettings', onMapSettings);
  bus.on('mapManifest', onMapManifest);
  bus.on('mapTileStatus', onMapTileStatus);
  bus.on('repeaterStatus', onRepeaterStatus);
  bus.on('repeaterTelemetry', onRepeaterTelemetry);
  bus.on('pathLearned', onPathLearned);
  bus.on('deviceIdentity', onDeviceIdentity);
  bus.on('autoAddConfig', onAutoAddConfig);
  bus.on('telemetryPolicy', onTelemetryPolicy);
  bus.on('gpsConfig', onGpsConfig);
  bus.on('deviceInfo', onDeviceInfo);
  bus.on('deviceCapabilities', onDeviceCapabilities);
  bus.on('blockRules', onBlockRules);
  bus.on('uiState', onUiState);
  bus.on('windowFocus', onWindowFocus);
  bus.on('updateState', onUpdateState);
  bus.on('log:entry', onLogEntry);
  bridge.on('statusChanged', onBridgeStatus);

  const close = async () => {
    bus.off('packet', onPacket);
    bus.off('transportState', onTransportState);
    bus.off('scanResults', onScanResults);
    bus.off('errorMessage', onError);
    bus.off('menuAction', onMenuAction);
    bus.off('theme', onTheme);
    bus.off('channels', onChannels);
    bus.off('channelPresence', onChannelPresence);
    bus.off('syncProgress', onSyncProgress);
    bus.off('contacts', onContacts);
    bus.off('discovered', onDiscovered);
    bus.off('contactEvicted', onContactEvicted);
    bus.off('messages', onMessages);
    bus.off('messageState', onMessageState);
    bus.off('messagePathHeard', onMessagePathHeard);
    bus.off('owner', onOwner);
    bus.off('appSettings', onAppSettings);
    bus.off('radioSettings', onRadioSettings);
    bus.off('mapSettings', onMapSettings);
    bus.off('mapManifest', onMapManifest);
    bus.off('mapTileStatus', onMapTileStatus);
    bus.off('repeaterStatus', onRepeaterStatus);
    bus.off('repeaterTelemetry', onRepeaterTelemetry);
    bus.off('pathLearned', onPathLearned);
    bus.off('deviceIdentity', onDeviceIdentity);
    bus.off('autoAddConfig', onAutoAddConfig);
    bus.off('telemetryPolicy', onTelemetryPolicy);
    bus.off('gpsConfig', onGpsConfig);
    bus.off('deviceInfo', onDeviceInfo);
    bus.off('deviceCapabilities', onDeviceCapabilities);
    bus.off('blockRules', onBlockRules);
    bus.off('uiState', onUiState);
    bus.off('windowFocus', onWindowFocus);
    bus.off('updateState', onUpdateState);
    bus.off('log:entry', onLogEntry);
    bridge.off('statusChanged', onBridgeStatus);
    // Force-terminate WS clients and HTTP keep-alives. The renderer is still
    // alive during shutdown (before-quit preventDefault), so graceful close
    // would wait forever for the renderer to ack the close frame.
    for (const c of clients) c.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    (httpServer as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { port: boundPort, close };
}

function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

type FetchHandler = Parameters<typeof serve>[0]['fetch'];

function listenWithFallback(
  fetch: FetchHandler,
  startPort: number,
  hostname: string,
  onBound: (port: number) => void,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port: number) => {
      const server = serve({ fetch, port, hostname }, (info) => {
        onBound(info.port);
        resolve(server);
      });
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_PROBES) {
          attempt += 1;
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    };
    tryPort(startPort);
  });
}
