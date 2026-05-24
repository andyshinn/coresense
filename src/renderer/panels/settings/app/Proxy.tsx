import { Wifi } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { NumberInput, Row, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
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

  return (
    <SettingsSection
      id="app-proxy"
      icon={Wifi}
      title="TCP / WS Proxy"
      description="Lets the official MeshCore mobile app (or another desktop client) share this radio over LAN."
      footnote="Bind / port / mDNS changes take effect on next launch. Hot-restart coming in a later phase."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
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
        description="Bridge serves both raw TCP and WS on this port."
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
