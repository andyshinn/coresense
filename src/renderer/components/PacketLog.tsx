import { Layers, Radio, Search, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { summarizeBleFrame } from '../lib/bleFrameLayouts';
import { type PacketSummary, summarizePacket } from '../lib/decodePacket';
import { spaceWords } from '../lib/packetInspect';
import { type LivePacket, useStore } from '../lib/store';
import { fmtTimePrecise } from '../lib/time';

interface Props {
  packets: LivePacket[];
}

const GRID = 'grid-cols-[70px_112px_minmax(0,1fr)_92px_30px]';

// Virtuoso can't measure a real container until its ResizeObserver fires (first
// paint in the browser, or never in a layout-less test DOM). `initialItemCount`
// forces it to render this many rows up front regardless of measured size — enough
// to fill one screen so there's no blank flash, but capped well below the packet
// buffer's max (`liveBufferSize` can reach 20,000 — see shared/types.ts) so a big
// buffer never blocks the initial paint on thousands of synchronous DOM nodes.
const INITIAL_RENDER_COUNT = 40;

function badge(packet: LivePacket, summary: PacketSummary | null): { letter: string; varName: string } {
  if (packet.kind === 'companion') return { letter: 'B', varName: '--cs-ble' };
  return summary?.routeName.includes('Direct')
    ? { letter: 'D', varName: '--cs-route-direct' }
    : { letter: 'F', varName: '--cs-route-flood' };
}

function rssiClass(rssi?: number): string {
  if (rssi == null) return 'text-cs-text-dim';
  if (rssi > -80) return 'text-cs-online';
  if (rssi > -96) return 'text-cs-text-muted';
  return 'text-cs-warn';
}

function Row({ packet, selected, onSelect }: { packet: LivePacket; selected: boolean; onSelect: () => void }) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  // Only mesh packets decode as mesh frames; companion (BLE) frames are summarized
  // from their own companion-protocol layout instead (summary stays null for them).
  const summary: PacketSummary | null = useMemo(
    () => (packet.kind === 'companion' ? null : summarizePacket(packet.payloadHex)),
    [packet.payloadHex, packet.kind],
  );
  const b = badge(packet, summary);
  const typeName = summary ? spaceWords(summary.typeName) : (packet.codeName ?? 'BLE').replace(/_/g, ' ');
  const detail = summary ? (summary.detail ?? '') : summarizeBleFrame(packet.payloadHex, packet.codeName);
  const hop = summary ? String(summary.decoded?.pathLength ?? 0) : '—';
  return (
    <button
      type="button"
      data-testid="packet-row"
      onClick={onSelect}
      className={`grid ${GRID} w-full items-center gap-2 border-l-2 px-3.5 py-1.5 text-left ${selected ? 'border-cs-accent bg-cs-bg-3' : 'border-transparent hover:bg-cs-bg-2'} cursor-pointer`}
    >
      <span className="truncate font-mono text-[11px] text-cs-text-dim">
        {fmtTimePrecise(packet.timestamp, timeFormat).replace(/\.\d+/, '')}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="flex size-[18px] shrink-0 items-center justify-center rounded font-mono text-[11px] font-bold"
          style={{ background: `rgb(var(${b.varName}))`, color: 'rgb(var(--cs-bg))' }}
        >
          {b.letter}
        </span>
        <span className="truncate text-[12.5px] text-cs-text">{typeName}</span>
      </span>
      <span className="truncate text-[12.5px] text-cs-text-muted">{detail || '—'}</span>
      <span className={`truncate font-mono text-[11px] ${rssiClass(packet.rssi)}`}>
        {packet.rssi == null || packet.snr == null ? '—' : `${packet.rssi} / ${packet.snr}`}
      </span>
      <span className="text-right font-mono text-[11px] text-cs-text-muted">{hop}</span>
    </button>
  );
}

const SOURCES = [
  { k: 'both', label: 'Both', Icon: Layers },
  { k: 'rf', label: 'RF', Icon: Radio },
  { k: 'ble', label: 'BLE', Icon: Waypoints },
] as const;

