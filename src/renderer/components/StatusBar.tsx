import type { TransportState } from '../../shared/types';

interface Props {
  port: number | null;
  wsClients: number;
  transportState: TransportState;
}

export function StatusBar({ port, wsClients, transportState }: Props) {
  return (
    <footer className="flex items-center gap-4 border-t border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400">
      <span>
        HTTP: <span className="text-slate-200">{port ?? '—'}</span>
      </span>
      <span>
        WS clients: <span className="text-slate-200">{wsClients}</span>
      </span>
      <span>
        Transport: <span className="text-slate-200">{transportState}</span>
      </span>
    </footer>
  );
}
