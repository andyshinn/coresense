import { Download, Trash2, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { fmtAge, fmtDuration, fmtSeconds } from '../../../shared/telemetry/format';
import {
  buildCompareTable,
  type CompareCell,
  type CompareGroup,
  type CompareTable,
  compareCsv,
} from '../../../shared/telemetry/previous';
import { type SavedRequestDto, TELEMETRY_RETENTION_BOUNDS, type TelemetrySource } from '../../../shared/telemetry/types';
import type { TimeFormatPref } from '../../../shared/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { KeyValueRow } from '../../components/ui/KeyValueRow';
import { useNowTick } from '../../hooks/useNowTick';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { TELEMETRY_COPY, telemetryNodeKey, telemetryNoun, useTelemetryRetention } from '../../lib/telemetry';
import { fmtTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { telemetryIcon } from './icons';
import { type HeadingLevel, LABEL_CAPS, LABEL_MONO, META, TelemetryButton } from './ui';

// The compare view (History.dc.html): the chosen requests side by side,
// readings as rows grouped by channel, newest column on the left, plus the
// node's saved-request stats and the global retention setting. The request
// list switches to checkboxes in TelemetryPanel; this is the right-hand side.

/** "Oct 9 · 21:29": a compare column's or the oldest request's date and time. */
export function compareWhen(ts: number, pref: TimeFormatPref): string {
  const day = new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} · ${fmtTime(ts, pref)}`;
}

/** `telemetry-<node>-<YYYY-MM-DD>.csv`; the node is its name slugged, or the key's first 8 hex. */
export function compareCsvFilename(nodeKey: string, nodeName: string | undefined, now: number = Date.now()): string {
  const slug = (nodeName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const node = slug || (telemetryNodeKey(nodeKey) ?? nodeKey).slice(0, 8);
  const d = new Date(now);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `telemetry-${node}-${date}.csv`;
}

/** Save `text` as a file via a Blob URL and a throwaway anchor (no file API in the renderer). */
function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // After the click has handed the URL to the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A cell's change against the column to its right. Arrows are neutral, so they carry sr-only words. */
function CellMark({ cell }: { cell: CompareCell }) {
  switch (cell.mark) {
    case 'up':
    case 'down':
      return (
        <>
          <span aria-hidden="true">{cell.mark === 'up' ? '▲' : '▼'} </span>
          <span className="sr-only">{cell.mark === 'up' ? 'up ' : 'down '}</span>
          {cell.magnitude}
        </>
      );
    case 'same':
      return (
        <>
          <span aria-hidden="true">=</span>
          <span className="sr-only">unchanged</span>
        </>
      );
    case 'moved':
      return <>{cell.magnitude ? `moved ${cell.magnitude} m` : 'moved'}</>;
    case 'new':
      return <>new</>;
    default:
      return null;
  }
}

/**
 * Channels that are missing from the oldest selected columns: "Ch 3 first
 * appears at Oct 9 · 21:29". Read from the unfiltered table, so hiding
 * unchanged rows doesn't move the first appearance.
 */
function firstAppearances(table: CompareTable): Array<{ ch: number; at: number }> {
  const last = table.columns.length - 1;
  const out: Array<{ ch: number; at: number }> = [];
  for (const g of table.groups) {
    let oldest = -1;
    for (const row of g.rows) {
      row.cells.forEach((c, i) => {
        if (c.reading && i > oldest) oldest = i;
      });
    }
    if (oldest >= 0 && oldest < last) out.push({ ch: g.ch, at: table.columns[oldest].requestedAt });
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------

interface ClearProps {
  client: ApiClient | null;
  nodeKey: string;
  /** Saved requests the dialog says it will delete. */
  count: number;
  nodeName?: string;
  /** What one saved entry is called: "request" (default) / "read". */
  noun?: string;
  className?: string;
}

/** "Clear saved requests…" plus its confirm dialog (the ContactDetail remove-dialog pattern). */
export function ClearSavedRequests({ client, nodeKey, count, nodeName, noun = 'request', className }: ClearProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nouns = `${noun}s`;

  const onConfirm = async () => {
    if (!client) return;
    setBusy(true);
    try {
      await api.clearTelemetry(client, nodeKey);
      // The telemetryDeleted push does the same; applying it now keeps the
      // view right if that push is lost.
      useStore.getState().applyTelemetryDeleted({ nodeKey, ids: 'all' });
      notify.success(`Saved ${nouns} cleared`);
      setOpen(false);
    } catch (err) {
      notify.error(`Clearing saved ${nouns} failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TelemetryButton
        onClick={() => setOpen(true)}
        disabled={!client || count === 0}
        className={cn('text-cs-trend-down', className)}
      >
        <Trash2 aria-hidden="true" />
        Clear saved {nouns}…
      </TelemetryButton>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear saved {nouns}</DialogTitle>
            <DialogDescription>
              Delete all {count} saved telemetry {count === 1 ? noun : nouns}
              {nodeName ? ` for ${nodeName}` : ''}? Raw bytes go too, so this can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-cs-border bg-cs-bg-2 px-3 py-1.5 text-xs hover:bg-cs-bg-3"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onConfirm()}
              // trend-down, not danger, for the text: danger on its own /10 fill is 3.9:1 in dark.
              className="rounded-md border border-cs-danger bg-cs-danger/10 px-3 py-1.5 text-xs text-cs-trend-down hover:bg-cs-danger/20 disabled:opacity-50"
            >
              Clear
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The global per-node retention (DECISIONS: one AppSettings value, 1–500).
 * Commits on blur or Enter, not per keystroke: typing "120" passes through
 * "1", and main prunes at once on a shrink.
 */
function RetentionInput({ client }: { client: ApiClient | null }) {
  const retention = useTelemetryRetention();
  const [draft, setDraft] = useState(String(retention));
  useEffect(() => setDraft(String(retention)), [retention]);

  const commit = async () => {
    const n = Math.floor(Number(draft));
    if (!client || draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(retention));
      return;
    }
    const keep = Math.min(TELEMETRY_RETENTION_BOUNDS.max, Math.max(TELEMETRY_RETENTION_BOUNDS.min, n));
    setDraft(String(keep));
    if (keep === retention) return;
    try {
      await api.putTelemetryRetention(client, useStore.getState().appSettings, keep);
      notify.success('Retention saved');
    } catch (err) {
      setDraft(String(retention));
      notify.error(`Saving retention failed: ${(err as Error).message}`, err);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') {
      setDraft(String(retention));
      // Blur after the reset lands, so the commit sees the old value.
      const el = e.currentTarget;
      setTimeout(() => el.blur(), 0);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor="telemetry-retention" className="flex flex-col text-[12px] text-cs-text">
          Keep per node
          <span className={META}>applies to all nodes</span>
        </label>
        <input
          id="telemetry-retention"
          type="number"
          inputMode="numeric"
          min={TELEMETRY_RETENTION_BOUNDS.min}
          max={TELEMETRY_RETENTION_BOUNDS.max}
          step={1}
          value={draft}
          disabled={!client}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
          className="ml-auto h-7 w-16 rounded border border-cs-border bg-cs-bg-3 px-2 text-right font-mono text-[12px] tabular-nums text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <p className="text-[11px] leading-4 text-cs-text-muted">
        Oldest requests are dropped past this count. Raw bytes are kept, so saved requests re-decode if the decoder improves.
      </p>
    </div>
  );
}

/** The node's saved-request stats, retention and clear (the mockup's compare rail). */
function SavedRequestStats({
  requests,
  client,
  nodeKey,
  nodeName,
  noun,
}: {
  requests: readonly SavedRequestDto[];
  client: ApiClient | null;
  nodeKey: string;
  nodeName?: string;
  noun: string;
}) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const { failed, oldest, rtt } = useMemo(
    () => ({
      failed: requests.filter((r) => r.outcome !== 'ok').length,
      oldest: requests.length > 0 ? requests[requests.length - 1] : null,
      rtt: median(requests.flatMap((r) => (r.outcome === 'ok' && r.roundTripMs !== null ? [r.roundTripMs] : []))),
    }),
    [requests],
  );
  const title = `Saved ${noun}s`;
  return (
    <aside aria-label={title} className="flex flex-col overflow-hidden rounded-lg border border-cs-border bg-cs-bg-2">
      <div className="border-b border-cs-border px-3.5 py-2.5">
        <span className={cn(LABEL_MONO, 'text-cs-text-dim')}>{title}</span>
      </div>
      <div className="flex flex-col gap-1.5 border-b border-cs-border px-3.5 py-3">
        <KeyValueRow
          label="Saved"
          mono
          value={failed > 0 ? `${requests.length} · ${failed} failed` : String(requests.length)}
        />
        <KeyValueRow label="Oldest" mono value={oldest ? compareWhen(oldest.requestedAt, timeFormat) : '—'} />
        <KeyValueRow label="Median round trip" mono value={rtt !== null ? fmtSeconds(rtt) : '—'} />
        <KeyValueRow label="Storage" mono value="app-side" />
      </div>
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <RetentionInput client={client} />
        <div>
          <ClearSavedRequests client={client} nodeKey={nodeKey} count={requests.length} nodeName={nodeName} noun={noun} />
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

/** One channel: its own <tbody>, so the rowgroup header scopes only this channel's rows. */
function GroupRows({ group, columns }: { group: CompareGroup; columns: number }) {
  return (
    <tbody className="border-b border-cs-border last:border-b-0">
      <tr className="border-b border-cs-border bg-cs-bg-3">
        <th scope="rowgroup" colSpan={columns + 1} className="px-3.5 py-1.5 text-left font-normal">
          <span className="flex items-baseline gap-2">
            <span className={cn(LABEL_MONO, 'text-cs-text')}>Ch {group.ch}</span>
            <span className="text-[12px] font-medium text-cs-text">{group.name}</span>
            {group.drift && (
              <span className="ml-auto inline-flex items-center gap-1 self-center text-[11px] text-[rgb(var(--cs-hop-far))]">
                <TriangleAlert aria-hidden="true" className="size-3" />
                field set changes
              </span>
            )}
          </span>
        </th>
      </tr>
      {group.rows.map((row) => {
        const Icon = telemetryIcon(row.icon);
        return (
          <tr key={row.key} data-testid="compare-row" className="border-b border-cs-border last:border-b-0">
            <th scope="row" className="px-3.5 py-2 text-left font-normal">
              <span className="flex min-w-0 items-center gap-1.5 text-cs-text-dim">
                <Icon aria-hidden="true" className="size-3 shrink-0" />
                <span className={cn(LABEL_CAPS, 'truncate')}>{row.label}</span>
              </span>
            </th>
            {row.cells.map((cell, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional, one per column
              <td key={i} className="border-l border-cs-border px-3.5 py-1.75 align-baseline">
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      'truncate font-mono text-[12px] tabular-nums',
                      cell.reading ? 'text-cs-text' : 'text-cs-text-dim',
                    )}
                  >
                    {cell.text}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-cs-text-dim">
                    <CellMark cell={cell} />
                  </span>
                </span>
              </td>
            ))}
          </tr>
        );
      })}
    </tbody>
  );
}

/** The newest column's "12 s ago", on its own clock so the table doesn't redraw for it. */
function ColumnAge({ ts }: { ts: number }) {
  const now = useNowTick();
  return <>{fmtAge(ts, now)}</>;
}

interface Props {
  /** Node key (`c:<hex>` or bare hex). */
  nodeKey: string;
  source: TelemetrySource;
  client: ApiClient | null;
  /** All the node's saved requests, newest first (the store's order). */
  requests: readonly SavedRequestDto[];
  /** The ticked request ids (the store's compare selection). */
  compareIds: readonly string[];
  /** For the CSV filename and the clear dialog. */
  nodeName?: string;
  /** Level of the view's heading (default 2). */
  headingLevel?: HeadingLevel;
}

/**
 * Compare up to six saved requests: a table of readings × requests (newest
 * left), each cell with its change against the column to its right, "—" for
 * a missing reading and "new" for a first appearance. "Show changes only"
 * hides rows whose values never change; "Export CSV" saves what is shown.
 */
export function TelemetryCompare({ nodeKey, source, client, requests, compareIds, nodeName, headingLevel = 2 }: Props) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const [changesOnly, setChangesOnly] = useState(false);
  const noun = TELEMETRY_COPY[source].noun;
  const Heading = `h${headingLevel}` as const;

  const chosen = useMemo(() => {
    const ids = new Set(compareIds);
    return requests.filter((r) => ids.has(r.id) && r.outcome === 'ok');
  }, [requests, compareIds]);
  const table = useMemo(() => buildCompareTable(chosen, { source }), [chosen, source]);
  const shown = useMemo<CompareTable>(
    () =>
      changesOnly
        ? {
            ...table,
            groups: table.groups
              .map((g) => ({ ...g, rows: g.rows.filter((r) => r.changed) }))
              .filter((g) => g.rows.length > 0),
          }
        : table,
    [table, changesOnly],
  );
  const appearances = useMemo(() => firstAppearances(table), [table]);
  const n = table.columns.length;

  const onExport = () => {
    downloadText(compareCsvFilename(nodeKey, nodeName), compareCsv(shown), 'text/csv;charset=utf-8');
    notify.success('CSV exported');
  };

  const meta = [
    'newest on the left',
    n > 1 ? 'Δ is against the column to its right' : null,
    n > 1 ? `spans ${fmtDuration(table.spanMs)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4.5 @4xl:flex-row @4xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-col gap-0.75">
            <Heading className="text-[14px] font-semibold leading-5 text-cs-text">
              {n === 0 ? `Compare ${noun}s` : `Compare ${n} ${telemetryNoun(source, n)}`}
            </Heading>
            {n > 0 && <span className={cn(META, 'text-cs-text-muted')}>{meta}</span>}
          </div>
          <div className="ml-auto flex gap-2">
            <TelemetryButton
              aria-pressed={changesOnly}
              onClick={() => setChangesOnly((v) => !v)}
              disabled={n < 2}
              // Pressed reads from the border and fill: accent text on bg-3 is 3.7:1 in light.
              className={cn(changesOnly && 'border-cs-accent bg-cs-accent-soft/30')}
            >
              Show changes only
            </TelemetryButton>
            <TelemetryButton onClick={onExport} disabled={n === 0}>
              <Download aria-hidden="true" />
              Export CSV
            </TelemetryButton>
          </div>
        </div>

        {n === 0 ? (
          <p className="text-[12px] text-cs-text-dim">Tick saved {noun}s in the list to compare them.</p>
        ) : (
          <>
            {table.driftChannels.length > 0 && (
              <p
                data-testid="compare-drift"
                className="flex items-start gap-1.5 text-[12px] leading-[18px] text-[rgb(var(--cs-hop-far))]"
              >
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  The field set on {table.driftChannels.map((ch) => `ch ${ch}`).join(', ')} changes between these requests.
                  Channel numbers shift when sensors are added or removed, so a row may not be the same sensor throughout.
                </span>
              </p>
            )}

            <div className="overflow-x-auto rounded-lg border border-cs-border bg-cs-bg-2">
              <table
                className="w-full table-fixed border-collapse"
                style={{ minWidth: `${140 + n * 104}px` }}
                aria-label="Compared requests"
              >
                <colgroup>
                  <col className="w-[170px]" />
                  {table.columns.map((c) => (
                    <col key={c.id} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-cs-border">
                    <th scope="col" className="px-3.5 py-2.5 text-left font-normal">
                      <span className={LABEL_CAPS}>Reading</span>
                    </th>
                    {table.columns.map((c) => (
                      <th key={c.id} scope="col" className="border-l border-cs-border px-3.5 py-2 text-left font-normal">
                        <span className="flex flex-col gap-0.5">
                          <span className="truncate font-mono text-[12px] tabular-nums text-cs-text">
                            {compareWhen(c.requestedAt, timeFormat)}
                          </span>
                          <span className={cn(META, 'truncate')}>
                            {c.gapMs === null ? <ColumnAge ts={c.requestedAt} /> : `${fmtDuration(c.gapMs)} earlier`}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                {shown.groups.map((g) => (
                  <GroupRows key={g.ch} group={g} columns={n} />
                ))}
                {shown.groups.length === 0 && (
                  <tbody>
                    <tr>
                      <td colSpan={n + 1} className="px-3.5 py-3 text-[12px] text-cs-text-dim">
                        No reading changed between these {noun}s.
                      </td>
                    </tr>
                  </tbody>
                )}
              </table>
            </div>

            <div className="flex items-baseline gap-2 text-[11px] text-cs-text-dim">
              <span>—</span>
              <span>
                means that request had no such reading.
                {appearances.map((a) => ` Ch ${a.ch} first appears at ${compareWhen(a.at, timeFormat)}.`).join('')}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 @4xl:w-60">
        <SavedRequestStats requests={requests} client={client} nodeKey={nodeKey} nodeName={nodeName} noun={noun} />
      </div>
    </div>
  );
}
