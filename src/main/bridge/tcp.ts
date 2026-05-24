import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { emit } from '../events/bus';
import { child } from '../log';
import { DIR_RADIO_TO_CLIENT, encodeFrame, FrameDecoder } from './framing';
import type { BridgeClient, BridgeHub } from './hub';

const logger = child('bridge:tcp');

export interface TcpListenerHandle {
  port: number;
  close(): Promise<void>;
}

export async function startTcpListener(
  hub: BridgeHub,
  bindAddress: string,
  port: number,
): Promise<TcpListenerHandle> {
  const server = await listen(bindAddress, port);
  const boundPort = (server.address() as { port: number } | null)?.port ?? port;
  logger.info(`listening on ${bindAddress}:${boundPort}`);

  server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    const remoteIp = socket.remoteAddress ?? null;
    const remoteAddr = `${remoteIp ?? 'unknown'}:${socket.remotePort ?? 0}`;
    const client: BridgeClient = {
      id: randomUUID(),
      kind: 'tcp',
      remoteAddr,
      remoteIp,
      send(payload) {
        if (!socket.writable) return;
        logger.trace(
          `PROXY_TX ${remoteAddr} ${payload.length}B code=0x${(payload[0] ?? 0).toString(16).padStart(2, '0')} hex=${payload.toString('hex')}`,
        );
        socket.write(encodeFrame(DIR_RADIO_TO_CLIENT, payload));
      },
      close(reason) {
        if (reason) socket.write(`# ${reason}\n`);
        socket.end();
      },
    };

    socket.setNoDelay(true);
    // Send TCP keepalive probes after 30s of idle so NATs / firewalls in the
    // path don't silently drop the connection while BLE is recovering.
    socket.setKeepAlive(true, 30_000);
    logger.debug(`client connected ${remoteAddr} id=${client.id}`);
    hub.add(client);

    socket.on('data', (chunk: Buffer) => {
      try {
        decoder.push(chunk, (frame) => {
          logger.trace(
            `PROXY_RX ${remoteAddr} ${frame.length}B cmd=0x${(frame[0] ?? 0).toString(16).padStart(2, '0')} hex=${frame.toString('hex')}`,
          );
          hub.handleClientFrame(client, frame);
        });
      } catch (err) {
        emit.error(
          `Bridge TCP ${remoteAddr}: protocol error, dropping client: ${(err as Error).message}`,
        );
        logger.warn(`protocol error from ${remoteAddr}: ${(err as Error).message}`);
        socket.destroy();
      }
    });
    socket.on('end', () => socket.end());
    socket.on('error', (err) => {
      emit.error(`Bridge TCP ${remoteAddr}: ${err.message}`);
      logger.warn(`socket error ${remoteAddr}: ${err.message}`);
    });
    socket.on('close', () => {
      logger.debug(`client disconnected ${remoteAddr}`);
      hub.remove(client);
    });
  });

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function listen(bindAddress: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, bindAddress);
  });
}
