import { useEffect, useRef } from 'react';
import type { RawPacket } from '../../shared/types';

interface Props {
  packets: RawPacket[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString()}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

export function PacketLog({ packets }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const count = packets.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on length-change only.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [count]);

  return (
    <section className="flex flex-1 flex-col rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Raw packets
        </h2>
        <span className="text-xs text-slate-500">{packets.length} shown</span>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs">
        {packets.length === 0 ? (
          <div className="py-8 text-center text-slate-500">
            No packets received yet — connect to a MeshCore device to start streaming.
          </div>
        ) : (
          packets.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only ring buffer; index is stable per render.
            <div key={`${p.timestamp}-${p.bytes.length}-${i}`} className="flex gap-3 py-1">
              <span className="shrink-0 text-slate-500">{formatTime(p.timestamp)}</span>
              <span className="shrink-0 text-slate-400">{p.bytes.length}B</span>
              <span className="break-all text-slate-200">{p.hex}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
