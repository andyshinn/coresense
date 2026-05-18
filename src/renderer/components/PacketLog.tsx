import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RawPacket } from '../../shared/types';
import { type PacketSummary, summarizePacket } from '../lib/decodePacket';
import { useStore } from '../lib/store';

interface Props {
  packets: RawPacket[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString()}.${d.getMilliseconds().toString().padStart(3, '0')}`;
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

const STICK_THRESHOLD_PX = 24;
const ESTIMATED_ROW_HEIGHT = 22;

export function PacketLog({ packets }: Props) {
  const showCompanion = useStore((s) => s.ui.packetLogFilter.showCompanion);
  const setPacketLogFilter = useStore((s) => s.setPacketLogFilter);

  const visible = useMemo(
    () => (showCompanion ? packets : packets.filter((p) => p.kind !== 'companion')),
    [packets, showCompanion],
  );
  const count = visible.length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 12,
  });

  // Track whether the user is parked near the bottom; if so, follow new rows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setStick(dist <= STICK_THRESHOLD_PX);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-follow new rows when stuck to the bottom. useLayoutEffect to avoid a
  // visible jump; the virtualizer's scrollToIndex is cheaper than scrollIntoView
  // because it only touches the scroll container.
  useLayoutEffect(() => {
    if (!stick || count === 0) return;
    virtualizer.scrollToIndex(count - 1, { align: 'end' });
  }, [count, stick, virtualizer]);

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs">
        {count === 0 ? (
          <div className="py-8 text-center text-cs-text-dim">
            No packets received yet — connect to a MeshCore device to start streaming.
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const p = visible[vi.index];
              if (!p) return null;
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {p.kind === 'companion' ? <CompanionRow packet={p} /> : <MeshRow packet={p} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
