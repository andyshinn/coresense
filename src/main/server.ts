import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { extname, join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type WebSocket, WebSocketServer } from 'ws';
import { errorMessage } from '../shared/errors';
import { clampRetention } from '../shared/packetLog';
import type { RawPacket, TransportState, WsMessage } from '../shared/types';
import { onApiError } from './api/errors';
import { apiKeyAuth, checkWsKey } from './api/middleware/auth';
import { createRoutes } from './api/routes';
import type { BridgeHandle } from './bridge';
import { clearRadioLimits, observeRadioLimits } from './device/radioLimits';
import { type BusEventMap, bus } from './events/bus';
import { listenOnPort } from './http-listen';
import { resolveHttpPort } from './http-port';
import { child, getLogBuffer } from './log';
import { noteTransportState } from './node/nodeCache';
import { startContactAutoRefresh, stopContactAutoRefresh } from './state/contactRefresh';
import { endContactWalk } from './state/contactWalk';
import { stateHolder } from './state/holder';
import { discoveredStore } from './storage/discoveredContacts';
import { packetStore } from './storage/packets';
import { clearSelfLiveRead } from './telemetry/service';
import { transportManager } from './transport/manager';
import { currentUpdateState } from './updates/controller';
import { isMainWindowFocused } from './window/registry';

interface StartServerResult {
  port: number;
  close: () => Promise<void>;
  /** Whether any WS client is open, i.e. someone would receive a broadcast. */
  hasOpenClients: () => boolean;
}

interface StartServerOptions {
  /**
   * Exact port to bind. Callers that also need to know the port *before*
   * startServer runs (bootstrap checks it against the TCP proxy port) resolve
   * it themselves and pass it here, so there is one source of truth.
   */
  port?: number;
  dev?: boolean;
  bindAddress?: string;
}

/** The bus events that reach WS clients unchanged apart from their envelope. */
type WsForwards = Omit<
  { [K in keyof BusEventMap]: (...args: BusEventMap[K]) => WsMessage },
  'packet' | 'transportState' | 'contactSyncSummary' | 'contactDiscovered'
>;

const WS_FORWARDS: WsForwards = {
  scanResults: (devices) => ({ type: 'scanResults', payload: devices }),
  errorMessage: (message) => ({ type: 'error', payload: { message } }),
  menuAction: (action) => ({ type: 'menuAction', payload: action }),
  theme: (push) => ({ type: 'theme', payload: push }),
  channels: (channels) => ({ type: 'channels', payload: channels }),
  channelPresence: (keys) => ({ type: 'channelPresence', payload: { keys } }),
  syncProgress: (progress) => ({ type: 'syncProgress', payload: progress }),
  contacts: (contacts) => ({ type: 'contacts', payload: contacts }),
  discovered: (rows) => ({ type: 'discovered', payload: rows }),
  contactEvicted: (name) => ({ type: 'contactEvicted', payload: { name } }),
  messages: (key, messages) => ({ type: 'messages', payload: { key, messages } }),
  messageState: (id, state) => ({ type: 'messageState', payload: { id, state } }),
  messagePathHeard: (payload) => ({ type: 'messagePathHeard', payload }),
  messagesDeleted: (payload) => ({ type: 'messagesDeleted', payload }),
  owner: (owner) => ({ type: 'owner', payload: owner }),
  appSettings: (settings) => ({ type: 'appSettings', payload: settings }),
  radioSettings: (settings) => ({ type: 'radioSettings', payload: settings }),
  mapSettings: (settings) => ({ type: 'mapSettings', payload: settings }),
  mapManifest: (manifest) => ({ type: 'mapManifest', payload: manifest }),
  mapTileStatus: (status) => ({ type: 'mapTileStatus', payload: status }),
  repeaterStatus: (snap) => ({ type: 'repeaterStatus', payload: snap }),
  telemetrySaved: (payload) => ({ type: 'telemetrySaved', payload }),
  telemetryDeleted: (payload) => ({ type: 'telemetryDeleted', payload }),
  telemetryInFlight: (payload) => ({ type: 'telemetryInFlight', payload }),
  pathLearned: (event) => ({ type: 'pathLearned', payload: event }),
  deviceIdentity: (identity) => ({ type: 'deviceIdentity', payload: identity }),
  autoAddConfig: (cfg) => ({ type: 'autoAddConfig', payload: cfg }),
  telemetryPolicy: (policy) => ({ type: 'telemetryPolicy', payload: policy }),
  gpsConfig: (cfg) => ({ type: 'gpsConfig', payload: cfg }),
  deviceInfo: (info) => ({ type: 'deviceInfo', payload: info }),
  deviceCapabilities: (caps) => ({ type: 'deviceCapabilities', payload: caps }),
  radioLimits: (limits) => ({ type: 'radioLimits', payload: limits }),
  nodeCache: (cache) => ({ type: 'nodeCache', payload: cache }),
  blockRules: (rules) => ({ type: 'blockRules', payload: rules }),
  macros: (macros) => ({ type: 'macros', payload: macros }),
  uiState: (state) => ({ type: 'uiState', payload: state }),
  windowFocus: (focused) => ({ type: 'windowFocus', payload: { focused } }),
  updateState: (state) => ({ type: 'updateState', payload: state }),
  'log:entry': (entry) => ({ type: 'log', payload: entry }),
};

