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
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${bg} ${
        selected ? 'border-l-2 border-cs-accent' : 'border-l-2 border-transparent'
      }`}
    >
      <span className="shrink-0" style={{ opacity: n.located ? 1 : 0.55 }}>
        <MarkerShape type="repeater" size={20} opacity={unknown ? 0.5 : 1} dashed={unknown} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`truncate text-[12.5px] ${
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
        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-cs-text-dim">
          <span className="truncate">{n.pubKeyPrefixHex}</span>
          <span className="opacity-50">·</span>
          <span className="shrink-0">{fmtSecsAgo(n.heardSecsAgo)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <SignalBars snr={n.snrDb} size={12} />
        <span
          className="font-mono text-[10.5px] tabular-nums"
          style={{ color: `rgb(var(${snrTokenVar(n.snrDb)}))` }}
        >
          {fmtSnr(n.snrDb)}
        </span>
      </span>
    </button>
  );
}

/** Neighbour list rendered as a right-rail section body: Order / Count / Fetch
 *  controls, a counts line, then located rows followed by an off-map group.
 *  Flowing layout (no fixed-width panel) so it fits the rail's collapsible
 *  section; rows bleed to the rail edges via -mx-3. */
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
    'h-8 w-full rounded-md border border-cs-border bg-cs-bg-2 px-2.5 font-mono text-[12px] text-cs-text outline-none';

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="space-y-2">
        <label className="flex flex-col gap-1 text-[11px] text-cs-text-muted">
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
        <div className="flex items-end gap-2">
          <label className="flex w-16 shrink-0 flex-col gap-1 text-[11px] text-cs-text-muted">
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
            className="h-8 flex-1 rounded-md border border-cs-border bg-cs-bg-2 text-[12px] font-medium text-cs-text transition-colors hover:bg-cs-accent-soft/30 disabled:opacity-50"
          >
            {busy ? 'Fetching…' : 'Fetch neighbours'}
          </button>
        </div>
      </div>

      {/* Counts (the rail section header already reads "Neighbours") */}
      {hasFetched && neighbours.length > 0 && (
        <div className="text-right font-mono text-[10px] text-cs-text-dim">
          {mapShown ? `${located.length} on map · ` : ''}
          {neighbours.length} of {total} heard
        </div>
      )}

      {/* Body */}
      {!hasFetched ? (
        <p className="py-3 text-center text-[11px] text-cs-text-dim">
          Press “Fetch neighbours” to query the repeater.
        </p>
      ) : neighbours.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-cs-text-dim">No neighbours reported.</p>
      ) : (
        <div className="-mx-3">
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
              <div className="flex items-center gap-2 px-3 pb-1 pt-2.5 font-mono text-[9.5px] uppercase tracking-wider text-cs-text-dim">
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
        </div>
      )}
    </div>
  );
}
