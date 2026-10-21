// History over saved requests: reading identity, "previous" lookups, the
// compare table and its CSV export. Pure; works on decoded requests (DTOs),
// so main (GET request detail) and the renderer (tiles, compare) agree.

import { describeChannels, describeReading, fieldSet, mcuTemperature, SELF_CHANNEL } from './describe';
import { formatNumber, MINUS, withUnit } from './format';
import { isGpsValue, LPP_TYPES, type Reading } from './lpp';
import type { PreviousReading, SavedRequestDto, TelemetrySource } from './types';

/**
 * The parts of a decoded request the history helpers need. `source` (default
 * 'repeater') decides which ch 1 temperature is the MCU's, see keyReadings.
 */
export type DecodedRequest = Pick<SavedRequestDto, 'id' | 'requestedAt' | 'outcome' | 'readings'> &
  Partial<Pick<SavedRequestDto, 'source'>>;

/**
 * A reading's identity across requests: (ch, typeId, occurrence), where
 * occurrence is its index among same-(ch, typeId) readings in payload order.
 * (ch, typeId) alone is not unique: ch 1 can carry a sensor temperature and
 * the MCU temperature (T1000-E).
 */
export function readingKey(ch: number, typeId: number, occurrence: number): string {
  return `${ch}:${typeId}:${occurrence}`;
}

export interface KeyedReading {
  key: string;
  occurrence: number;
  reading: Reading;
}

// The MCU temperature always takes ch 1 / temperature occurrence 0, and the
// other ch 1 temperatures count from 1. Plain payload order would key it by
// how many sensor temperatures precede it, and those depend on permissions:
// a T1000-E guest reply's MCU temp (1:103:0) would pair with the full reply's
// sensor temperature (also 1:103:0, with the MCU at 1:103:1).
const MCU_PAIR = `${SELF_CHANNEL}:103`;

/** Key every reading of one payload, in payload order. `source` locates the MCU temperature. */
export function keyReadings(readings: readonly Reading[], source: TelemetrySource = 'repeater'): KeyedReading[] {
  const mcu = mcuTemperature(readings, source);
  const seen = new Map<string, number>(mcu ? [[MCU_PAIR, 1]] : []);
  return readings.map((reading) => {
    if (reading === mcu) return { key: readingKey(SELF_CHANNEL, 103, 0), occurrence: 0, reading };
    const pair = `${reading.ch}:${reading.typeId}`;
    const occurrence = seen.get(pair) ?? 0;
    seen.set(pair, occurrence + 1);
    return { key: readingKey(reading.ch, reading.typeId, occurrence), occurrence, reading };
  });
}

function findByKey(req: DecodedRequest, key: string): Reading | null {
  return keyReadings(req.readings, req.source).find((k) => k.key === key)?.reading ?? null;
}

/**
 * The most recent earlier saved request that holds `key` (PLAN decision 5):
 * only `ok` requests strictly before `beforeRequestedAt` count, and a request
 * lacking the reading (guest/base-only reply, sensor not yet fitted) is
 * skipped rather than ending the search. Null when none has it (a new sensor).
 * `requests` may be in any order; the store hands them newest first.
 */
export function previousFor(
  requests: readonly DecodedRequest[],
  beforeRequestedAt: number,
  key: string,
): PreviousReading | null {
  let best: PreviousReading | null = null;
  for (const req of requests) {
    if (req.outcome !== 'ok' || req.requestedAt >= beforeRequestedAt) continue;
    if (best && req.requestedAt <= best.requestedAt) continue;
    const reading = findByKey(req, key);
    if (reading) best = { reading, requestedAt: req.requestedAt, requestId: req.id };
  }
  return best;
}

/** `previousFor` for every reading of `request`, aligned with `request.readings`. */
export function previousForRequest(
  requests: readonly DecodedRequest[],
  request: DecodedRequest,
): Array<PreviousReading | null> {
  return keyReadings(request.readings, request.source).map(({ key }) => previousFor(requests, request.requestedAt, key));
}

export type DeltaDirection = 'up' | 'down' | 'same' | 'moved';

export interface ReadingDelta {
  direction: DeltaDirection;
  /** Unsigned magnitude in the display unit, no unit ("0.03"); '' when same. */
  magnitude: string;
  /** Signed with unit ("+0.03 V", "−3.3 °C", "+9.5%", "moved 12 m", "unchanged"). */
  text: string;
}

