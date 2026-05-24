import type { BridgeStatus, TransportState } from '../../shared/types';

interface Props {
  port: number | null;
  wsClients: number;
  transportState: TransportState;
  bridge: BridgeStatus | null;
}

export function StatusBar({ port, wsClients, transportState, bridge }: Props) {
  return (
    <footer className="flex flex-wrap items-center gap-4 border-t border-cs-border bg-cs-bg-2 px-4 py-1.5 font-mono text-[10px] tracking-wide text-cs-text-dim uppercase">
      <span>
        HTTP <span className="text-cs-text-muted">{port ?? '—'}</span>
      </span>
      <span>
        WS <span className="text-cs-text-muted">{wsClients}</span>
      </span>
      <span>
        IP <span className="text-cs-text-muted">{bridge?.lanAddress ?? '—'}</span>
      </span>
      <span>
        Bridge TCP{' '}
        <span className="text-cs-text-muted">
          {bridge?.tcpPort ?? 'off'}
          {bridge?.tcpPort != null ? ` (${bridge.tcpClients})` : ''}
        </span>
      </span>
      <span>
        mDNS <span className="text-cs-text-muted">{bridge?.mdnsServiceName ?? 'off'}</span>
      </span>
      <span>
        Transport <span className="text-cs-text-muted">{transportState}</span>
      </span>
    </footer>
  );
}
