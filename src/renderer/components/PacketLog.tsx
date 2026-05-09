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

const typeColor: Record<string, string> = {
  Advert: 'text-emerald-300',
  'Text Message': 'text-sky-300',
  'Group Text': 'text-indigo-300',
  Ack: 'text-slate-400',
  Path: 'text-amber-300',
  Trace: 'text-fuchsia-300',
  Request: 'text-cyan-300',
  Response: 'text-cyan-300',
  'Anon Request': 'text-cyan-300',
  Control: 'text-orange-300',
  invalid: 'text-rose-400',
};

function MeshRow({ packet }: { packet: RawPacket }) {
  const summary: PacketSummary = useMemo(
    () => summarizePacket(packet.payloadHex),
    [packet.payloadHex],
  );
  const color = typeColor[summary.typeName] ?? 'text-slate-300';
  const link =
    packet.snr !== undefined && packet.rssi !== undefined
      ? `${packet.rssi}dBm/${packet.snr.toFixed(1)}dB`
      : null;
  return (
    <div className="flex gap-3 py-1">
      <span className="shrink-0 text-slate-500">{formatTime(packet.timestamp)}</span>
      <span className="shrink-0 text-slate-400">{packet.payloadBytes.length}B</span>
      <span className={`shrink-0 font-medium ${color}`}>{summary.typeName}</span>
      <span className="shrink-0 text-slate-500">{summary.routeName}</span>
      {link && <span className="shrink-0 text-slate-500">{link}</span>}
      {summary.detail && <span className="shrink-0 text-slate-200">{summary.detail}</span>}
      <span className="break-all text-slate-600">{packet.payloadHex}</span>
    </div>
  );
}

function CompanionRow({ packet }: { packet: RawPacket }) {
  return (
    <div className="flex gap-3 py-1">
      <span className="shrink-0 text-slate-500">{formatTime(packet.timestamp)}</span>
      <span className="shrink-0 text-slate-400">{packet.payloadBytes.length}B</span>
      <span className="shrink-0 font-medium text-violet-300">BLE</span>
      <span className="shrink-0 text-slate-300">{packet.codeName ?? '?'}</span>
      <span className="break-all text-slate-600">{packet.payloadHex}</span>
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
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Raw packets
        </h2>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <label className="flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              checked={showCompanion}
              onChange={(e) => setShowCompanion(e.target.checked)}
              className="h-3 w-3 accent-sky-500"
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
          <div className="py-8 text-center text-slate-500">
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
