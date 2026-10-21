import { normalizeNodeKey } from '../../../shared/telemetry/dto';
import { COMPARE_MAX_COLUMNS } from '../../../shared/telemetry/previous';
import type { SavedRequestDto, TelemetryDeletedPayload, TelemetryInFlight } from '../../../shared/telemetry/types';
import { telemetryRetentionOf } from '../telemetryRetention';
import type { CoreState, SliceCreator } from './coreState';
import type { TelemetryFetchLedger } from './types';

/** Saved telemetry requests and the per-node view state of the panels that
 *  show them. */
export interface TelemetrySlice {
  // Saved telemetry requests, keyed by bare lowercase 64-hex node key (the
  // owner's own key for My radio). Newest first. Loaded lazily per node via
  // GET (lib/telemetry.ts) and kept current by the telemetrySaved/Deleted WS
  // pushes. A node can hold WS-pushed saves before its list was ever fetched,
  // so `telemetryLoaded` — not the presence of a list — says "complete".
  // Use the narrow hooks in lib/telemetry.ts; never select these maps whole.
  telemetryByNode: Record<string, SavedRequestDto[]>;
  telemetryLoaded: Record<string, boolean>;
  /** Pending requests, replaced wholesale by every telemetryInFlight push. */
  telemetryInFlight: TelemetryInFlight[];
  /** The request each node's panel shows. Absent = the newest. */
  telemetrySelectedId: Record<string, string>;
  /** Compare selection per node. Absent = not in compare mode; [] = compare
   *  mode with nothing ticked. At most COMPARE_MAX_COLUMNS ids. */
  telemetryCompare: Record<string, string[]>;
  /** Pushes seen per node while its list GET runs (beginTelemetryFetch →
   *  setTelemetryList). Bookkeeping only; nothing renders it. */
  telemetryFetchLedger: Record<string, TelemetryFetchLedger>;

  /** A node's GET is about to start: from here until setTelemetryList, note
   *  every telemetrySaved/Deleted push for it, which the response may predate. */
  beginTelemetryFetch: (nodeKey: string) => void;
  /** Replace a node's list with a fresh GET and mark it loaded, re-applying
   *  the pushes noted since beginTelemetryFetch: a save pushed while the GET
   *  ran survives, a delete pushed while it ran stays deleted. Any other held
   *  row the response lacks is gone from the server. */
  setTelemetryList: (nodeKey: string, list: SavedRequestDto[]) => void;
  /** Reads appSettings for the retention limit. */
  applyTelemetrySaved: (request: SavedRequestDto) => void;
  applyTelemetryDeleted: (payload: TelemetryDeletedPayload) => void;
  applyTelemetryInFlight: (inFlight: TelemetryInFlight[]) => void;
  /** After a WS reconnect: pushes sent while the socket was down are lost, so
   *  take the in-flight snapshot afresh and let mounted panels refetch. */
  resyncTelemetry: (inFlight: TelemetryInFlight[]) => void;
  /** Null shows the newest request again. */
  setTelemetrySelected: (nodeKey: string, id: string | null) => void;
  /** Enter compare mode with `ids` ticked (trimmed to COMPARE_MAX_COLUMNS), or leave it with null. */
  setTelemetryCompare: (nodeKey: string, ids: string[] | null) => void;
  /** Tick/untick one request. Ticking past COMPARE_MAX_COLUMNS is ignored. Enters compare mode. */
  toggleTelemetryCompare: (nodeKey: string, id: string) => void;
}

