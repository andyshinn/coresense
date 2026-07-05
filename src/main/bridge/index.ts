import { networkInterfaces } from 'node:os';
import { BRIDGE_DEFAULT_TCP_PORT, BRIDGE_DEFAULT_TCP_PORT_DEV, type BridgeStatus } from '../../shared/types';
import { emit } from '../events/bus';
import { BridgeHub } from './hub';
import { startTcpListener, type TcpListenerHandle } from './tcp';

export interface BridgeOptions {
  tcpPort?: number;
  bindAddress?: string;
  enableTcp?: boolean;
  dev?: boolean;
}

export interface BridgeHandle {
  tcpPort: number | null;
  getStatus(): BridgeStatus;
  setMdnsServiceName(name: string | null): void;
  on(ev: 'statusChanged', fn: () => void): void;
  off(ev: 'statusChanged', fn: () => void): void;
  close(): Promise<void>;
}

const DEFAULT_BIND = '127.0.0.1';

export async function startBridge(opts: BridgeOptions = {}): Promise<BridgeHandle> {
  const defaultTcp = opts.dev ? BRIDGE_DEFAULT_TCP_PORT_DEV : BRIDGE_DEFAULT_TCP_PORT;
  const tcpPort = opts.tcpPort ?? readNumberEnv('BRIDGE_TCP_PORT', defaultTcp);
  const bindAddress = opts.bindAddress ?? process.env.BRIDGE_BIND ?? DEFAULT_BIND;
  const enableTcp = opts.enableTcp ?? readBoolEnv('BRIDGE_TCP_ENABLED', true);

  const hub = new BridgeHub();

  let tcp: TcpListenerHandle | null = null;

  if (enableTcp) {
    try {
      tcp = await startTcpListener(hub, bindAddress, tcpPort);
    } catch (err) {
      emit.error(`Bridge: TCP listener failed: ${(err as Error).message}`);
    }
  }

  hub.setListeners({
    bindAddress,
    lanAddress: resolveLanAddress(bindAddress),
    tcpPort: tcp?.port ?? null,
    mdnsServiceName: null,
  });

  return {
    tcpPort: tcp?.port ?? null,
    getStatus: () => hub.getStatus(),
    setMdnsServiceName: (name) => hub.setMdnsServiceName(name),
    on: (ev, fn) => hub.on(ev, fn),
    off: (ev, fn) => hub.off(ev, fn),
    close: async () => {
      await Promise.allSettled([tcp?.close() ?? Promise.resolve()]);
      hub.close();
    },
  };
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    emit.error(`Bridge: invalid ${key}=${raw}, using ${fallback}`);
    return fallback;
  }
  return parsed;
}

function readBoolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return !/^(0|false|no|off)$/i.test(raw);
}

function resolveLanAddress(bindAddress: string): string | null {
  // If the user pinned a real bind address, that's the answer.
  if (bindAddress !== '0.0.0.0' && bindAddress !== '::' && bindAddress !== '') {
    return bindAddress;
  }
  // Pick the first non-internal IPv4 address; macOS Wi-Fi (en0) typically wins.
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return null;
}
