import { Bluetooth } from 'lucide-react';
import { useState } from 'react';
import type { BleDevice, TransportState } from '../../../../shared/types';
import { Button } from '../../../components/ui/button';
import {
  ConnectionStatus,
  DeviceList,
  ScanButton,
  type TransportKind,
  TransportTabs,
} from '../../../features/connection/ConnectionParts';
import { useNowTick } from '../../../hooks/useNowTick';
import { loadLastDevice } from '../../../lib/lastDevice';
import { useStore } from '../../../lib/store';
import { fmtRelative } from '../../../lib/time';
import { NodeCard } from '../NodeCard';

interface Props {
  state: TransportState;
  devices: BleDevice[];
  busy: boolean;
  onScan: () => void;
  onConnect: (deviceId: string) => void;
  className?: string;
}

/** The disconnected page's first card: what was the Radio Connection panel.
 *  The remembered radio connects in one click; Scan finds others. */
export function RadioConnectionCard({ state, devices, busy, onScan, onConnect, className }: Props) {
  const [transport, setTransport] = useState<TransportKind>('ble');
  const cache = useStore((s) => s.nodeCache);
  const now = useNowTick(30_000);
  const remembered = loadLastDevice();
  const rememberedEntry = remembered ? Object.values(cache.entries).find((e) => e.bleId === remembered.id) : undefined;
  const lastSeen = rememberedEntry?.lastSeenAt ?? null;
  const connecting = state === 'connecting';

  return (
    <NodeCard icon={Bluetooth} title="Radio connection" tone="accent" className={className}>
      <ConnectionStatus state={state} />
      <TransportTabs value={transport} onChange={setTransport} />
      {remembered && (
        <div className="flex items-center gap-3 rounded-md border border-cs-border bg-cs-bg px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="label-caps text-cs-text-muted">Remembered</span>
            <span className="truncate text-[13px] text-cs-text">{remembered.name ?? '(unnamed radio)'}</span>
            <span className="truncate font-mono text-[10px] text-cs-text-muted">{remembered.id}</span>
            {lastSeen !== null && (
              <span className="text-[11px] text-cs-text-muted">Last connected {fmtRelative(lastSeen, now)}</span>
            )}
          </div>
          <Button size="sm" onClick={() => onConnect(remembered.id)} disabled={busy || connecting}>
            Connect
          </Button>
        </div>
      )}
      <ScanButton state={state} busy={busy} onScan={onScan} />
      <DeviceList devices={devices} state={state} busy={busy} onConnect={onConnect} />
    </NodeCard>
  );
}
