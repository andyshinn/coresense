import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';
import { Binary, Copy, Route, Unlock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../../lib/api';
import { inspectBleFrame } from '../../lib/bleFrameLayouts';
import { inspectPacket } from '../../lib/packetInspect';
import { useStore } from '../../lib/store';
import { fmtDateTime } from '../../lib/time';
import { KeyValueRow } from '../ui/KeyValueRow';
import { PacketBreakdown } from './PacketBreakdown';

function useKeyStore() {
  const channels = useStore((s) => s.channels);
  return useMemo(() => {
    const secrets = channels.map((c) => c.secretHex).filter((x): x is string => !!x);
    return secrets.length ? MeshCoreDecoder.createKeyStore({ channelSecrets: secrets }) : undefined;
  }, [channels]);
}

function CopyHash({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1100);
      }}
      title="Copy hash"
      className={`inline-flex items-center gap-1.5 font-mono text-[12.5px] ${done ? 'text-cs-online' : 'text-cs-accent'}`}
    >
      <span className="truncate">{text}</span>
      <Copy size={13} />
    </button>
  );
}

export function PacketDetailsRail({ client: _client }: { client: ApiClient | null }) {
  const selectedId = useStore((s) => s.selectedPacketId);
  const packet = useStore((s) => s.packets.find((p) => p.id === s.selectedPacketId) ?? null);
  const radio = useStore((s) => s.radioSettings);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const setDecoderOpen = useStore((s) => s.setDecoderOpen);
  const keyStore = useKeyStore();
  const [hovered, setHovered] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedId is the reset trigger, not read in the body — field keys (pk0, pl0, …) repeat across packets so hover state must clear on selection change.
  useEffect(() => setHovered(null), [selectedId]);

  // Decode once per selected packet (not on every hover) — packet reference
  // is stable across hovers and only changes when the selection changes.
  const d = useMemo(
    () =>
      packet && packet.kind !== 'companion' ? inspectPacket(packet.payloadHex, keyStore ? { keyStore } : undefined) : null,
    [packet, keyStore],
  );
  const ble = useMemo(
    () => (packet && packet.kind === 'companion' ? inspectBleFrame(packet.payloadHex, packet.codeName) : null),
    [packet],
  );

  if (!packet) {
    return (
      <div className="flex flex-col items-center gap-3.5 px-5 py-12 text-center">
        <Binary size={34} className="text-cs-text-dim opacity-60" />
        <div className="max-w-[220px] text-[12.5px] text-cs-text-muted">
          Select a packet to see its full byte-level breakdown.
        </div>
        <button
          type="button"
          onClick={() => setDecoderOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-2 px-3 py-1.5 text-[12px] text-cs-text"
        >
          <Binary size={14} className="text-cs-accent" /> Decode hex…
        </button>
      </div>
    );
  }

  if (packet.kind === 'companion') {
    if (!ble) return null;
    return (
      <div className="px-3.5 py-3.5" key={selectedId}>
        <div className="mb-1 font-mono text-[10px] tracking-wide text-cs-text-dim">DETAILS</div>
        <div className="rounded-lg border border-cs-border bg-cs-bg-2 px-3 py-2">
          <KeyValueRow label="Frame" value={ble.codeName} mono />
          <KeyValueRow label="Transport" value="BLE / serial companion link" mono />
          <KeyValueRow label="Size" value={`${ble.bytes.length} bytes`} mono />
          <KeyValueRow label="Received" value={fmtDateTime(packet.timestamp, timeFormat)} mono />
        </div>
        <PacketBreakdown
          title="BLE Frame Breakdown"
          count={ble.bytes.length}
          bytes={ble.bytes}
          fields={ble.fields}
          scope="ble"
          hovered={hovered}
          setHovered={setHovered}
        />
      </div>
    );
  }

  if (!d) return null;
  const sec = d.payload?.secondary ?? null;

  return (
    <div className="px-3.5 py-3.5" key={selectedId}>
      <div className="mb-1 font-mono text-[10px] tracking-wide text-cs-text-dim">DETAILS</div>
      <div className="rounded-lg border border-cs-border bg-cs-bg-2 px-3 py-2">
        <KeyValueRow label="Type" value={d.payloadTypeName} />
        <KeyValueRow label="Route" value={d.routeName} mono />
        <KeyValueRow
          label="RSSI / SNR"
          value={packet.rssi == null || packet.snr == null ? '—' : `${packet.rssi} dBm · ${packet.snr} dB`}
          mono
        />
        <KeyValueRow label="Hops" value={d.hops === 0 ? '0 · direct' : String(d.hops)} mono />
        {d.pathArrows && <KeyValueRow label="Path" value={d.pathArrows} mono />}
        <KeyValueRow label="Size" value={`${d.size} bytes`} mono />
        <KeyValueRow label="Received" value={fmtDateTime(packet.timestamp, timeFormat)} mono />
        <KeyValueRow
          label="Radio"
          value={`${(radio.frequencyHz / 1e6).toFixed(3)} MHz · SF${radio.spreadingFactor} / BW${(radio.bandwidthHz / 1000).toFixed(1)} / CR${radio.codingRate}`}
          mono
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10px] tracking-wide text-cs-text-dim">PACKET HASH</span>
        <CopyHash text={d.hashFull} />
        <span className="flex-1" />
        <button
          type="button"
          disabled
          title="Trace path (coming soon)"
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[11px] text-cs-text-dim opacity-60"
        >
          <Route size={13} /> Trace path
        </button>
      </div>

      {d.lowConfidence && (
        <div className="mt-2 rounded-md border border-cs-warn/25 bg-cs-warn/10 px-3 py-2 text-[11.5px] text-cs-text-muted">
          {d.lowConfidence}
        </div>
      )}

      <PacketBreakdown
        title="Packet Byte Breakdown"
        count={d.size}
        bytes={d.bytes}
        fields={d.fields}
        scope="packet"
        hovered={hovered}
        setHovered={setHovered}
      />

      {d.payload && (
        <>
          <PacketBreakdown
            title={`${d.payload.typeName} Payload Byte Breakdown`}
            count={d.payload.bytes.length}
            bytes={d.payload.bytes}
            fields={d.payload.fields}
            scope="payload"
            hovered={hovered}
            setHovered={setHovered}
          />

          {sec?.kind === 'decrypted' && (
            <>
              <div className="mt-5 flex items-center gap-2">
                <span className="text-[13.5px] font-bold text-cs-text">Decrypted Plaintext</span>
                <span className="inline-flex items-center gap-1 rounded border border-cs-online/35 bg-cs-online/10 px-1.5 py-0.5 font-mono text-[9.5px] text-cs-online">
                  <Unlock size={11} /> key held
                </span>
              </div>
              <div className="mt-2.5">
                <PacketBreakdown
                  title=""
                  bytes={sec.bytes}
                  fields={sec.fields}
                  scope="plain"
                  hovered={hovered}
                  setHovered={setHovered}
                />
              </div>
            </>
          )}
          {sec?.kind === 'appdata' && (
            <PacketBreakdown
              title={sec.title}
              count={sec.bytes.length}
              bytes={sec.bytes}
              fields={sec.fields}
              scope="appdata"
              hovered={hovered}
              setHovered={setHovered}
            />
          )}
          {sec?.kind === 'encrypted' && (
            <div className="mt-3 rounded-md border border-cs-accent/25 bg-cs-accent/10 px-3 py-2.5 text-[11.5px] text-cs-text-muted">
              {sec.note}
            </div>
          )}
        </>
      )}
    </div>
  );
}
