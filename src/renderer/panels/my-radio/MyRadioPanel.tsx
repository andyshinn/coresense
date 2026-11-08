import { Bluetooth, ChevronLeft, Radio, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isGpsValue } from '../../../shared/telemetry/lpp';
import { Identicon } from '../../features/quick-actions/Identicon';
import { fmtClock } from '../../features/telemetry/format';
import { TelemetryPanel, useTelemetryRequest } from '../../features/telemetry/TelemetryPanel';
import { LABEL_MONO, META, TelemetryButton } from '../../features/telemetry/ui';
import type { ApiClient } from '../../lib/api';
import { useApiClient } from '../../lib/apiClientContext';
import { useStore } from '../../lib/store';
import { telemetryNoun, useSelectedTelemetryRequest, useTelemetryRequests } from '../../lib/telemetry';
import { cn } from '../../lib/utils';
import { PolicyCard } from './PolicyCard';
import { GpsOffTile, SensorSettingsCard } from './SensorSettings';
import { useSensorSettings } from './useSensorSettings';

// My Node's telemetry view (`tool:node:telemetry`, "View all" on the
// Telemetry card): the connected companion's saved readings — read over the
// local link, no airtime — plus who may read it and its sensor settings. The
// per-contact flags table lives in the right rail.

const LINK =
  'text-[11px] text-cs-accent underline underline-offset-2 hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50';

/** "BLE" / "USB", from the frames the radio last sent (BLE is the only link CoreSense opens today). */
function useLinkName(): string {
  return useStore((s) => (s.packets[s.packets.length - 1]?.transportType === 'serial' ? 'USB' : 'BLE'));
}

function NoRadio() {
  const setActiveKey = useStore((s) => s.setActiveKey);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Bluetooth aria-hidden="true" className="size-5 text-cs-text-dim" />
      <p className="max-w-sm text-[12px] leading-[18px] text-cs-text-dim">
        No radio connected. Connect one to read its telemetry and choose who else can.
      </p>
      <TelemetryButton onClick={() => setActiveKey('tool:node')}>Connect a radio</TelemetryButton>
    </div>
  );
}

interface ActionRowProps {
  client: ApiClient | null;
  nodeKey: string;
  connected: boolean;
  logOpen: boolean;
  onToggleLog: () => void;
}

/** "MY TELEMETRY · read over BLE at 21:31:02 · no airtime used · 14 saved reads · [Read telemetry]" */
function ActionRow({ client, nodeKey, connected, logOpen, onToggleLog }: ActionRowProps) {
  const control = useTelemetryRequest({ source: 'companion', nodeKey, client });
  const count = useTelemetryRequests(nodeKey).length;
  const shown = useSelectedTelemetryRequest(nodeKey);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const link = useLinkName();

  const caption = !shown
    ? `reads over ${link} · no airtime used`
    : shown.outcome === 'ok'
      ? `read over ${link} at ${fmtClock(shown.requestedAt, timeFormat)} · no airtime used`
      : `last read failed at ${fmtClock(shown.requestedAt, timeFormat)}`;
  const hint = !connected ? 'Connect your radio to read it' : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-cs-border px-5 py-2.5">
      <h3 className={cn(LABEL_MONO, 'text-[11px] font-semibold text-cs-text')}>My telemetry</h3>
      <span className={cn(META, 'ml-auto text-cs-text-muted')}>{hint ?? caption}</span>
      {(count > 0 || logOpen) && (
        <button type="button" onClick={onToggleLog} aria-expanded={logOpen} className={LINK}>
          {count} saved {telemetryNoun('companion', count)}
        </button>
      )}
      <TelemetryButton
        onClick={() => void control.request()}
        disabled={control.disabled || !connected}
        title={hint ?? undefined}
      >
        <RefreshCw aria-hidden="true" />
        {control.label}
      </TelemetryButton>
    </div>
  );
}

export function MyRadioPanel() {
  const client = useApiClient();
  const setActiveKey = useStore((s) => s.setActiveKey);
  const owner = useStore((s) => s.owner);
  const connected = useStore((s) => s.transportState === 'connected');
  const gpsLat = useStore((s) => s.deviceIdentity.lat);
  const gpsLon = useStore((s) => s.deviceIdentity.lon);
  const sensors = useSensorSettings(client, connected);
  const [logOpen, setLogOpen] = useState(false);

  const nodeKey = owner?.publicKeyHex ?? '';
  const shown = useSelectedTelemetryRequest(nodeKey || null);
  // 0,0 is the radio's "no position set", not a point off West Africa.
  const advertPosition = useMemo(
    () => (gpsLat !== null && gpsLon !== null && (gpsLat !== 0 || gpsLon !== 0) ? { lat: gpsLat, lon: gpsLon } : null),
    [gpsLat, gpsLon],
  );

  // GPS fitted but switched off, and the shown read has no position: say so on ch 1.
  const vars = sensors.settings.status === 'ok' ? sensors.settings.vars : null;
  const shownHasGps = useMemo(() => shown?.readings.some((r) => r.ch === 1 && isGpsValue(r.value)) ?? false, [shown]);
  const gpsOff = vars?.gps === '0' && !shownHasGps;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-cs-border bg-cs-bg-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setActiveKey('tool:node')}
          className="flex shrink-0 items-center gap-1 rounded-sm text-[11px] text-cs-accent hover:underline focus-visible:outline-1 focus-visible:outline-cs-accent"
        >
          <ChevronLeft aria-hidden="true" className="size-3.5" />
          My node
        </button>
        <span aria-hidden="true" className="h-5 w-px bg-cs-border" />
        {owner ? (
          <Identicon hex={owner.publicKeyHex} size={28} />
        ) : (
          <Radio size={14} aria-hidden="true" className="text-cs-text-muted" />
        )}
        <div className="flex min-w-0 flex-col">
          <h2 className="font-medium leading-tight text-cs-text">Telemetry</h2>
          <span className="truncate font-mono text-[10px] text-cs-text-dim">
            {owner ? `${owner.name} · companion · ${owner.publicKeyHex.slice(0, 6)}` : 'companion'}
          </span>
        </div>
      </header>

      {!owner ? (
        <NoRadio />
      ) : (
        <>
          <ActionRow
            client={client}
            nodeKey={nodeKey}
            connected={connected}
            logOpen={logOpen}
            onToggleLog={() => setLogOpen((o) => !o)}
          />
          <div className="min-h-0 flex-1">
            <TelemetryPanel
              source="companion"
              nodeKey={nodeKey}
              client={client}
              nodeName={owner.name}
              advertPosition={advertPosition}
              showLog={logOpen}
              requestInLog={false}
              // Under "My telemetry" (h3); the policy and sensor cards stay h3 siblings.
              headingLevel={4}
              selfTile={gpsOff ? <GpsOffTile /> : undefined}
            >
              <PolicyCard client={client} connected={connected} />
              <SensorSettingsCard control={sensors} connected={connected} />
            </TelemetryPanel>
          </div>
        </>
      )}
    </div>
  );
}
