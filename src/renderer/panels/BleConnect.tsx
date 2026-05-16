import { Bluetooth, Loader2, Radio, Wifi, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BleDevice, TransportState } from '../../shared/types';
import { RssiChip } from '../components/RssiChip';
import {
  clearLastDevice,
  type LastDevice,
  loadLastDevice,
  saveLastDevice,
} from '../lib/lastDevice';
import { cn } from '../lib/utils';

type TransportKind = 'ble' | 'serial' | 'tcp';

interface Props {
  state: TransportState;
  devices: BleDevice[];
  connectedDeviceId?: string;
  onScan: () => void;
  onConnect: (deviceId: string) => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
  busy: boolean;
}

export function BleConnect(props: Props) {
  const [transport, setTransport] = useState<TransportKind>('ble');

  return (
    <section className="flex h-full flex-col gap-4 overflow-hidden border-r border-cs-border bg-cs-bg-2 p-4 lg:w-96">
      <header>
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-cs-text-muted">
          Radio connection
        </h2>
      </header>

      <TransportTabs value={transport} onChange={setTransport} />

      {transport === 'ble' && <BleFlow {...props} />}
      {transport === 'serial' && (
        <ComingSoon label="USB serial transport will land in a follow-up." />
      )}
      {transport === 'tcp' && <ComingSoon label="WiFi / TCP transport will land in a follow-up." />}
    </section>
  );
}