const EARTH_RADIUS_M = 6_371_000;

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Change from `previous` to `current` (same reading key). Equal within half a
 * step is "same". GPS reports the distance moved. The unit follows the tile:
 * current in mA while the current value shows in mA (below 1 A), and `unit`
 * (pass DescribedReading.baseUnit) replaces the registry unit where describe
 * changed it: "Ω" for BME680 gas resistance, '' for RAK12035 calibration.
 */
export function readingDelta(current: Reading, previous: Reading, unit?: string): ReadingDelta {
  if (isGpsValue(current.value) || isGpsValue(previous.value)) {
    if (!isGpsValue(current.value) || !isGpsValue(previous.value))
      return { direction: 'moved', magnitude: '', text: 'moved' };
    const m = haversineM(current.value, previous.value);
    const sameAlt = Math.abs(current.value.alt - previous.value.alt) < 0.005;
    if (m < 0.5 && sameAlt) return { direction: 'same', magnitude: '', text: 'unchanged' };
    const magnitude = formatNumber(m, 0, { group: true });
    return { direction: 'moved', magnitude, text: `moved ${withUnit(magnitude, 'm')}` };
  }
  const type = LPP_TYPES[current.typeId];
  const diff = current.value - previous.value;
  const step = type?.step ?? 1;
  if (Math.abs(diff) < step / 2) return { direction: 'same', magnitude: '', text: 'unchanged' };
  let shown = Math.abs(diff);
  let decimals = type?.decimals ?? 0;
  let shownUnit = unit ?? type?.unit ?? '';
  if (current.typeId === 117 && Math.abs(current.value) < 1) {
    shown *= 1000;
    decimals = 0;
    shownUnit = 'mA';
  }
  const magnitude = formatNumber(shown, decimals, { group: decimals === 0 });
  const direction = diff > 0 ? 'up' : 'down';
  return { direction, magnitude, text: withUnit(`${diff > 0 ? '+' : MINUS}${magnitude}`, shownUnit) };
}

// ---------------------------------------------------------------------------
// Compare table

export const COMPARE_MAX_COLUMNS = 6;

export interface CompareColumn {
  id: string;
  requestedAt: number;
  /** Gap to the newer column on its left; null for the newest column. */
  gapMs: number | null;
}

/**
 * - `none`: no mark (oldest column, or missing reading, or the column to the right lacks it but an older one has it)
 * - `new`: the reading's first appearance among the selected columns
 */
export type CompareMark = 'none' | 'new' | DeltaDirection;

export interface CompareCell {
  reading: Reading | null;
  /** Display value with unit, or "—" when this request had no such reading. */
  text: string;
  /** Change against the column to its right. */
  mark: CompareMark;
  /** Unsigned magnitude for up/down/moved, '' otherwise. */
  magnitude: string;
}

export interface CompareRow {
  key: string;
  ch: number;
  typeId: number;
  occurrence: number;
  label: string;
  icon: string;
  /** Unit of the raw values (for CSV headers); '' for unitless. */
  baseUnit: string;
  cells: CompareCell[];
  /** False when every column has the reading with an equal value. */
  changed: boolean;
}

export interface CompareGroup {
  ch: number;
  name: string;
  rows: CompareRow[];
  /** The channel's field set differs between columns that have it (channel numbers drift as sensors come and go). */
  drift: boolean;
}

export interface CompareTable {
  columns: CompareColumn[];
  groups: CompareGroup[];
  /** Newest minus oldest requestedAt. */
  spanMs: number;
  driftChannels: number[];
}

export interface CompareOptions {
  source?: TelemetrySource;
  /** Drop rows whose values are all equal, and groups left empty. */
  changesOnly?: boolean;
}

/**
 * Build the compare table: rows are readings grouped by channel, columns the
 * chosen requests, newest on the left (whatever order they come in; at most
 * COMPARE_MAX_COLUMNS, the newest kept). Each cell's mark compares it with
 * the column to its right.
 *
 * Drift ignores ch 1 (its content varies with permissions: a guest reply has
 * no GPS) and columns lacking the channel entirely (permission, not drift).
 */