export function PacketLog({ packets }: Props) {
  const source = useStore((s) => s.ui.packetLogFilter.source);
  const setPacketLogFilter = useStore((s) => s.setPacketLogFilter);
  const selectedId = useStore((s) => s.selectedPacketId);
  const setSelectedPacket = useStore((s) => s.setSelectedPacket);
  const rightOpen = useStore((s) => s.ui.rightOpen);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const [q, setQ] = useState('');
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return packets.filter((p) => {
      if (source === 'rf' && p.kind !== 'mesh') return false;
      if (source === 'ble' && p.kind !== 'companion') return false;
      if (!s) return true;
      return `${p.codeName ?? ''} ${p.payloadHex} ${p.rssi ?? ''}`.toLowerCase().includes(s);
    });
  }, [packets, source, q]);

  const onSelect = (id: string) => {
    setSelectedPacket(selectedId === id ? null : id);
    if (!rightOpen) toggleRightRail();
  };

  // Land on the newest packet whenever the list (re)mounts (imperative, rather than
  // `initialTopMostItemIndex`, so the initial paint still comes from
  // `initialItemCount` below — combining that prop with an end-anchored
  // `initialTopMostItemIndex` collapses Virtuoso's estimated-height render to a
  // single item in layout-less environments, e.g. jsdom under test).
  //
  // Keyed on the empty → non-empty transition, not on PacketLog's own mount:
  // Virtuoso is swapped out for the empty state whenever `visible` is empty, and
  // this panel is the default view, so it routinely mounts BEFORE the snapshot
  // hydrates. A mount-only effect then saw zero rows, Virtuoso mounted at index 0
  // once packets arrived, and `followOutput="auto"` (which only follows from the
  // bottom) never tracked live traffic. The same happens after a clear or when a
  // filter change empties and refills the list.
  const hasRows = visible.length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire on each Virtuoso mount (empty → non-empty) only; `followOutput` handles appends after that.
  useEffect(() => {
    if (hasRows) virtuosoRef.current?.scrollToIndex({ index: visible.length - 1, align: 'end' });
  }, [hasRows]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-cs-border bg-cs-bg-2 px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-cs-online shadow-[0_0_6px_rgb(var(--cs-online))]" />
          <span className="font-mono text-[11.5px] tracking-wide text-cs-text-muted">RAW PACKETS</span>
        </span>
        <span className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-cs-text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter by kind, hex, RSSI…"
            className="h-7 w-52 rounded border border-cs-border bg-cs-bg-2 pr-2.5 pl-7 text-[12px] text-cs-text outline-none focus:border-cs-accent"
          />
        </div>
        <div className="inline-flex gap-0.5 rounded-md border border-cs-border bg-cs-bg-3 p-0.5">
          {SOURCES.map(({ k, label, Icon }) => (
            <button
              key={k}
              type="button"
              onClick={() => setPacketLogFilter({ source: k })}
              className={`inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11.5px] ${source === k ? 'bg-cs-bg text-cs-text shadow-[inset_0_0_0_1px_rgb(var(--cs-border))]' : 'text-cs-text-muted'}`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] whitespace-nowrap text-cs-text-dim">
          <span className="text-cs-text-muted">{visible.length}</span> / {packets.length}
        </span>
      </header>

      {/* The transparent left border mirrors the row's selection stripe so the column
          labels line up with the row text instead of sitting 2px left of it. */}
      <div
        className={`grid ${GRID} shrink-0 gap-2 border-b border-l-2 border-cs-border border-l-transparent px-3.5 py-1.5 font-mono text-[9.5px] tracking-wide text-cs-text-dim`}
      >
        <span>TIME</span>
        <span>TYPE</span>
        <span>DETAILS</span>
        <span>RSSI/SNR</span>
        <span className="text-right">HOP</span>
      </div>

      <div className="min-h-0 flex-1">
        {visible.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] text-cs-text-dim">No packets match this filter.</div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={visible}
            followOutput="auto"
            initialItemCount={Math.min(visible.length, INITIAL_RENDER_COUNT)}
            style={{ height: '100%' }}
            itemContent={(_, p) => <Row packet={p} selected={selectedId === p.id} onSelect={() => onSelect(p.id)} />}
          />
        )}
      </div>
    </section>
  );
}
