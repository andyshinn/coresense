import { useMemo, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { RawPacket, TimeFormatPref } from '../../shared/types';
import { type PacketSummary, summarizePacket } from '../lib/decodePacket';
import { useStore } from '../lib/store';
import { fmtTimePrecise } from '../lib/time';

interface Props {
  packets: RawPacket[];
}

const typeColor: Record<string, string> = {
  Advert: 'text-cs-online',
  'Text Message': 'text-cs-text',
  'Group Text': 'text-cs-accent',
  Ack: 'text-cs-text-dim',
  Path: 'text-cs-warn',
  Trace: 'text-cs-accent',
  Request: 'text-cs-text-muted',
  Response: 'text-cs-text-muted',
  'Anon Request': 'text-cs-text-muted',
  Control: 'text-cs-warn',
  invalid: 'text-cs-danger',
};

function MeshRow({ packet, timeFormat }: { packet: RawPacket; timeFormat: TimeFormatPref }) {
  const summary: PacketSummary = useMemo(
    () => summarizePacket(packet.payloadHex),
    [packet.payloadHex],
  );
  const color = typeColor[summary.typeName] ?? 'text-cs-text-muted';
  const link =
    packet.snr !== undefined && packet.rssi !== undefined
      ? `${packet.rssi}dBm/${packet.snr.toFixed(1)}dB`
      : null;
  return (
    <div className="flex gap-3 py-1">
      <span className="inline-block shrink-0 text-cs-text-dim">
        {fmtTimePrecise(packet.timestamp, timeFormat)}
      </span>
      <span className="inline-block shrink-0 text-cs-text-dim">{packet.payloadBytes.length}B</span>
      <span className={`inline-block shrink-0 font-medium ${color}`}>{summary.typeName}</span>
      <span className="inline-block shrink-0 text-cs-text-dim">{summary.routeName}</span>
      {link && <span className="inline-block shrink-0 text-cs-text-dim">{link}</span>}
      {summary.detail && (
        <span className="inline-block shrink-0 text-cs-text-muted">{summary.detail}</span>
      )}
      <span className="inline-block break-all text-cs-text-dim/70">{packet.payloadHex}</span>
    </div>
  );
}

function CompanionRow({ packet, timeFormat }: { packet: RawPacket; timeFormat: TimeFormatPref }) {
  return (
    <div className="flex gap-3 py-1">
      <span className="inline-block shrink-0 text-cs-text-dim">
        {fmtTimePrecise(packet.timestamp, timeFormat)}
      </span>
      <span className="inline-block shrink-0 text-cs-text-dim">{packet.payloadBytes.length}B</span>
      <span className="inline-block shrink-0 font-medium text-cs-accent-soft">BLE</span>
      <span className="inline-block shrink-0 text-cs-text-muted">{packet.codeName ?? '?'}</span>
      <span className="inline-block break-all text-cs-text-dim/70">{packet.payloadHex}</span>
    </div>
  );
}

export function PacketLog({ packets }: Props) {
  const showCompanion = useStore((s) => s.ui.packetLogFilter.showCompanion);
  const setPacketLogFilter = useStore((s) => s.setPacketLogFilter);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);

  const visible = useMemo(
    () => (showCompanion ? packets : packets.filter((p) => p.kind !== 'companion')),
    [packets, showCompanion],
  );

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded border border-cs-border bg-cs-bg-2">
      <header className="flex items-center justify-between border-b border-cs-border px-4 py-2">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wide text-cs-text-dim">
          Raw packets
        </h2>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wide text-cs-text-dim">
          <label className="flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              checked={showCompanion}
              onChange={(e) => setPacketLogFilter({ showCompanion: e.target.checked })}
              className="h-3 w-3 accent-cs-accent"
            />
            Show BLE frames
          </label>
          <span>
            {visible.length} / {packets.length}
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 px-4 py-2 font-mono text-xs">
        {visible.length === 0 ? (
          <div className="py-8 text-center text-cs-text-dim">
            No packets received yet — connect to a MeshCore device to start streaming.
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={visible}
            followOutput="auto"
            initialTopMostItemIndex={visible.length - 1}
            style={{ height: '100%' }}
            itemContent={(_, p) =>
              p.kind === 'companion' ? (
                <CompanionRow packet={p} timeFormat={timeFormat} />
              ) : (
                <MeshRow packet={p} timeFormat={timeFormat} />
              )
            }
          />
        )}
      </div>
    </section>
  );
}
