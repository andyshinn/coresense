import { EventEmitter } from 'node:events';
import type { BridgeStatus, RawPacket, TransportState } from '../../shared/types';
import { bus, emit } from '../events/bus';
import { child } from '../log';
import { transportManager } from '../transport/manager';
import { InboxRouter } from './drain';

const logger = child('bridge:hub');
const inboxLogger = child('bridge:inbox');

export type ClientKind = 'tcp' | 'ws';

export interface BridgeClient {
  id: string;
  kind: ClientKind;
  remoteAddr: string;
  remoteIp: string | null;
  send(payload: Buffer): void;
  close(reason?: string): void;
}

const SEND_QUEUE_MAX = 100;
// Defense in depth: even if a transport's sendBytes() promise hangs, this
// per-item cap keeps the worker moving so the queue can't fill behind it.
// Transports should have their own (tighter) write timeout; this is the
// backstop. Kept generously above the BLE write timeout (15s) so a healthy
// but slow write isn't pre-empted by the hub.
const SEND_ITEM_TIMEOUT_MS = 20_000;

interface QueuedSend {
  payload: Buffer;
  client: BridgeClient;
}

export class BridgeHub extends EventEmitter {
  private clients = new Set<BridgeClient>();
  private sendQueue: QueuedSend[] = [];
  private workerRunning = false;
  private radioConnected = false;
  private bindAddress = '';
  private lanAddress: string | null = null;
  private tcpPort: number | null = null;
  private wsPort: number | null = null;
  private mdnsServiceName: string | null = null;
  private readonly inboxRouter: InboxRouter;

  constructor() {
    super();
    this.inboxRouter = new InboxRouter({
      forwardToDevice: (client, payload) => this.enqueueToDevice(client, payload),
      log: {
        trace: (msg) => inboxLogger.trace(msg),
        debug: (msg) => inboxLogger.debug(msg),
      },
    });
    bus.on('packet', this.onPacket);
    bus.on('transportState', this.onTransportState);
  }

  setListeners(opts: {
    bindAddress: string;
    lanAddress: string | null;
    tcpPort: number | null;
    wsPort: number | null;
    mdnsServiceName: string | null;
  }): void {
    this.bindAddress = opts.bindAddress;
    this.lanAddress = opts.lanAddress;
    this.tcpPort = opts.tcpPort;
    this.wsPort = opts.wsPort;
    this.mdnsServiceName = opts.mdnsServiceName;
    this.emit('statusChanged');
  }

  add(client: BridgeClient): void {
    this.clients.add(client);
    logger.debug(
      `client added ${client.kind} ${client.remoteAddr} id=${client.id} (total=${this.clients.size})`,
    );
    this.inboxRouter.addClient(client);
    this.emit('statusChanged');
  }

  remove(client: BridgeClient): void {
    if (this.clients.delete(client)) {
      this.inboxRouter.removeClient(client);
      logger.debug(
        `client removed ${client.kind} ${client.remoteAddr} id=${client.id} (total=${this.clients.size})`,
      );
      this.emit('statusChanged');
    }
  }

  handleClientFrame(client: BridgeClient, payload: Buffer): void {
    if (this.inboxRouter.handleClientFrame(client, payload) === 'handled') {
      return;
    }
    this.enqueueToDevice(client, payload);
  }

  private enqueueToDevice(client: BridgeClient, payload: Buffer): void {
    if (this.sendQueue.length >= SEND_QUEUE_MAX) {
      logger.warn(
        `send queue full; dropped ${payload.length}B from ${client.remoteAddr} (queue=${this.sendQueue.length})`,
      );
      emit.error(
        `Bridge: send queue full; dropped ${payload.length} bytes from ${client.remoteAddr}`,
      );
      return;
    }
    logger.trace(
      `queue ← ${client.kind} ${client.remoteAddr} ${payload.length}B cmd=0x${(payload[0] ?? 0).toString(16).padStart(2, '0')} (queue=${this.sendQueue.length + 1})`,
    );
    this.sendQueue.push({ payload, client });
    void this.runWorker();
  }

  getStatus(): BridgeStatus {
    let tcp = 0;
    let ws = 0;
    for (const c of this.clients) {
      if (c.kind === 'tcp') tcp++;
      else ws++;
    }
    return {
      tcpPort: this.tcpPort,
      wsPort: this.wsPort,
      bindAddress: this.bindAddress,
      lanAddress: this.lanAddress,
      tcpClients: tcp,
      wsClients: ws,
      mdnsServiceName: this.mdnsServiceName,
      radioConnected: this.radioConnected,
    };
  }

  close(): void {
    bus.off('packet', this.onPacket);
    bus.off('transportState', this.onTransportState);
    this.sendQueue = [];
    for (const c of this.clients) {
      try {
        c.close('bridge shutting down');
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.removeAllListeners();
  }

  private onPacket = (p: RawPacket) => {
    const buf = Buffer.from(p.bytes);
    const code = buf[0] ?? 0;
    if (this.inboxRouter.handleDeviceFrame(code, buf) === 'consumed') {
      return;
    }
    if (this.clients.size === 0) return;
    logger.trace(
      `radio → fanout ${buf.length}B kind=${p.kind} code=0x${code.toString(16).padStart(2, '0')} clients=${this.clients.size}`,
    );
    for (const client of this.clients) {
      try {
        client.send(buf);
      } catch (err) {
        logger.warn(`fanout to ${client.remoteAddr} failed: ${(err as Error).message}`);
        emit.error(`Bridge: send to ${client.remoteAddr} failed: ${(err as Error).message}`);
      }
    }
  };

  private onTransportState = (state: TransportState) => {
    const next = state === 'connected';
    if (next !== this.radioConnected) {
      this.radioConnected = next;
      if (next) this.inboxRouter.reset();
      this.emit('statusChanged');
    }
  };

  private async runWorker(): Promise<void> {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      while (this.sendQueue.length > 0) {
        const item = this.sendQueue.shift();
        if (!item) break;
        const transport = transportManager.getTransport();
        if (!transport?.sendBytes) {
          logger.warn(
            `no radio attached; dropped ${item.payload.length}B from ${item.client.remoteAddr}`,
          );
          emit.error(
            `Bridge: dropped ${item.payload.length} bytes from ${item.client.remoteAddr} (no radio)`,
          );
          continue;
        }
        try {
          logger.trace(
            `→ radio ${item.payload.length}B from ${item.client.remoteAddr} cmd=0x${(item.payload[0] ?? 0).toString(16).padStart(2, '0')}`,
          );
          await this.sendWithTimeout(transport.sendBytes(item.payload));
        } catch (err) {
          logger.warn(`radio send failed for ${item.client.remoteAddr}: ${(err as Error).message}`);
          emit.error(
            `Bridge: send to radio failed for ${item.client.remoteAddr}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.workerRunning = false;
    }
  }

  private sendWithTimeout(p: Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`hub send-worker timeout after ${SEND_ITEM_TIMEOUT_MS}ms`));
      }, SEND_ITEM_TIMEOUT_MS);
      p.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}
