import { MapPinOff } from 'lucide-react';
import { MarkerShape } from '../../../components/map/markers/MarkerShape';
import { fmtSnr, SignalBars, snrTokenVar } from '../../../components/path/SignalBars';
import {
  NEIGHBOUR_SORTS,
  type NeighbourSortKey,
  type ResolvedNeighbour,
} from '../../../lib/neighbours';

interface NeighbourListProps {
  neighbours: ResolvedNeighbour[]; // already resolved, sorted, and count-sliced
  total: number; // page.total reported by the firmware
  mapShown: boolean;
  sortKey: NeighbourSortKey;
  count: number;
  busy: boolean;
  hasFetched: boolean;
  onSort: (k: NeighbourSortKey) => void;
  onCount: (n: number) => void;
  onFetch: () => void;
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

function fmtSecsAgo(s: number): string {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function NeighbourRow({
  n,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  n: ResolvedNeighbour;
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}) {
  const unknown = n.nameSource === 'unknown';
  const bg = selected ? 'bg-cs-accent-soft/10' : hovered ? 'bg-cs-bg-3' : '';
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(n.pubKeyPrefixHex)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(selected ? null : n.pubKeyPrefixHex)}
      className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${bg} ${
        selected ? 'border-l-2 border-cs-accent' : 'border-l-2 border-transparent'
      }`}
    >
      <span className="shrink-0" style={{ opacity: n.located ? 1 : 0.55 }}>
        <MarkerShape type="repeater" size={22} opacity={unknown ? 0.5 : 1} dashed={unknown} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`truncate text-[13px] ${
              unknown ? 'font-normal italic text-cs-text-dim' : 'font-medium text-cs-text'
            }`}
          >
            {n.name}
          </span>
          {n.nameSource === 'contacts' && (
            <span
              role="img"
              aria-label="Name resolved from contacts"
              title="Name resolved from contacts"
              className="shrink-0 text-cs-text-dim"
            >
              ◇
            </span>
          )}
          {n.ambiguous && (
            <span
              role="img"
              aria-label="Prefix matches more than one contact — best guess"
              title="Prefix matches more than one contact — best guess"
              className="shrink-0 text-cs-warn"
            >
              ⚠
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-cs-text-dim">
          <span className="truncate">{n.pubKeyPrefixHex}</span>
          <span className="opacity-50">·</span>
          <span className="shrink-0">{fmtSecsAgo(n.heardSecsAgo)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <SignalBars snr={n.snrDb} size={13} />
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: `rgb(var(${snrTokenVar(n.snrDb)}))` }}
        >
          {fmtSnr(n.snrDb)}
        </span>
      </span>
    </button>
  );
}

export function NeighbourList({
  neighbours,
  total,
  mapShown,
  sortKey,
  count,
  busy,
  hasFetched,
  onSort,
  onCount,
  onFetch,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
}: NeighbourListProps) {
  const located = mapShown ? neighbours.filter((n) => n.located) : [];
  const locatedIds = new Set(located.map((n) => n.pubKeyPrefixHex));
  const offMap = neighbours.filter((n) => !locatedIds.has(n.pubKeyPrefixHex));

  const fieldCls =
    'h-8 rounded-md border border-cs-border bg-cs-bg-3 px-2.5 font-mono text-[12.5px] text-cs-text outline-none';

  return (
    <div className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-cs-border bg-cs-bg-2">
      {/* Controls */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-cs-border p-3.5">
        <label className="flex flex-col gap-1 text-[11.5px] text-cs-text-muted">
          Order
          <select
            value={sortKey}
            onChange={(e) => onSort(e.target.value as NeighbourSortKey)}
            className={`${fieldCls} cursor-pointer`}
          >
            {Object.entries(NEIGHBOUR_SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2.5">
          <label className="flex w-[70px] shrink-0 flex-col gap-1 text-[11.5px] text-cs-text-muted">
            Count
            <input
              type="number"
              min={1}
              max={64}
              value={count}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(v) && v >= 1 && v <= 64) onCount(v);
              }}
              className={fieldCls}
            />
          </label>
          <button
            type="button"
            onClick={onFetch}
            disabled={busy}
            className="h-8 flex-1 rounded-md border border-cs-border bg-cs-bg-3 text-[12.5px] font-medium text-cs-text transition-colors hover:bg-cs-accent-soft/30 disabled:opacity-50"
          >
            {busy ? 'Fetching…' : 'Fetch neighbours'}
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-cs-border px-3.5 py-2.5">
        <span className="font-mono text-[10px] tracking-widest text-cs-text-dim">NEIGHBOURS</span>
        <span className="font-mono text-[10.5px] text-cs-text-muted">
          {mapShown ? `${located.length} on map · ` : ''}
          {neighbours.length} of {total} heard
        </span>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasFetched ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
            <span className="text-[13px] text-cs-text-muted">No neighbours loaded</span>
            <span className="text-[11px] text-cs-text-dim">
              Press "Fetch neighbours" to query the repeater.
            </span>
          </div>
        ) : (
          <>
            {located.map((n) => (
              <NeighbourRow
                key={n.pubKeyPrefixHex}
                n={n}
                selected={selectedId === n.pubKeyPrefixHex}
                hovered={hoveredId === n.pubKeyPrefixHex}
                onHover={onHover}
                onSelect={onSelect}
              />
            ))}
            {offMap.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-3 font-mono text-[9.5px] uppercase tracking-wider text-cs-text-dim">
                  <MapPinOff size={11} aria-hidden="true" />
                  <span className="flex-1">No location advert</span>
                  <span>{offMap.length}</span>
                </div>
                {offMap.map((n) => (
                  <NeighbourRow
                    key={n.pubKeyPrefixHex}
                    n={n}
                    selected={selectedId === n.pubKeyPrefixHex}
                    hovered={hoveredId === n.pubKeyPrefixHex}
                    onHover={onHover}
                    onSelect={onSelect}
                  />
                ))}
              </>
            )}
            <div className="h-2" />
          </>
        )}
      </div>
    </div>
  );
}
