// The radio-connection controls, lifted out of the old Radio Connection panel
// (BleConnect.tsx) so My Node can compose them into its connection card.
// Scanning, connecting and disconnecting still go through App.tsx's handlers.

import { Bluetooth, Loader2, Radio, Wifi } from 'lucide-react';
import { useEffect } from 'react';
import type { BleDevice, TransportState } from '../../../shared/types';
import { RssiChip } from '../../components/RssiChip';
import { Button } from '../../components/ui/button';
import { saveLastDevice } from '../../lib/lastDevice';
import { cn } from '../../lib/utils';

export type TransportKind = 'ble' | 'serial' | 'tcp';

const TRANSPORTS: { id: TransportKind; label: string; icon: typeof Bluetooth; disabled?: boolean }[] = [
  { id: 'ble', label: 'BLE', icon: Bluetooth },
  { id: 'serial', label: 'Serial', icon: Radio, disabled: true },
  { id: 'tcp', label: 'WiFi·TCP', icon: Wifi, disabled: true },
];

/** BLE / Serial / WiFi·TCP picker in the rail recipe: a bg-3 track with the
 *  selected segment on bg and accent. Serial and TCP aren't built yet. */
export function TransportTabs({ value, onChange }: { value: TransportKind; onChange: (v: TransportKind) => void }) {
  return (
    <div role="tablist" aria-label="Connection type" className="flex gap-0.5 rounded-md bg-cs-bg-3 p-0.5">
      {TRANSPORTS.map((t) => {
        const active = value === t.id;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={t.disabled}
            title={t.disabled ? `${t.label} is coming in a later release` : undefined}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline-1 focus-visible:outline-cs-accent',
              active ? 'bg-cs-bg text-cs-accent' : 'text-cs-text-muted hover:text-cs-text',
              t.disabled && 'cursor-not-allowed opacity-50 hover:text-cs-text-muted',
            )}
          >
            <Icon aria-hidden="true" className="size-3" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const STATUS: Record<TransportState, { label: string; dot: string }> = {
  idle: { label: 'Not connected', dot: 'bg-cs-text-dim' },
  scanning: { label: 'Scanning for radios…', dot: 'bg-cs-warn motion-safe:animate-pulse' },
  connecting: { label: 'Connecting…', dot: 'bg-cs-accent motion-safe:animate-pulse' },
  connected: { label: 'Connected', dot: 'bg-cs-online' },
  error: { label: 'Connection error', dot: 'bg-cs-danger' },
};

export function ConnectionStatus({ state }: { state: TransportState }) {
  const s = STATUS[state];
  return (
    <div className="flex items-center gap-2 text-[12px] text-cs-text-muted" role="status">
      <span aria-hidden="true" className={cn('size-2 rounded-full', s.dot)} />
      {s.label}
    </div>
  );
}

export function ScanButton({ state, busy, onScan }: { state: TransportState; busy: boolean; onScan: () => void }) {
  const scanning = state === 'scanning';
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={onScan}
      disabled={busy || scanning || state === 'connecting'}
    >
      {scanning ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Bluetooth aria-hidden="true" />}
      {scanning ? 'Scanning…' : 'Scan for radios'}
    </Button>
  );
}

/** Radios found by the last scan, strongest first. Empty renders nothing. */
export function DeviceList({
  devices,
  state,
  busy,
  onConnect,
}: {
  devices: BleDevice[];
  state: TransportState;
  busy: boolean;
  onConnect: (id: string) => void;
}) {
  if (devices.length === 0) return null;
  const sorted = [...devices].sort((a, b) => b.rssi - a.rssi);
  return (
    <ul aria-label="Radios found" className="divide-y divide-cs-border overflow-y-auto rounded-md border border-cs-border">
      {sorted.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-cs-text">{d.name ?? '(unnamed)'}</span>
            <div className="flex items-center gap-2 font-mono text-[10px] text-cs-text-muted">
              <span className="truncate">{d.id}</span>
              <RssiChip rssi={d.rssi} />
            </div>
          </div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => onConnect(d.id)}
            disabled={busy || state === 'connecting'}
            aria-label={`Connect to ${d.name ?? d.id}`}
          >
            Connect
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Remember the radio we just connected to, for the footer's reconnect and
 *  the disconnected card's Remembered row. */
export function useRememberLastDevice(
  state: TransportState,
  connectedDeviceId: string | undefined,
  devices: BleDevice[],
  knownName: string | null,
): void {
  useEffect(() => {
    if (state !== 'connected' || !connectedDeviceId) return;
    const match = devices.find((d) => d.id === connectedDeviceId);
    saveLastDevice({ id: connectedDeviceId, name: match?.name ?? knownName });
  }, [state, connectedDeviceId, devices, knownName]);
}