export const createTelemetrySlice: SliceCreator<TelemetrySlice> = (set) => ({
  telemetryByNode: {},
  telemetryLoaded: {},
  telemetryInFlight: [],
  telemetrySelectedId: {},
  telemetryCompare: {},
  telemetryFetchLedger: {},

  beginTelemetryFetch: (nodeKey) =>
    set((s) => ({
      telemetryFetchLedger: { ...s.telemetryFetchLedger, [nodeKeyFor(nodeKey)]: { pushed: [], deleted: [] } },
    })),
  setTelemetryList: (nodeKey, list) =>
    set((s) => {
      const key = nodeKeyFor(nodeKey);
      // Without a ledger nothing is known to have been pushed mid-GET, so the
      // response is the whole truth.
      const ledger = s.telemetryFetchLedger[key] ?? { pushed: [], deleted: [] };
      const { deleted } = ledger;
      // The response may predate a delete pushed while it ran; that delete wins.
      const fresh =
        deleted === 'all' ? [] : sortNewestFirst(deleted.length > 0 ? list.filter((r) => !deleted.includes(r.id)) : list);
      const fetchedIds = new Set(fresh.map((r) => r.id));
      // Keep only held rows a push saved while the GET ran — never one merely
      // missing from the response, which the server deleted (perhaps while we
      // weren't listening) and would 404 on delete.
      const pushedIds = new Set(ledger.pushed);
      const pushed = (s.telemetryByNode[key] ?? []).filter((r) => pushedIds.has(r.id) && !fetchedIds.has(r.id));
      const merged = sortNewestFirst([...pushed, ...fresh]);
      const { [key]: _done, ...ledgers } = s.telemetryFetchLedger;
      return {
        telemetryByNode: { ...s.telemetryByNode, [key]: merged },
        telemetryLoaded: { ...s.telemetryLoaded, [key]: true },
        telemetryFetchLedger: ledgers,
        ...dropStaleTelemetrySelection(s, key, new Set(merged.map((r) => r.id))),
      };
    }),
  applyTelemetrySaved: (request) =>
    set((s) => {
      const key = nodeKeyFor(request.nodeKey);
      const ledger = s.telemetryFetchLedger[key];
      const ledgerPatch = ledger
        ? {
            telemetryFetchLedger: {
              ...s.telemetryFetchLedger,
              [key]: { ...ledger, pushed: [...ledger.pushed, request.id] },
            },
          }
        : {};
      const others = (s.telemetryByNode[key] ?? []).filter((r) => r.id !== request.id);
      const list = sortNewestFirst([request, ...others]).slice(0, telemetryRetentionOf(s.appSettings));
      // A new save is what the user just asked for, so show it: drop any pin
      // to an older request. Retention may have pushed one out of the list.
      const patch = dropStaleTelemetrySelection(s, key, new Set(list.map((r) => r.id)));
      const selectedNow = patch.telemetrySelectedId ?? s.telemetrySelectedId;
      if (key in selectedNow) {
        const { [key]: _selected, ...rest } = selectedNow;
        patch.telemetrySelectedId = rest;
      }
      return { telemetryByNode: { ...s.telemetryByNode, [key]: list }, ...patch, ...ledgerPatch };
    }),
  applyTelemetryDeleted: ({ nodeKey, ids }) =>
    set((s) => {
      const key = nodeKeyFor(nodeKey);
      const list = s.telemetryByNode[key];
      const ledger = s.telemetryFetchLedger[key];
      if (ids === 'all') {
        const { [key]: _selected, ...selected } = s.telemetrySelectedId;
        const { [key]: _compare, ...compare } = s.telemetryCompare;
        return {
          // Cleared is a complete answer: the node is loaded, with nothing in it.
          telemetryByNode: { ...s.telemetryByNode, [key]: [] },
          telemetryLoaded: { ...s.telemetryLoaded, [key]: true },
          telemetrySelectedId: selected,
          telemetryCompare: compare,
          ...(ledger
            ? { telemetryFetchLedger: { ...s.telemetryFetchLedger, [key]: { pushed: [], deleted: 'all' as const } } }
            : {}),
        };
      }
      const drop = new Set(ids);
      const kept = (list ?? []).filter((r) => !drop.has(r.id));
      return {
        ...(list ? { telemetryByNode: { ...s.telemetryByNode, [key]: kept } } : {}),
        ...dropStaleTelemetrySelection(s, key, new Set(kept.map((r) => r.id))),
        ...(ledger
          ? {
              telemetryFetchLedger: {
                ...s.telemetryFetchLedger,
                [key]: {
                  pushed: ledger.pushed.filter((id) => !drop.has(id)),
                  deleted: ledger.deleted === 'all' ? ('all' as const) : [...ledger.deleted, ...ids],
                },
              },
            }
          : {}),
      };
    }),
  applyTelemetryInFlight: (inFlight) => set(() => ({ telemetryInFlight: inFlight })),
  resyncTelemetry: (inFlight) => set(() => ({ telemetryInFlight: inFlight, telemetryLoaded: {} })),
  setTelemetrySelected: (nodeKey, id) =>
    set((s) => {
      const key = nodeKeyFor(nodeKey);
      if (id === null) {
        if (!(key in s.telemetrySelectedId)) return {};
        const { [key]: _selected, ...rest } = s.telemetrySelectedId;
        return { telemetrySelectedId: rest };
      }
      if (s.telemetrySelectedId[key] === id) return {};
      return { telemetrySelectedId: { ...s.telemetrySelectedId, [key]: id } };
    }),
  setTelemetryCompare: (nodeKey, ids) =>
    set((s) => {
      const key = nodeKeyFor(nodeKey);
      if (ids === null) {
        if (!(key in s.telemetryCompare)) return {};
        const { [key]: _compare, ...rest } = s.telemetryCompare;
        return { telemetryCompare: rest };
      }
      return { telemetryCompare: { ...s.telemetryCompare, [key]: [...new Set(ids)].slice(0, COMPARE_MAX_COLUMNS) } };
    }),
  toggleTelemetryCompare: (nodeKey, id) =>
    set((s) => {
      const key = nodeKeyFor(nodeKey);
      const current = s.telemetryCompare[key] ?? [];
      if (current.includes(id)) {
        return { telemetryCompare: { ...s.telemetryCompare, [key]: current.filter((x) => x !== id) } };
      }
      if (current.length >= COMPARE_MAX_COLUMNS) return {};
      return { telemetryCompare: { ...s.telemetryCompare, [key]: [...current, id] } };
    }),
});

