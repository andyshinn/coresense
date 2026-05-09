import type { BleDevice, TransportState } from '../../shared/types';

interface Props {
  state: TransportState;
  devices: BleDevice[];
  connectedDeviceId?: string;
  onScan: () => void;
  onConnect: (deviceId: string) => void;
  onDisconnect: () => void;
  busy: boolean;
}

const stateColor: Record<TransportState, string> = {
  idle: 'bg-slate-700 text-slate-100',
  scanning: 'bg-amber-600 text-amber-50',
  connecting: 'bg-sky-600 text-sky-50',
  connected: 'bg-emerald-600 text-emerald-50',
  error: 'bg-rose-600 text-rose-50',
};

export function ConnectionPanel({
  state,
  devices,
  connectedDeviceId,
  onScan,
  onConnect,
  onDisconnect,
  busy,
}: Props) {
  return (
    <section className="flex shrink-0 flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 lg:w-90">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Connection</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateColor[state]}`}>
          {state}
        </span>
      </header>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onScan}
          disabled={busy || state === 'scanning'}
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === 'scanning' ? 'Scanning…' : 'Scan for devices'}
        </button>
        {state === 'connected' && (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
          >
            Disconnect
          </button>
        )}
      </div>

      <ul className="max-h-56 overflow-y-auto rounded border border-slate-800 divide-y divide-slate-800">
        {devices.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-slate-500">No devices yet.</li>
        )}
        {devices.map((d) => {
          const isConnected = connectedDeviceId === d.id;
          return (
            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="flex flex-col">
                <span className="font-medium text-slate-100">{d.name ?? '(unnamed)'}</span>
                <span className="font-mono text-xs text-slate-500">
                  {d.id} · {d.rssi} dBm
                </span>
              </div>
              <button
                type="button"
                onClick={() => onConnect(d.id)}
                disabled={busy || isConnected}
                className="rounded border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                {isConnected ? 'Connected' : 'Connect'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
