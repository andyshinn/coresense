import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import { emit } from '../events/bus';
import { child } from '../log';
import type { BridgeClient, BridgeHub } from './hub';

const logger = child('bridge:ws');

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
  logger.info(`listening on ${bindAddress}:${boundPort}`);

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
        logger.trace(
          `PROXY_TX ${remoteAddr} ${payload.length}B code=0x${(payload[0] ?? 0).toString(16).padStart(2, '0')} hex=${payload.toString('hex')}`,
        );
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

    logger.debug(`client connected ${remoteAddr} id=${client.id}`);
    hub.add(client);

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        logger.warn(`non-binary message from ${remoteAddr}; ignored`);
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      logger.trace(
        `PROXY_RX ${remoteAddr} ${buf.length}B cmd=0x${(buf[0] ?? 0).toString(16).padStart(2, '0')} hex=${buf.toString('hex')}`,
      );
      hub.handleClientFrame(client, buf);
    });
    ws.on('error', (err) => {
      emit.error(`Bridge WS ${remoteAddr}: ${err.message}`);
      logger.warn(`socket error ${remoteAddr}: ${err.message}`);
    });
    ws.on('close', () => {
      logger.debug(`client disconnected ${remoteAddr}`);
      hub.remove(client);
    });
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
