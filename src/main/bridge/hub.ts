import { EventEmitter } from 'node:events';
import type { BridgeStatus, RawPacket, TransportState } from '../../shared/types';
import { bus, emit } from '../events/bus';
import { transportManager } from '../transport/manager';

export type ClientKind = 'tcp' | 'ws';

export interface BridgeClient {
  id: string;
  kind: ClientKind;
  remoteAddr: string;
  send(payload: Buffer): void;
  close(reason?: string): void;
}

const SEND_QUEUE_MAX = 100;

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

  constructor() {
    super();
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
    this.emit('statusChanged');
  }

  remove(client: BridgeClient): void {
    if (this.clients.delete(client)) {
      this.emit('statusChanged');
    }
  }

  handleClientFrame(client: BridgeClient, payload: Buffer): void {
    if (this.sendQueue.length >= SEND_QUEUE_MAX) {
      emit.error(
        `Bridge: send queue full; dropped ${payload.length} bytes from ${client.remoteAddr}`,
      );
      return;
    }
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
    if (this.clients.size === 0) return;
    const buf = Buffer.from(p.bytes);
    for (const client of this.clients) {
      try {
        client.send(buf);
      } catch (err) {
        emit.error(`Bridge: send to ${client.remoteAddr} failed: ${(err as Error).message}`);
      }
    }
  };

  private onTransportState = (state: TransportState) => {
    const next = state === 'connected';
    if (next !== this.radioConnected) {
      this.radioConnected = next;
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
          emit.error(
            `Bridge: dropped ${item.payload.length} bytes from ${item.client.remoteAddr} (no radio)`,
          );
          continue;
        }
        try {
          await transport.sendBytes(item.payload);
        } catch (err) {
          emit.error(
            `Bridge: send to radio failed for ${item.client.remoteAddr}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.workerRunning = false;
    }
  }
}
