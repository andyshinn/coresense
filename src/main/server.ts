import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type WebSocket, WebSocketServer } from 'ws';
import type { BleDevice, RawPacket, TransportState, WsMessage } from '../shared/types';
import { apiKeyAuth, checkWsKey } from './api/middleware/auth';
import { createRoutes } from './api/routes';
import type { BridgeHandle } from './bridge';
import { bus } from './events/bus';
import { transportManager } from './transport/manager';

const DEFAULT_PORT = 7654;
const MAX_PORT_PROBES = 50;

interface StartServerResult {
  port: number;
  close: () => Promise<void>;
}

export async function startServer(
  rendererDir: string | null,
  bridge: BridgeHandle,
): Promise<StartServerResult> {
  const app = new Hono();
  const clients = new Set<WebSocket>();

  // The renderer is served from Vite's dev server (a different origin) during
  // development, and any external browser client lives on a different origin too.
  // The API is API-key authenticated, so allow any origin.
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      credentials: false,
      maxAge: 600,
    }),
  );
  app.use('*', apiKeyAuth);
  app.route(
    '/',
    createRoutes({
      port: () => boundPort,
      wsClients: () => clients.size,
      bridgeStatus: () => bridge.getStatus(),
    }),
  );

  if (rendererDir) {
    app.get('/', (c) => c.html(readFileSync(join(rendererDir, 'index.html'), 'utf8')));
    app.get('/*', (c) => {
      const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
      const filePath = normalize(join(rendererDir, reqPath));
      if (!filePath.startsWith(normalize(rendererDir))) {
        return c.json({ error: 'Forbidden' }, 403);
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        // SPA fallback for non-asset routes
        if (extname(c.req.path) === '') {
          return c.html(readFileSync(join(rendererDir, 'index.html'), 'utf8'));
        }
        return c.json({ error: 'Not found' }, 404);
      }
      const body = readFileSync(filePath);
      const type = mimeFor(extname(filePath));
      return c.body(body, 200, { 'Content-Type': type });
    });
  }

  let boundPort = DEFAULT_PORT;
  const httpServer = await listenWithFallback(app.fetch, DEFAULT_PORT, (p) => {
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
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  const broadcast = (msg: WsMessage) => {
    const data = JSON.stringify(msg);
    for (const c of clients) {
      if (c.readyState === c.OPEN) c.send(data);
    }
  };

  const onPacket = (p: RawPacket) => broadcast({ type: 'packet', payload: p });
  const onTransportState = (state: TransportState, deviceId?: string) => {
    transportManager.setState(state, deviceId);
    broadcast({ type: 'transportState', payload: { state, deviceId } });
  };
  const onScanResults = (devices: BleDevice[]) =>
    broadcast({ type: 'scanResults', payload: devices });
  const onError = (message: string) => broadcast({ type: 'error', payload: { message } });
  const onBridgeStatus = () => broadcast({ type: 'bridgeStatus', payload: bridge.getStatus() });

  bus.on('packet', onPacket);
  bus.on('transportState', onTransportState);
  bus.on('scanResults', onScanResults);
  bus.on('error', onError);
  bridge.on('statusChanged', onBridgeStatus);

  const close = async () => {
    bus.off('packet', onPacket);
    bus.off('transportState', onTransportState);
    bus.off('scanResults', onScanResults);
    bus.off('error', onError);
    bridge.off('statusChanged', onBridgeStatus);
    for (const c of clients) c.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
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
  onBound: (port: number) => void,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port: number) => {
      const server = serve({ fetch, port }, (info) => {
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
