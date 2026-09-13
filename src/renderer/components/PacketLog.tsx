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
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TimeFormatPref } from '../../shared/types';
import { summarizeBleFrame } from '../lib/bleFrameLayouts';
import { type PacketSummary, summarizePacket } from '../lib/decodePacket';
import { meshTypeName, spaceWords } from '../lib/packetInspect';
import { columnTemplate, columnWidth, type PacketLogColumn } from '../lib/packetLogColumns';
import { type LivePacket, type PacketLogView, useStore } from '../lib/store';
import { fmtTimePrecise } from '../lib/time';
import { VIRTUOSO_LICENSE_KEY } from '../lib/virtuosoLicense';
import { ColumnResizeHandle } from './packet/ColumnResizeHandle';

interface Props {
  packets: LivePacket[];
}

interface RowContext {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// The header and every row read one template from a CSS variable set on the section
// (see columnTemplate), so resizing a column restyles the rows without re-rendering them.
const GRID = 'grid-cols-(--packet-log-cols)';

const fmtPacketTime = (ts: number, pref: TimeFormatPref) => fmtTimePrecise(ts, pref).replace(/\.\d+/, '');

/**
 * The width the time column needs to show a whole time in the current format, measured
 * in the row's own font: "22:58:58" in 24-hour, "10:58:58 PM" in 12-hour, or whatever
 * the locale produces for 'auto'. Null until measured (and under jsdom, which has no
 * layout), which falls back to the default width. Re-measures when the font finishes
 * loading and the sample resizes.
 */
function useFittedTimeWidth(pref: TimeFormatPref) {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const sample = useMemo(() => {
    const day = new Date(2000, 0, 1);
    const [am, pm] = [10, 22].map((h) => fmtPacketTime(day.setHours(h, 58, 58), pref));
    return am.length >= pm.length ? am : pm;
  }, [pref]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sample is the re-measure trigger; the span renders it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setWidth(w > 0 ? Math.ceil(w) + 2 : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sample]);
  return { ref, sample, width };
}

/** What the search box matches against: the kind, the displayed type, both hex forms
 *  and RSSI. Cached per packet object (packets are never mutated), so a new arrival or
 *  a keystroke doesn't rebuild the string for all 20,000 packets. */
const searchText = new WeakMap<LivePacket, string>();
function searchTextOf(p: LivePacket): string {
  let text = searchText.get(p);
  if (text === undefined) {
    const type =
      p.kind === 'companion' ? `${p.codeName ?? ''} ${(p.codeName ?? '').replace(/_/g, ' ')}` : meshTypeName(p.payloadHex);
    text = `${p.kind} ${type} ${p.hex} ${p.payloadHex} ${p.rssi ?? ''}`.toLowerCase();
    searchText.set(p, text);
  }
  return text;
}

const COLUMN_LABELS: { column: PacketLogColumn | null; label: string; edge?: 'left' | 'right' }[] = [
  { column: 'time', label: 'TIME', edge: 'right' },
  { column: 'type', label: 'TYPE', edge: 'right' },
  // Details takes whatever the fixed columns leave, so it has no handle of its own.
  { column: null, label: 'DETAILS' },
  { column: 'rssi', label: 'RSSI/SNR', edge: 'left' },
  { column: 'hop', label: 'HOP', edge: 'left' },
];

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
      <span className="truncate font-mono text-[11px] text-cs-text-dim">{fmtPacketTime(packet.timestamp, timeFormat)}</span>
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
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const columns = useStore((s) => s.packetLogColumns);
  const setColumnWidth = useStore((s) => s.setPacketLogColumnWidth);
  const fittedTime = useFittedTimeWidth(timeFormat);
  const [q, setQ] = useState('');

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return packets.filter((p) => {
      if (source === 'rf' && p.kind !== 'mesh') return false;
      if (source === 'ble' && p.kind !== 'companion') return false;
      if (!s) return true;
      return searchTextOf(p).includes(s);
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
  // A selection that has rolled out of the log (while away, or evicted from the head
  // while watching) has nothing left to show. Newest packets are the likeliest pick,
  // so search from the end.
  useEffect(() => {
    const { selectedPacketId, setSelectedPacket: select } = useStore.getState();
    if (!selectedPacketId) return;
    for (let i = packets.length - 1; i >= 0; i--) if (packets[i].id === selectedPacketId) return;
    select(null);
  }, [packets]);
  useEffect(() => () => useStore.getState().setPacketLogView(viewRef.current), []);

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
    <section
      className="flex min-h-0 flex-1 flex-col"
      style={{ '--packet-log-cols': columnTemplate(columns, fittedTime.width) } as CSSProperties}
    >
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
              aria-pressed={source === k}
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
        className={`relative grid ${GRID} shrink-0 gap-2 border-b border-l-2 border-cs-border border-l-transparent px-3.5 py-1.5 font-mono text-[9.5px] tracking-wide text-cs-text-dim`}
      >
        {COLUMN_LABELS.map(({ column, label, edge }) => (
          <span key={label} className="relative min-w-0">
            <span className={`block truncate ${column === 'hop' ? 'text-right' : ''}`}>{label}</span>
            {column && edge && (
              <ColumnResizeHandle
                edge={edge}
                label={label.toLowerCase()}
                width={columnWidth(column, columns, fittedTime.width)}
                resized={columns[column] != null}
                onChange={(w) => setColumnWidth(column, w)}
                onReset={() => setColumnWidth(column, null)}
              />
            )}
          </span>
        ))}
        {/* Measures a whole time in the rows' font; see useFittedTimeWidth. */}
        <span
          ref={fittedTime.ref}
          aria-hidden
          className="pointer-events-none invisible absolute font-mono text-[11px] whitespace-pre"
        >
          {fittedTime.sample}
        </span>
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