/** Store key for a node: bare lowercase hex. Anything that doesn't normalise
 *  (it shouldn't happen: main only sends bare keys) is used as given. */
function nodeKeyFor(key: string): string {
  return normalizeNodeKey(key) ?? key;
}

function sortNewestFirst(list: SavedRequestDto[]): SavedRequestDto[] {
  return [...list].sort((a, b) => b.requestedAt - a.requestedAt);
}

/** Selection/compare patch for one node once its list holds only `present`
 *  ids: a selected request that's gone falls back to the newest, and gone ids
 *  leave the compare set. Returns {} when nothing changes. */
function dropStaleTelemetrySelection(s: CoreState, key: string, present: Set<string>): Partial<CoreState> {
  const out: Partial<CoreState> = {};
  const selected = s.telemetrySelectedId[key];
  if (selected !== undefined && !present.has(selected)) {
    const { [key]: _selected, ...rest } = s.telemetrySelectedId;
    out.telemetrySelectedId = rest;
  }
  const compare = s.telemetryCompare[key];
  if (compare?.some((id) => !present.has(id))) {
    out.telemetryCompare = { ...s.telemetryCompare, [key]: compare.filter((id) => present.has(id)) };
  }
  return out;
}

/** Trim every held list to its newest `keep`, fixing selections to match. For
 *  the settings slice's applyAppSettings, when retention shrinks. */
export function pruneTelemetry(s: CoreState, keep: number): Partial<CoreState> {
  let next: CoreState = s;
  let byNode: Record<string, SavedRequestDto[]> | null = null;
  for (const [key, list] of Object.entries(s.telemetryByNode)) {
    if (list.length <= keep) continue;
    byNode ??= { ...s.telemetryByNode };
    const trimmed = list.slice(0, keep);
    byNode[key] = trimmed;
    next = { ...next, ...dropStaleTelemetrySelection(next, key, new Set(trimmed.map((r) => r.id))) };
  }
  if (!byNode) return {};
  return {
    telemetryByNode: byNode,
    telemetrySelectedId: next.telemetrySelectedId,
    telemetryCompare: next.telemetryCompare,
  };
}
