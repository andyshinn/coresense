import type { BridgeStatus, TransportState } from '../../shared/types';

interface Props {
  port: number | null;
  wsClients: number;
  transportState: TransportState;
  bridge: BridgeStatus | null;
}

export function StatusBar({ port, wsClients, transportState, bridge }: Props) {
  return (
    <footer className="flex flex-wrap items-center gap-4 border-t border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400">
      <span>
        HTTP: <span className="text-slate-200">{port ?? '—'}</span>
      </span>
      <span>
        WS clients: <span className="text-slate-200">{wsClients}</span>
      </span>
      <span>
        IP: <span className="text-slate-200">{bridge?.lanAddress ?? '—'}</span>
      </span>
      <span>
        Bridge TCP:{' '}
        <span className="text-slate-200">
          {bridge?.tcpPort ?? 'off'}
          {bridge?.tcpPort != null ? ` (${bridge.tcpClients})` : ''}
        </span>
      </span>
      <span>
        Bridge WS:{' '}
        <span className="text-slate-200">
          {bridge?.wsPort ?? 'off'}
          {bridge?.wsPort != null ? ` (${bridge.wsClients})` : ''}
        </span>
      </span>
      <span>
        mDNS: <span className="text-slate-200">{bridge?.mdnsServiceName ?? 'off'}</span>
      </span>
      <span>
        Transport: <span className="text-slate-200">{transportState}</span>
      </span>
    </footer>
  );
}