function TransportTabs({
  value,
  onChange,
}: {
  value: TransportKind;
  onChange: (v: TransportKind) => void;
}) {
  const tabs: { id: TransportKind; label: string; icon: typeof Bluetooth; disabled?: boolean }[] = [
    { id: 'ble', label: 'BLE', icon: Bluetooth },
    { id: 'serial', label: 'Serial', icon: Radio, disabled: true },
    { id: 'tcp', label: 'WiFi / TCP', icon: Wifi, disabled: true },
  ];
  return (
    <div role="tablist" className="flex gap-1 rounded border border-cs-border bg-cs-bg p-1">
      {tabs.map((t) => {
        const active = value === t.id;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={t.disabled}
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.id)}
            className={cn(
              'flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors',
              active && 'bg-cs-bg-3 text-cs-text shadow-sm',
              !active && !t.disabled && 'text-cs-text-muted hover:text-cs-text',
              t.disabled && 'cursor-not-allowed text-cs-text-dim opacity-60',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon size={12} aria-hidden="true" />
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded border border-dashed border-cs-border text-center text-xs text-cs-text-dim">
      <p className="max-w-[16rem] p-6 leading-relaxed">{label}</p>
    </div>
  );
}

function BleFlow({
  state,
  devices,
  connectedDeviceId,
  onScan,
  onConnect,
  onDisconnect,
  busy,
}: Props) {
  const [lastDevice, setLastDevice] = useState<LastDevice | null>(() => loadLastDevice());

  // When we transition into a connected state, remember the device for next time.
  useEffect(() => {
    if (state !== 'connected' || !connectedDeviceId) return;
    const match = devices.find((d) => d.id === connectedDeviceId);
    const entry = { id: connectedDeviceId, name: match?.name ?? lastDevice?.name ?? null };
    saveLastDevice(entry);
    setLastDevice(entry);
  }, [state, connectedDeviceId, devices, lastDevice?.name]);

  const sortedDevices = useMemo(() => [...devices].sort((a, b) => b.rssi - a.rssi), [devices]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <StatusLine state={state} />

      {state === 'connected' ? (
        <ConnectedCard
          deviceId={connectedDeviceId}
          name={devices.find((d) => d.id === connectedDeviceId)?.name ?? lastDevice?.name ?? null}
          busy={busy}
          onDisconnect={() => void onDisconnect()}
          onForget={() => {
            clearLastDevice();
            setLastDevice(null);
          }}
        />
      ) : (
        <>
          {lastDevice && state !== 'scanning' && state !== 'connecting' && (
            <ReconnectCard
              device={lastDevice}
              busy={busy}
              onReconnect={() => void onConnect(lastDevice.id)}
              onForget={() => {
                clearLastDevice();
                setLastDevice(null);
              }}
            />
          )}

          <ScanButton state={state} busy={busy} onScan={onScan} />

          <DeviceList
            devices={sortedDevices}
            state={state}
            busy={busy}
            onConnect={(id) => void onConnect(id)}
          />
        </>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<TransportState, string> = {
  idle: 'Ready',
  scanning: 'Scanning for radios…',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Error',
};

const STATUS_DOT: Record<TransportState, string> = {
  idle: 'bg-cs-text-dim',
  scanning: 'bg-cs-warn animate-pulse',
  connecting: 'bg-cs-accent animate-pulse',
  connected: 'bg-cs-online',
  error: 'bg-cs-danger',
};

function StatusLine({ state }: { state: TransportState }) {
  return (
    <div className="flex items-center gap-2 text-xs text-cs-text-muted">
      <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[state])} />
      <span>{STATUS_LABEL[state]}</span>
    </div>
  );
}

function ScanButton({
  state,
  busy,
  onScan,
}: {
  state: TransportState;
  busy: boolean;
  onScan: () => void;
}) {
  const scanning = state === 'scanning';
  return (
    <button
      type="button"
      onClick={onScan}
      disabled={busy || scanning || state === 'connecting'}
      className={cn(
        'flex items-center justify-center gap-2 rounded border border-cs-border bg-cs-bg-3 px-3 py-2 text-sm font-medium text-cs-text transition-colors',
        'hover:bg-cs-accent-soft/40 hover:border-cs-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {scanning ? <Loader2 size={14} className="animate-spin" /> : <Bluetooth size={14} />}
      {scanning ? 'Scanning…' : 'Scan for radios'}
    </button>
  );
}

function DeviceList({
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
  if (devices.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded border border-dashed border-cs-border px-4 py-8 text-center text-xs text-cs-text-dim">
        {state === 'scanning' ? (
          <>
            <Loader2 size={20} className="animate-spin text-cs-warn" />
            <p>Listening for MeshCore radios in range…</p>
          </>
        ) : (
          <p>Tap Scan to look for nearby radios.</p>
        )}
      </div>
    );
  }

  return (
    <ul className="flex-1 divide-y divide-cs-border overflow-y-auto rounded border border-cs-border">
      {devices.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-cs-text">{d.name ?? '(unnamed)'}</span>
            <div className="flex items-center gap-2 font-mono text-[10px] text-cs-text-dim">
              <span className="truncate">{d.id}</span>
              <RssiChip rssi={d.rssi} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onConnect(d.id)}
            disabled={busy || state === 'connecting'}
            className="shrink-0 rounded border border-cs-border bg-cs-bg px-2 py-1 text-xs font-medium text-cs-text hover:border-cs-accent hover:text-cs-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Connect
          </button>
        </li>
      ))}
    </ul>
  );
}

function ConnectedCard({
  deviceId,
  name,
  busy,
  onDisconnect,
  onForget,
}: {
  deviceId: string | undefined;
  name: string | null;
  busy: boolean;
  onDisconnect: () => void;
  onForget: () => void;
}) {
  return (
    <div className="rounded border border-cs-online/40 bg-cs-online/[0.06] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-cs-online">
        <span className="h-1.5 w-1.5 rounded-full bg-cs-online" />
        Live link
      </div>
      <div className="text-sm font-medium text-cs-text">{name ?? '(unnamed)'}</div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-cs-text-dim">{deviceId}</div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDisconnect}
          disabled={busy}
          className="rounded border border-cs-border bg-cs-bg px-2 py-1 text-xs font-medium text-cs-text hover:border-cs-danger hover:text-cs-danger disabled:opacity-50"
        >
          Disconnect
        </button>
        <button
          type="button"
          onClick={onForget}
          className="rounded px-2 py-1 text-xs text-cs-text-dim hover:text-cs-text"
        >
          Forget this radio
        </button>
      </div>
    </div>
  );
}

function ReconnectCard({
  device,
  busy,
  onReconnect,
  onForget,
}: {
  device: LastDevice;
  busy: boolean;
  onReconnect: () => void;
  onForget: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded border border-cs-border bg-cs-bg p-2 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate text-cs-text">{device.name ?? '(last radio)'}</div>
        <div className="truncate font-mono text-[10px] text-cs-text-dim">{device.id}</div>
      </div>
      <button
        type="button"
        onClick={onReconnect}
        disabled={busy}
        className="rounded border border-cs-accent/60 bg-cs-accent/10 px-2 py-1 text-cs-accent hover:bg-cs-accent/20 disabled:opacity-50"
      >
        Reconnect
      </button>
      <button
        type="button"
        onClick={onForget}
        title="Forget this radio"
        className="rounded p-1 text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text"
      >
        <X size={12} />
      </button>
    </div>
  );
}
