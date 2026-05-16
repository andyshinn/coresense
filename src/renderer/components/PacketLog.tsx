import { useEffect, useMemo, useRef, useState } from 'react';
import type { RawPacket } from '../../shared/types';
import { type PacketSummary, summarizePacket } from '../lib/decodePacket';

interface Props {
  packets: RawPacket[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString()}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

// Map packet types to Field Console palette tokens. We keep enough distinction
// for log skimming without reintroducing the old rainbow hues.
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

function MeshRow({ packet }: { packet: RawPacket }) {
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
      <span className="shrink-0 text-cs-text-dim">{formatTime(packet.timestamp)}</span>
      <span className="shrink-0 text-cs-text-dim">{packet.payloadBytes.length}B</span>
      <span className={`shrink-0 font-medium ${color}`}>{summary.typeName}</span>
      <span className="shrink-0 text-cs-text-dim">{summary.routeName}</span>
      {link && <span className="shrink-0 text-cs-text-dim">{link}</span>}
      {summary.detail && <span className="shrink-0 text-cs-text-muted">{summary.detail}</span>}
      <span className="break-all text-cs-text-dim/70">{packet.payloadHex}</span>
    </div>
  );
}

function CompanionRow({ packet }: { packet: RawPacket }) {
  return (
    <div className="flex gap-3 py-1">
      <span className="shrink-0 text-cs-text-dim">{formatTime(packet.timestamp)}</span>
      <span className="shrink-0 text-cs-text-dim">{packet.payloadBytes.length}B</span>
      <span className="shrink-0 font-medium text-cs-accent-soft">BLE</span>
      <span className="shrink-0 text-cs-text-muted">{packet.codeName ?? '?'}</span>
      <span className="break-all text-cs-text-dim/70">{packet.payloadHex}</span>
    </div>
  );
}

export function PacketLog({ packets }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showCompanion, setShowCompanion] = useState(false);

  const visible = useMemo(
    () => (showCompanion ? packets : packets.filter((p) => p.kind !== 'companion')),
    [packets, showCompanion],
  );
  const count = visible.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on length-change only.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [count]);

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
              onChange={(e) => setShowCompanion(e.target.checked)}
              className="h-3 w-3 accent-cs-accent"
            />
            Show BLE frames
          </label>
          <span>
            {visible.length} / {packets.length}
          </span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs">
        {visible.length === 0 ? (
          <div className="py-8 text-center text-cs-text-dim">
            No packets received yet — connect to a MeshCore device to start streaming.
          </div>
        ) : (
          visible.map((p, i) =>
            p.kind === 'companion' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only ring buffer; index is stable per render.
              <CompanionRow key={`${p.timestamp}-${p.payloadBytes.length}-${i}`} packet={p} />
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only ring buffer; index is stable per render.
              <MeshRow key={`${p.timestamp}-${p.payloadBytes.length}-${i}`} packet={p} />
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