export function buildCompareTable(requests: readonly DecodedRequest[], opts: CompareOptions = {}): CompareTable {
  const source = opts.source ?? 'repeater';
  const cols = [...requests].sort((a, b) => b.requestedAt - a.requestedAt).slice(0, COMPARE_MAX_COLUMNS);
  const columns: CompareColumn[] = cols.map((r, i) => ({
    id: r.id,
    requestedAt: r.requestedAt,
    gapMs: i === 0 ? null : cols[i - 1].requestedAt - r.requestedAt,
  }));
  const keyed = cols.map((r) => new Map(keyReadings(r.readings, r.source ?? source).map((k) => [k.key, k])));

  // Row order: the newest column's payload order, then keys only older columns have.
  const order = new Map<number, string[]>();
  const meta = new Map<string, KeyedReading>();
  for (const col of keyed) {
    for (const [key, k] of col) {
      if (meta.has(key)) continue;
      meta.set(key, k);
      const list = order.get(k.reading.ch);
      if (list) list.push(key);
      else order.set(k.reading.ch, [key]);
    }
  }

  const driftChannels: number[] = [];
  const groups: CompareGroup[] = [];
  for (const ch of [...order.keys()].sort((a, b) => a - b)) {
    const newestWithCh = cols.findIndex((c) => c.readings.some((r) => r.ch === ch));
    const name =
      describeChannels(cols[newestWithCh].readings, source).find((g) => g.ch === ch)?.name ??
      (ch === SELF_CHANNEL ? 'Self' : 'Sensors');

    const sets = new Set(
      cols
        .map((c) => c.readings.filter((r) => r.ch === ch))
        .filter((list) => list.length > 0)
        .map((list) => fieldSet(list)),
    );
    const drift = ch !== SELF_CHANNEL && sets.size > 1;
    if (drift) driftChannels.push(ch);

    const rows: CompareRow[] = [];
    for (const key of order.get(ch) ?? []) {
      const first = meta.get(key) as KeyedReading;
      const newestIdx = keyed.findIndex((m) => m.has(key));
      const desc = describeReading(first.reading, cols[newestIdx].readings, source);
      const cells: CompareCell[] = cols.map((col, i) => {
        const cur = keyed[i].get(key)?.reading ?? null;
        if (!cur) return { reading: null, text: '—', mark: 'none', magnitude: '' };
        const text = describeReading(cur, col.readings, source).text;
        if (i === cols.length - 1) return { reading: cur, text, mark: 'none', magnitude: '' };
        const right = keyed[i + 1].get(key)?.reading ?? null;
        if (!right) {
          const olderHasIt = keyed.slice(i + 1).some((m) => m.has(key));
          return { reading: cur, text, mark: olderHasIt ? 'none' : 'new', magnitude: '' };
        }
        const d = readingDelta(cur, right);
        return { reading: cur, text, mark: d.direction, magnitude: d.magnitude };
      });
      const allEqual = cells.every((c, i) => c.reading && (i === cells.length - 1 || c.mark === 'same'));
      rows.push({
        key,
        ch,
        typeId: first.reading.typeId,
        occurrence: first.occurrence,
        label: desc.label,
        icon: desc.icon,
        baseUnit: desc.kind === 'gps' ? '' : desc.baseUnit,
        cells,
        changed: !allEqual,
      });
    }
    const shown = opts.changesOnly ? rows.filter((r) => r.changed) : rows;
    if (shown.length > 0) groups.push({ ch, name, rows: shown, drift });
  }

  const spanMs = cols.length > 1 ? cols[0].requestedAt - cols[cols.length - 1].requestedAt : 0;
  return { columns, groups, spanMs, driftChannels };
}

function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Raw numbers in the base unit with an ASCII minus, so spreadsheets parse them.
function csvValue(r: Reading | null): string {
  if (!r) return '';
  if (isGpsValue(r.value)) return `${r.value.lat} ${r.value.lon} ${r.value.alt}`;
  return String(r.value);
}

/**
 * CSV of a compare table: `reading,ch,type,<ISO time per column>`, one line
 * per row in table order. `reading` is the label plus its base unit
 * ("Battery (V)"); GPS cells are "lat lon alt"; a missing reading is empty.
 */
export function compareCsv(table: CompareTable): string {
  const header = ['reading', 'ch', 'type', ...table.columns.map((c) => new Date(c.requestedAt).toISOString())];
  const lines = [header.map(csvField).join(',')];
  for (const group of table.groups) {
    for (const row of group.rows) {
      const label =
        row.typeId === 136 ? `${row.label} (lat lon alt)` : row.baseUnit ? `${row.label} (${row.baseUnit})` : row.label;
      lines.push(
        [label, String(row.ch), String(row.typeId), ...row.cells.map((c) => csvValue(c.reading))].map(csvField).join(','),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
