import { hostname, networkInterfaces } from 'node:os';
import type { BridgeStatus } from '../../shared/types';
import { emit } from '../events/bus';
import { BridgeHub } from './hub';
import { type MdnsHandle, startMdns } from './mdns';
import { startTcpListener, type TcpListenerHandle } from './tcp';
import { startWsListener, type WsListenerHandle } from './ws';

export interface BridgeOptions {
  tcpPort?: number;
  wsPort?: number;
  bindAddress?: string;
  serviceName?: string;
  enableTcp?: boolean;
  enableWs?: boolean;
  enableMdns?: boolean;
}

export interface BridgeHandle {
  tcpPort: number | null;
  wsPort: number | null;
  serviceName: string | null;
  getStatus(): BridgeStatus;
  on(ev: 'statusChanged', fn: () => void): void;
  off(ev: 'statusChanged', fn: () => void): void;
  close(): Promise<void>;
}

const DEFAULT_TCP_PORT = 7655;
const DEFAULT_WS_PORT = 7656;
const DEFAULT_BIND = '0.0.0.0';

export async function startBridge(opts: BridgeOptions = {}): Promise<BridgeHandle> {
  const tcpPort = opts.tcpPort ?? readNumberEnv('BRIDGE_TCP_PORT', DEFAULT_TCP_PORT);
  const wsPort = opts.wsPort ?? readNumberEnv('BRIDGE_WS_PORT', DEFAULT_WS_PORT);
  const bindAddress = opts.bindAddress ?? process.env.BRIDGE_BIND ?? DEFAULT_BIND;
  const serviceName =
    opts.serviceName ??
    process.env.BRIDGE_MDNS_NAME ??
    `coresense-${hostname().replace(/\..*$/, '')}`;
  const enableTcp = opts.enableTcp ?? readBoolEnv('BRIDGE_TCP_ENABLED', true);
  const enableWs = opts.enableWs ?? readBoolEnv('BRIDGE_WS_ENABLED', true);
  const enableMdns = opts.enableMdns ?? readBoolEnv('BRIDGE_MDNS_ENABLED', true);

  const hub = new BridgeHub();

  let tcp: TcpListenerHandle | null = null;
  let ws: WsListenerHandle | null = null;
  let mdns: MdnsHandle | null = null;

  const [tcpResult, wsResult] = await Promise.allSettled([
    enableTcp ? startTcpListener(hub, bindAddress, tcpPort) : Promise.resolve(null),
    enableWs ? startWsListener(hub, bindAddress, wsPort) : Promise.resolve(null),
  ]);

  if (tcpResult.status === 'fulfilled') {
    tcp = tcpResult.value;
  } else {
    emit.error(`Bridge: TCP listener failed: ${(tcpResult.reason as Error).message}`);
  }
  if (wsResult.status === 'fulfilled') {
    ws = wsResult.value;
  } else {
    emit.error(`Bridge: WS listener failed: ${(wsResult.reason as Error).message}`);
  }

  if (enableMdns && (tcp || ws)) {
    try {
      mdns = startMdns({
        serviceName,
        tcpPort: tcp?.port ?? null,
        wsPort: ws?.port ?? null,
      });
    } catch (err) {
      emit.error(`Bridge: mDNS publish failed: ${(err as Error).message}`);
    }
  }

  hub.setListeners({
    bindAddress,
    lanAddress: resolveLanAddress(bindAddress),
    tcpPort: tcp?.port ?? null,
    wsPort: ws?.port ?? null,
    mdnsServiceName: mdns?.serviceName ?? null,
  });

  return {
    tcpPort: tcp?.port ?? null,
    wsPort: ws?.port ?? null,
    serviceName: mdns?.serviceName ?? null,
    getStatus: () => hub.getStatus(),
    on: (ev, fn) => hub.on(ev, fn),
    off: (ev, fn) => hub.off(ev, fn),
    close: async () => {
      await Promise.allSettled([
        mdns?.close() ?? Promise.resolve(),
        tcp?.close() ?? Promise.resolve(),
        ws?.close() ?? Promise.resolve(),
      ]);
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
