import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BleDevice, RawPacket, TransportState, WsMessage } from '../shared/types';
import { ApiKeyGate } from './components/ApiKeyGate';
import { ConnectionPanel } from './components/ConnectionPanel';
import { PacketLog } from './components/PacketLog';
import { StatusBar } from './components/StatusBar';
import { useWebSocket } from './hooks/useWebSocket';
import { type ApiClient, api, fetchCapabilities } from './lib/api';
import { loadApiKey, saveApiKey } from './lib/apiKey';

const MAX_PACKETS = 500;
const STATUS_POLL_MS = 2_000;

const FALLBACK_BASE_URL = 'http://127.0.0.1:7654';

export function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const [transportState, setTransportState] = useState<TransportState>('idle');
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | undefined>();
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [packets, setPackets] = useState<RawPacket[]>([]);
  const [wsClients, setWsClients] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Probe /api/capabilities once on mount: prefer the page's own host,
  // fall back to the default port (covers the Vite-dev-server case).
  useEffect(() => {
    const candidate = window.location.protocol.startsWith('http')
      ? `${window.location.protocol}//${window.location.host}`
      : FALLBACK_BASE_URL;
    void (async () => {
      try {
        const caps = await fetchCapabilities(candidate);
        setBaseUrl(candidate);
        setPort(caps.httpPort);
      } catch {
        try {
          const caps = await fetchCapabilities(FALLBACK_BASE_URL);
          setBaseUrl(FALLBACK_BASE_URL);
          setPort(caps.httpPort);
        } catch (err) {
          setError(`Could not reach CoreSense server: ${(err as Error).message}`);
        }
      }
    })();
  }, []);

  const client: ApiClient | null = useMemo(
    () => (baseUrl && apiKey ? { baseUrl, apiKey } : null),
    [baseUrl, apiKey],
  );

  const wsUrl = useMemo(() => {
    if (!baseUrl || !apiKey) return null;
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.searchParams.set('key', apiKey);
    return url.toString();
  }, [baseUrl, apiKey]);

  const onMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case 'packet':
        setPackets((prev) => {
          const next = prev.length >= MAX_PACKETS ? prev.slice(-(MAX_PACKETS - 1)) : prev;
          return [...next, msg.payload];
        });
        break;
      case 'transportState':
        setTransportState(msg.payload.state);
        setConnectedDeviceId(msg.payload.deviceId);
        break;
      case 'scanResults':
        setDevices(msg.payload);
        break;
      case 'error':
        setError(msg.payload.message);
        break;
    }
  }, []);

  useWebSocket({ url: wsUrl, onMessage });

  // Poll status for ws-clients count.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await api.status(client);
        if (!cancelled) setWsClients(s.wsClients);
      } catch {
        // ignore transient
      }
    };
    void tick();
    const id = window.setInterval(tick, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [client]);

  const handleScan = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await api.scan(client);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [client]);

  const handleConnect = useCallback(
    async (deviceId: string) => {
      if (!client) return;
      setBusy(true);
      setError(null);
      try {
        await api.connect(client, deviceId);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const handleDisconnect = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await api.disconnect(client);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [client]);

  if (!apiKey) {
    return (
      <ApiKeyGate
        onSubmit={(key) => {
          saveApiKey(key);
          setApiKey(key);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-100">CoreSense</h1>
        <p className="text-xs text-slate-500">MeshCore desktop client — prototype</p>
      </header>

      {error && (
        <div className="border-b border-rose-900 bg-rose-950/50 px-4 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[360px_1fr]">
        <ConnectionPanel
          state={transportState}
          devices={devices}
          connectedDeviceId={connectedDeviceId}
          onScan={handleScan}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          busy={busy}
        />
        <PacketLog packets={packets} />
      </main>

      <StatusBar port={port} wsClients={wsClients} transportState={transportState} />
    </div>
  );
}
