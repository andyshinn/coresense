import { Check, X } from 'lucide-react';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { fmtAge } from '../../../shared/telemetry/format';
import { useNowTick } from '../../hooks/useNowTick';
import { useStore } from '../../lib/store';
import { dayKey, fmtDateTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import {
  compareDetail,
  dayLabel,
  fmtClock,
  type RequestChip,
  type RequestSummary,
  requestChip,
  requestDetail,
} from './format';
import { LABEL_CAPS, META, TelemetryChip } from './ui';

export type RequestListMode = 'select' | 'compare';

interface Props {
  /** Saved requests, newest first (the store's order). */
  requests: readonly RequestSummary[];
  /** The request shown on the right; highlighted in select mode. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** `compare` swaps the selection for checkboxes; failed requests can't be ticked. */
  mode?: RequestListMode;
  compareIds?: readonly string[];
  /** Compare mode: at this many ticked, the unticked rows are disabled. */
  maxCompare?: number;
  onToggleCompare?: (id: string) => void;
  /** Clock for the ages; defaults to an internal tick. */
  now?: number;
  /** Accessible name of the listbox. */
  label?: string;
  className?: string;
}

/** A row's strings that don't depend on the clock, built once per list/format change. */
interface RowText {
  r: RequestSummary;
  clock: string;
  title: string;
  detail: string;
  chip: RequestChip;
}

interface DayGroup {
  label: string;
  rows: RowText[];
}

function groupByDay(rows: readonly RowText[], now: number): DayGroup[] {
  const out: DayGroup[] = [];
  for (const row of rows) {
    const label = dayLabel(row.r.requestedAt, now);
    const last = out[out.length - 1];
    if (last?.label === label) last.rows.push(row);
    else out.push({ label, rows: [row] });
  }
  return out;
}

const MINUTE = 60_000;

/**
 * "12 s ago". A row under a minute old runs its own 1 s clock, so only it
 * redraws each second; older rows follow the list's 30 s clock.
 */
function RowAge({ ts, now, live, className }: { ts: number; now: number; live: boolean; className?: string }) {
  const fresh = live && Date.now() - ts < MINUTE;
  const tick = useNowTick(fresh ? 1_000 : null);
  return <span className={className}>{fmtAge(ts, live ? Math.max(now, tick) : now)}</span>;
}

/**
 * The saved-request log: rows grouped by day (Today / Yesterday / "Oct 5"),
 * each with its time, age, outcome chip and a detail line. A single-select
 * listbox in `select` mode (selection follows the arrow keys), a
 * multi-select one with checkboxes in `compare` mode. Roving tab stop:
 * Tab enters at the selected (or first) row, ↑/↓/Home/End move.
 */
export function TelemetryRequestList({
  requests,
  selectedId,
  onSelect,
  mode = 'select',
  compareIds,
  maxCompare,
  onToggleCompare,
  now: nowProp,
  label = 'Saved requests',
  className,
}: Props) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  // Minutes are the finest unit the list itself redraws for; RowAge ticks
  // the seconds of a fresh row.
  const tick = useNowTick(nowProp === undefined ? 30_000 : null);
  const now = nowProp ?? tick;
  const live = nowProp === undefined;

  const compare = mode === 'compare';
  const checked = useMemo(() => new Set(compareIds ?? []), [compareIds]);
  const atCap = compare && maxCompare !== undefined && checked.size >= maxCompare;
  const rows = useMemo<RowText[]>(
    () =>
      requests.map((r) => ({
        r,
        clock: fmtClock(r.requestedAt, timeFormat),
        title: fmtDateTime(r.requestedAt, timeFormat),
        detail: requestDetail(r),
        chip: requestChip(r),
      })),
    [requests, timeFormat],
  );
  // Day labels change only at midnight, not with every tick.
  const today = dayKey(now);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `today` stands in for `now`
  const groups = useMemo(() => groupByDay(rows, now), [rows, today]);
  const disabled = (r: RequestSummary) => compare && (r.outcome !== 'ok' || (atCap && !checked.has(r.id)));
  const enabled = useMemo(
    () => requests.filter((r) => !(compare && (r.outcome !== 'ok' || (atCap && !checked.has(r.id))))),
    [requests, compare, atCap, checked],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // The one tab stop: the row last focused if it's still there, else the
  // selected row (select mode), else the first row that can act.
  const tabStop =
    (focusId && enabled.some((r) => r.id === focusId) ? focusId : null) ??
    (!compare && selectedId && requests.some((r) => r.id === selectedId) ? selectedId : null) ??
    enabled[0]?.id ??
    null;

  const activate = (r: RequestSummary) => {
    if (disabled(r)) return;
    if (compare) onToggleCompare?.(r.id);
    else onSelect(r.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return;
    const at = enabled.findIndex((r) => r.id === (focusId ?? tabStop));
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = Math.min(enabled.length - 1, at + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, at < 0 ? 0 : at - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = enabled[next];
    setFocusId(target.id);
    // Ids are UUIDs: nothing to escape in the selector.
    listRef.current?.querySelector<HTMLElement>(`[data-request-id="${target.id}"]`)?.focus();
    // Single select follows focus, like a native <select>.
    if (!compare && target.id !== selectedId) onSelect(target.id);
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      aria-multiselectable={compare || undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn('flex flex-col pb-1', className)}
    >
      {groups.map((g) => (
        // biome-ignore lint/a11y/useSemanticElements: a day heading inside the listbox, not a form fieldset
        <div key={g.label} role="group" aria-label={g.label}>
          <div aria-hidden="true" className={cn(LABEL_CAPS, 'px-3.5 pt-2 pb-0.5')}>
            {g.label}
          </div>
          {g.rows.map(({ r, clock, title, detail, chip }) => {
            const isDisabled = disabled(r);
            const isChecked = checked.has(r.id);
            const isSelected = !compare && r.id === selectedId;
            const metaTone = isSelected ? 'text-cs-text-muted' : undefined;
            return (
              <button
                key={r.id}
                type="button"
                role="option"
                data-request-id={r.id}
                aria-selected={compare ? isChecked : isSelected}
                aria-disabled={isDisabled || undefined}
                tabIndex={r.id === tabStop ? 0 : -1}
                title={title}
                onFocus={() => setFocusId(r.id)}
                onClick={() => activate(r)}
                className={cn(
                  'w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cs-accent',
                  compare ? 'flex items-start gap-2.5 px-3.5 py-1.75' : 'block border-l-2 py-1.75 pr-3.5 pl-3',
                  !compare && (isSelected ? 'border-cs-accent bg-cs-accent-soft/30' : 'border-transparent hover:bg-cs-bg-2'),
                  compare && !isDisabled && 'hover:bg-cs-bg-2',
                  isDisabled && 'cursor-not-allowed opacity-50',
                )}
              >
                {compare && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 grid size-3.5 shrink-0 place-content-center rounded-[4px] border',
                      isChecked ? 'border-cs-accent bg-cs-accent text-cs-bg' : 'border-cs-border-strong bg-cs-bg-3',
                    )}
                  >
                    {isChecked && <Check className="size-3" />}
                  </span>
                )}
                <span className={cn('min-w-0', compare && 'flex-1')}>
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[12px] tabular-nums text-cs-text">{clock}</span>
                    {!compare && <RowAge ts={r.requestedAt} now={now} live={live} className={cn(META, metaTone)} />}
                    <TelemetryChip tone={chip.tone} className="ml-auto self-center">
                      {chip.tone === 'bad' && <X aria-hidden="true" />}
                      {chip.text}
                    </TelemetryChip>
                  </span>
                  <span className={cn(META, metaTone, 'mt-0.5 block truncate')}>
                    {compare ? compareDetail(r, now) : detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
