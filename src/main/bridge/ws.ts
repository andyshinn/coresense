import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import { emit } from '../events/bus';
import type { BridgeClient, BridgeHub } from './hub';

export interface WsListenerHandle {
  port: number;
  close(): Promise<void>;
}

const FALLBACK_PROBES = 4;

export async function startWsListener(
  hub: BridgeHub,
  bindAddress: string,
  startPort: number,
): Promise<WsListenerHandle> {
  const httpServer = await listenWithFallback(bindAddress, startPort);
  const boundPort = (httpServer.address() as { port: number } | null)?.port ?? startPort;

  httpServer.on('request', (_req, res) => {
    res.statusCode = 426;
    res.setHeader('Upgrade', 'websocket');
    res.end('Upgrade Required');
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req) => {
    ws.binaryType = 'nodebuffer';
    const remoteAddr = `${req.socket.remoteAddress ?? 'unknown'}:${req.socket.remotePort ?? 0}`;
    const client: BridgeClient = {
      id: randomUUID(),
      kind: 'ws',
      remoteAddr,
      send(payload) {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(payload, { binary: true });
      },
      close(reason) {
        try {
          ws.close(1000, reason);
        } catch {
          // ignore
        }
      },
    };

    hub.add(client);

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      hub.handleClientFrame(client, buf);
    });
    ws.on('error', (err) => {
      emit.error(`Bridge WS ${remoteAddr}: ${err.message}`);
    });
    ws.on('close', () => hub.remove(client));
  });

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) {
          try {
            client.close(1001, 'bridge shutting down');
          } catch {
            // ignore
          }
        }
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

function listenWithFallback(bindAddress: string, startPort: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port: number) => {
      const server = createServer();
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempt < FALLBACK_PROBES) {
          attempt += 1;
          tryPort(port + 1);
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(server);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, bindAddress);
    };
    tryPort(startPort);
  });
}
