import { RefreshCw, Wifi } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { NumberInput, Row, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from './shared';

const eqProxy = (a: AppSettingsType, b: AppSettingsType) => {
  const x = a.proxy;
  const y = b.proxy;
  return (
    x.enabled === y.enabled && x.bindAll === y.bindAll && x.port === y.port && x.mdns === y.mdns
  );
};

export function ProxySection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const bridge = useStore((s) => s.bridge);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-proxy',
    saved,
    eq: eqProxy,
    onSave: (d) => saveApp(client, { proxy: d.proxy }, 'Proxy settings saved'),
  });
  const p = draft.proxy;
  const p0 = saved.proxy;
  const setP = (patch: Partial<AppSettingsType['proxy']>) =>
    setDraft((s) => ({ ...s, proxy: { ...s.proxy, ...patch } }));

  // Listeners are bound at startup, so a saved change that doesn't match the
  // currently-running bridge means the user needs to restart. Compare against
  // BridgeStatus rather than tracking a local "saved at mount" snapshot so the
  // banner is correct after revisiting the panel.
  const runningEnabled = bridge?.tcpPort != null;
  const runningBindAll = bridge?.bindAddress === '0.0.0.0';
  const runningMdns = bridge?.mdnsServiceName != null;
  const restartNeeded =
    !!bridge &&
    !dirty &&
    (p0.enabled !== runningEnabled ||
      (p0.enabled && p0.bindAll !== runningBindAll) ||
      (p0.enabled && p0.port !== bridge.tcpPort) ||
      (p0.enabled && p0.mdns !== runningMdns));

  const relaunch = () => {
    if (!client) return;
    void api.relaunchApp(client);
  };

  return (
    <SettingsSection
      id="app-proxy"
      icon={Wifi}
      title="TCP Proxy"
      description="Lets the official MeshCore mobile app (or another desktop client) share this radio over LAN."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      {restartNeeded && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded border border-cs-warn/40 bg-cs-warn/10 px-2.5 py-1.5 text-[11px] text-cs-warn">
          <span>Bridge settings changed. Restart the app to apply.</span>
          <button
            type="button"
            onClick={relaunch}
            disabled={!client}
            className="inline-flex items-center gap-1 rounded border border-cs-warn/60 bg-cs-warn/20 px-2 py-0.5 text-[11px] font-medium hover:bg-cs-warn/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className="size-3" aria-hidden />
            Relaunch
          </button>
        </div>
      )}
      <Row
        label="Enabled"
        changed={p.enabled !== p0.enabled}
        control={<Toggle checked={p.enabled} onChange={(v) => setP({ enabled: v })} />}
      />
      <Row
        label="Bind to all interfaces (0.0.0.0)"
        description="Off binds to 127.0.0.1 only; on allows LAN clients to connect."
        warning={
          p.bindAll ? 'Anyone on your network can connect to this radio without auth.' : undefined
        }
        changed={p.bindAll !== p0.bindAll}
        control={
          <Toggle
            checked={p.bindAll}
            disabled={!p.enabled}
            onChange={(v) => setP({ bindAll: v })}
          />
        }
      />
      <Row
        label="TCP port"
        description="Port the bridge listens on for raw TCP proxy clients."
        changed={p.port !== p0.port}
        control={
          <NumberInput
            value={p.port}
            min={1}
            max={65535}
            disabled={!p.enabled}
            onChange={(v) => setP({ port: v })}
          />
        }
      />
      <Row
        label="Advertise via mDNS"
        description="So clients on the LAN can find this radio by name without hard-coding the IP."
        changed={p.mdns !== p0.mdns}
        control={
          <Toggle checked={p.mdns} disabled={!p.enabled} onChange={(v) => setP({ mdns: v })} />
        }
      />
    </SettingsSection>
  );
}