export async function startServer(
  rendererDir: string | null,
  bridge: BridgeHandle,
  opts: StartServerOptions = {},
): Promise<StartServerResult> {
  // A fixed port: whatever the caller resolved, else CORESENSE_HTTP_PORT if
  // set (`0` binds an ephemeral port), else the dev/prod default. Never
  // probed, never relocated.
  const requestedPort = opts.port ?? resolveHttpPort(process.env, opts.dev ?? false);
  const bindAddress = opts.bindAddress ?? '127.0.0.1';
  const app = new Hono();
  const clients = new Set<WebSocket>();
  const log = child('server');

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
  // Set by listenOnPort once bound; createRoutes reads it lazily.
  let boundPort = requestedPort;
  // createRoutes installs the same handler on its own app; this one covers
  // throws from the middleware and the static file routes below.
  app.onError(onApiError);
  app.use('/api/*', apiKeyAuth);
  app.route(
    '/',
    createRoutes({
      port: () => boundPort,
      wsClients: () => clients.size,
      bridgeStatus: () => bridge.getStatus(),
    }),
  );
  // An unknown API path is a JSON 404 — never the SPA fallback below, which
  // would answer it with index.html and a 200.
  app.all('/api/*', (c) => c.json({ error: 'not found', code: 'not_found' }, 404));

  if (rendererDir) {
    // Preload index.html once at startup; the production bundle is immutable.
    const indexHtml = await readFile(join(rendererDir, 'index.html'), 'utf8');
    app.get('/', (c) => c.html(indexHtml));
    // serveStatic owns MIME types, streaming, ranges and path traversal (it
    // refuses any `.`/`..` segment), and falls through when nothing matches.
    app.get('/*', serveStatic({ root: rendererDir }));
    // SPA fallback: an extensionless path is a client-side route. Anything else
    // serveStatic didn't find is a missing asset.
    app.get('*', (c) => (extname(c.req.path) === '' ? c.html(indexHtml) : c.json({ error: 'Not found' }, 404)));
  }

  const httpServer = await listenOnPort(app.fetch, requestedPort, bindAddress, (p) => {
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
  const hasOpenClients = () => {
    for (const c of clients) if (c.readyState === c.OPEN) return true;
    return false;
  };

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

  const onPacket = (p: RawPacket) => {
    try {
      packetStore.record(p, clampRetention(stateHolder().getUiState().packetLog).storedHistorySize);
    } catch (err) {
      // Persistence is best-effort: a bad DB write must not crash main or drop the live broadcast.
      log.warn(`packet persist failed: ${errorMessage(err)}`);
    }
    broadcast({ type: 'packet', payload: p });
    // The handshake's RESP_SELF_INFO carries the board's TX power maximum.
    observeRadioLimits(p);
  };
  const onTransportState = (state: TransportState, deviceId?: string) => {
    transportManager.setState(state, deviceId);
    // The periodic contact re-read only makes sense against a live radio, and
    // this is the single place transport state is applied. Start/stop here so
    // the timer can't outlive the link (the tick re-checks anyway, but an armed
    // timer against a dead transport is just noise).
    if (state === 'connected') {
      startContactAutoRefresh();
    } else {
      stopContactAutoRefresh();
      // A contact walk cannot outlive the link that was carrying it, and its
      // END_OF_CONTACTS is never coming. Release the guard here or the next
      // connect's refresh button answers "already syncing" until the stale
      // timeout expires.
      endContactWalk();
      clearRadioLimits();
      clearSelfLiveRead();
    }
    // Opens or closes the connected radio's last-known entry.
    noteTransportState(state, deviceId);
    broadcast({ type: 'transportState', payload: { state, deviceId } });
  };
  const onBridgeStatus = () => broadcast({ type: 'bridgeStatus', payload: bridge.getStatus() });
  // Plain bus → WS forwards; packet and transportState stay explicit above
  // because they do more than broadcast.
  const forwards = (Object.keys(WS_FORWARDS) as (keyof WsForwards)[]).map((event) => {
    const toMessage = WS_FORWARDS[event] as (...args: unknown[]) => WsMessage;
    return [event, (...args: unknown[]) => broadcast(toMessage(...args))] as const;
  });

  bus.on('packet', onPacket);
  bus.on('transportState', onTransportState);
  for (const [event, listener] of forwards) bus.on(event, listener);
  bridge.on('statusChanged', onBridgeStatus);

  const close = async () => {
    stopContactAutoRefresh();
    bus.off('packet', onPacket);
    bus.off('transportState', onTransportState);
    for (const [event, listener] of forwards) bus.off(event, listener);
    bridge.off('statusChanged', onBridgeStatus);
    // Force-terminate WS clients and HTTP keep-alives. The renderer is still
    // alive during shutdown (before-quit preventDefault), so graceful close
    // would wait forever for the renderer to ack the close frame.
    for (const c of clients) c.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    (httpServer as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { port: boundPort, close, hasOpenClients };
}
