import { KeyValueGroup, KeyValueRow } from 'coresense';

// Dark "Field Console" surface, sized like the app's right-rail detail panel.
function Surface({ children }) {
  return (
    <div className="w-72 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">{children}</div>
  );
}

export function NodeDetails() {
  return (
    <Surface>
      <KeyValueGroup title="Node">
        <KeyValueRow label="Name" value="Ridgeline Repeater" />
        <KeyValueRow label="Public key" value="a3f9c1d8…2b7e" mono title="a3f9c1d8e4002b7e" />
        <KeyValueRow label="Hardware" value="Heltec V3" />
        <KeyValueRow label="Firmware" value="v1.7.2" mono />
      </KeyValueGroup>
    </Surface>
  );
}

export function Telemetry() {
  return (
    <Surface>
      <KeyValueGroup title="Telemetry">
        <KeyValueRow label="Battery" value="87%" />
        <KeyValueRow label="Voltage" value="4.01 V" mono />
        <KeyValueRow label="SNR" value="+9.5 dB" mono />
        <KeyValueRow label="RSSI" value="-72 dBm" mono />
        <KeyValueRow label="Last heard" value="2m ago" />
      </KeyValueGroup>
    </Surface>
  );
}

export function MonoVsDefault() {
  return (
    <Surface>
      <div className="flex flex-col gap-2">
        <KeyValueRow label="Kind" value="channel" mono />
        <KeyValueRow label="Muted" value="no" />
        <KeyValueRow label="Max hops" value="No limit" mono />
        <KeyValueRow label="Auto-add" value="On" />
      </div>
    </Surface>
  );
}
