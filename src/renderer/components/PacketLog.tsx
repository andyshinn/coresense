import {
  type ItemContent,
  type ItemLocation,
  type ItemLocationCallback,
  type ListScrollLocation,
  scrollToBottomIfAtBottom,
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  type VirtuosoMessageListProps,
} from '@virtuoso.dev/message-list';
import { Layers, Radio, Search, Waypoints } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { summarizeBleFrame } from '../lib/bleFrameLayouts';
import { type PacketSummary, summarizePacket } from '../lib/decodePacket';
import { spaceWords } from '../lib/packetInspect';
import { type LivePacket, type PacketLogView, useStore } from '../lib/store';
import { fmtTimePrecise } from '../lib/time';
import { VIRTUOSO_LICENSE_KEY } from '../lib/virtuosoLicense';

interface Props {
  packets: LivePacket[];
}

interface RowContext {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const GRID = 'grid-cols-[70px_112px_minmax(0,1fr)_92px_30px]';

const NEWEST: ItemLocation = { index: 'LAST', align: 'end' };

/**
 * Follow new packets only while the viewport is at the bottom, so a user scrolled
 * up to inspect an older packet keeps their place.
 *
 * Also follow while the list hasn't reported a scroll location yet
 * (`scrollHeight` 0). That's the first few frames after a mount, while it's still
 * landing on NEWEST. `scrollToBottomIfAtBottom` alone reads "not at bottom" there,
 * so a packet arriving mid-landing would be skipped. The list would then settle a
 * row short, outside the at-bottom threshold, and never follow again. Measured in
 * Chromium: about one frame after a remount, several at low CPU.
 *
 * That catch-up must be instant. The list publishes its first data while it's still
 * landing too, so a 'smooth' here animated the whole log from the top down to the
 * newest packet on every mount.
 */
const followNewPackets: ItemLocationCallback = (params) =>
  scrollToBottomIfAtBottom(params) || (params.scrollLocation.scrollHeight === 0 ? 'auto' : false);

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

const PacketItem: ItemContent<LivePacket, RowContext> = ({ data, context }) => (
  <Row packet={data} selected={context.selectedId === data.id} onSelect={() => context.onSelect(data.id)} />
);

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

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return packets.filter((p) => {
      if (source === 'rf' && p.kind !== 'mesh') return false;
      if (source === 'ble' && p.kind !== 'companion') return false;
      if (!s) return true;
      return `${p.codeName ?? ''} ${p.payloadHex} ${p.rssi ?? ''}`.toLowerCase().includes(s);
    });
  }, [packets, source, q]);

  const onSelect = useCallback(
    (id: string) => {
      setSelectedPacket(selectedId === id ? null : id);
      if (!rightOpen) toggleRightRail();
    },
    [selectedId, setSelectedPacket, rightOpen, toggleRightRail],
  );
  // Stable between packet arrivals. That spares the visible rows a re-render while the
  // buffer is below its cap; once it's full, trimming the head shifts every row's
  // index and they all re-render regardless.
  const context = useMemo<RowContext>(() => ({ selectedId, onSelect }), [selectedId, onSelect]);

  // Return to where the list was when the user switched views and came back. The panel
  // unmounts on every view switch, so the position is kept in session memory. It's
  // recorded as the bottom-most visible packet rather than a pixel offset, so rows added
  // or trimmed while away don't shift it. If that packet has since rolled out of the
  // log (or was at the bottom), land on the newest packet instead. The restore applies
  // only to the list that mounts with the panel; once the list empties (a clear, or a
  // filter with no matches), the refill lands on NEWEST.
  const [restoreTo] = useState((): ItemLocation | null => {
    const view = useStore.getState().packetLogView;
    const index = view ? visible.findIndex((p) => p.id === view.anchorId) : -1;
    return view && index >= 0 ? { index, align: 'end', offset: view.anchorBottomOffset } : null;
  });
  const restoreDone = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const viewRef = useRef<PacketLogView | null>(useStore.getState().packetLogView);
  const hasRows = visible.length > 0;
  useEffect(() => {
    if (hasRows) return;
    // The list unmounted with the empty state, so the refill lands on the newest packet.
    restoreDone.current = true;
    viewRef.current = null;
  }, [hasRows]);
  const landing = restoreTo && !restoreDone.current ? restoreTo : NEWEST;
  const onScroll = useCallback((loc: ListScrollLocation) => {
    const anchor = loc.isAtBottom ? undefined : visibleRef.current[loc.lastVisibleItemIndex];
    viewRef.current = anchor ? { anchorId: anchor.id, anchorBottomOffset: loc.lastItemBottomOffset } : null;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only — checks the selection the panel came back to, and saves the position on the way out.
  useEffect(() => {
    const { selectedPacketId, setSelectedPacket: select, setPacketLogView } = useStore.getState();
    // A remembered selection that has rolled out of the log has nothing left to show.
    if (selectedPacketId && !packets.some((p) => p.id === selectedPacketId)) select(null);
    return () => setPacketLogView(viewRef.current);
  }, []);

  // While restoring, don't chase packets that arrive mid-landing: that would drag the
  // list off the restored position and down to the bottom.
  const listData = useMemo<VirtuosoMessageListProps<LivePacket, RowContext>['data']>(
    () => ({
      data: visible,
      scrollModifier: {
        type: 'auto-scroll-to-bottom',
        autoScroll: landing === NEWEST ? followNewPackets : scrollToBottomIfAtBottom,
      },
    }),
    [visible, landing],
  );

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

      {/* The list lands on the newest packet (or the restored position above) through
          `initialLocation`, the way channel views do, and that only happens when the
          list mounts. Switching views remounts the whole panel. The empty state swaps the list out, so
          hydrate, a clear, or a filter that empties and refills the list each
          mount a fresh one and land again. Keeping the list mounted through an
          empty state (its EmptyPlaceholder) would refill at the top instead:
          `scrollToBottomIfAtBottom` won't scroll an empty list that isn't "at
          the bottom".

          Don't replace this with an imperative scroll on mount. That scroll runs
          before the rows are measured, gets clamped to the unmeasured height, and
          leaves the list stuck near the top. */}
      <div className="min-h-0 flex-1">
        {visible.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] text-cs-text-dim">No packets match this filter.</div>
        ) : (
          <VirtuosoMessageListLicense licenseKey={VIRTUOSO_LICENSE_KEY}>
            <VirtuosoMessageList<LivePacket, RowContext>
              data={listData}
              initialLocation={landing}
              onScroll={onScroll}
              computeItemKey={({ data }) => data.id}
              context={context}
              ItemContent={PacketItem}
              style={{ height: '100%' }}
            />
          </VirtuosoMessageListLicense>
        )}
      </div>
    </section>
  );
}
