import { useEffect } from 'react';
import { normalizeNodeKey } from '../../shared/telemetry/dto';
import type { SavedRequestDto, TelemetryInFlight, TelemetrySource } from '../../shared/telemetry/types';
import { type ApiClient, api } from './api';
import { notify } from './notify';
import { useStore } from './store';
import { telemetryRetentionOf } from './telemetryRetention';

// Narrow read hooks over the store's telemetry slices. Every hook takes a node
// key in any accepted form (`c:<hex>`, bare hex, either case) and selects one
// node's slot, so a save for one repeater doesn't re-render another's panel.
// Each returns a stored reference or a module constant: zustand compares by
// identity, and a fresh array/object per call would re-render forever.

/** Hint shown on admin buttons while a mesh telemetry request holds the radio. */
export const RADIO_BUSY_HINT = 'Waiting for telemetry request';

/** Repeaters answer only clients in their ACL; anyone else just times out. */
export const LOGIN_HINT = 'Repeaters reply only to logged-in clients';

/** Copy that depends on who answers: a mesh node is asked (a "request"), the companion is read (a "read"). */
export interface TelemetrySourceCopy {
  /** The button: "Request telemetry". */
  action: string;
  /** The button while pending: "Requesting…". */
  busy: string;
  /** The loading card's title: "Requesting telemetry". */
  pending: string;
  /** Failure prefix for toasts and the failed card: "Telemetry request failed". */
  failed: string;
  /** The failed card's header: "Request failed". */
  failedTitle: string;
  /** What one saved entry is called: "request" / "read". */
  noun: string;
  /** Who gets asked, in the empty state. */
  target: string;
}

const REQUEST_COPY = {
  action: 'Request telemetry',
  busy: 'Requesting…',
  pending: 'Requesting telemetry',
  failed: 'Telemetry request failed',
  failedTitle: 'Request failed',
  noun: 'request',
} as const;

export const TELEMETRY_COPY: Readonly<Record<TelemetrySource, TelemetrySourceCopy>> = {
  repeater: { ...REQUEST_COPY, target: 'this repeater' },
  contact: { ...REQUEST_COPY, target: 'this contact' },
  companion: {
    action: 'Read telemetry',
    busy: 'Reading…',
    pending: 'Reading telemetry',
    failed: 'Telemetry read failed',
    failedTitle: 'Read failed',
    noun: 'read',
    target: 'your radio',
  },
};

/** "request" / "requests" (or "read" / "reads") for `n`. */
export function telemetryNoun(source: TelemetrySource, n: number): string {
  const noun = TELEMETRY_COPY[source].noun;
  return n === 1 ? noun : `${noun}s`;
}

const EMPTY_REQUESTS: readonly SavedRequestDto[] = [];

/** Store key for a node (bare lowercase hex), or null for a key that isn't one. */
export function telemetryNodeKey(key: string | null | undefined): string | null {
  return key ? normalizeNodeKey(key) : null;
}

/** A node's saved requests, newest first. Empty until loaded (see useTelemetryLoaded). */
export function useTelemetryRequests(nodeKey: string | null | undefined): readonly SavedRequestDto[] {
  const key = telemetryNodeKey(nodeKey);
  return useStore((s) => (key ? s.telemetryByNode[key] : undefined) ?? EMPTY_REQUESTS);
}

/** True once the node's full list has been fetched since the last hydrate. */
export function useTelemetryLoaded(nodeKey: string | null | undefined): boolean {
  const key = telemetryNodeKey(nodeKey);
  return useStore((s) => (key ? s.telemetryLoaded[key] === true : false));
}

/** The request the node's panel shows: the selected one, else the newest, else null. */
export function useSelectedTelemetryRequest(nodeKey: string | null | undefined): SavedRequestDto | null {
  const key = telemetryNodeKey(nodeKey);
  return useStore((s) => {
    if (!key) return null;
    const list = s.telemetryByNode[key];
    if (!list || list.length === 0) return null;
    const id = s.telemetrySelectedId[key];
    return (id !== undefined ? list.find((r) => r.id === id) : undefined) ?? list[0];
  });
}

/** The node's compare selection, or null when it isn't in compare mode. */
export function useTelemetryCompare(nodeKey: string | null | undefined): readonly string[] | null {
  const key = telemetryNodeKey(nodeKey);
  return useStore((s) => (key ? s.telemetryCompare[key] : undefined) ?? null);
}

/** The node's pending request, or null. */
export function useTelemetryInFlight(nodeKey: string | null | undefined): TelemetryInFlight | null {
  const key = telemetryNodeKey(nodeKey);
  return useStore((s) => (key ? s.telemetryInFlight.find((f) => f.nodeKey === key) : undefined) ?? null);
}

/**
 * True while a mesh telemetry request holds the radio-wide request lock. The
 * companion firmware keeps one pending request per radio, so other admin
 * requests (login, ACL, neighbours, owner, CLI, trace) would kill the reply:
 * disable them with {@link RADIO_BUSY_HINT}. A self read over BLE/USB uses no
 * airtime and takes no lock, so it doesn't count.
 */
export function useRadioBusy(): boolean {
  return useStore((s) => s.telemetryInFlight.some((f) => f.source !== 'companion'));
}

/** Saved requests kept per node (global AppSettings value, clamped). */
export function useTelemetryRetention(): number {
  return useStore((s) => telemetryRetentionOf(s.appSettings));
}

/** Ids for "Compare with previous": `id` plus the next older `ok` request, if any. */
export function compareWithPreviousIds(requests: readonly SavedRequestDto[], id: string): string[] {
  const at = requests.findIndex((r) => r.id === id);
  if (at < 0) return [];
  const previous = requests.slice(at + 1).find((r) => r.outcome === 'ok');
  return previous ? [id, previous.id] : [id];
}

const loading = new Map<string, Promise<void>>();

/** Fetch a node's saved requests into the store. Concurrent calls share one GET. */
export function loadTelemetry(client: ApiClient, nodeKey: string): Promise<void> {
  const key = telemetryNodeKey(nodeKey);
  if (!key) return Promise.reject(new Error(`Not a node key: ${nodeKey}`));
  const pending = loading.get(key);
  if (pending) return pending;
  // Before the request leaves, so every push the response might predate is noted.
  useStore.getState().beginTelemetryFetch(key);
  const run = api
    .listTelemetry(client, key)
    .then((list) => useStore.getState().setTelemetryList(key, list))
    .finally(() => loading.delete(key));
  loading.set(key, run);
  return run;
}

/**
 * Re-read what a WS outage may have hidden: the in-flight snapshot (a lost
 * final `telemetryInFlight` push would leave a spinner — and useRadioBusy —
 * stuck) and every held list (mounted panels refetch). For the socket's
 * re-open; the first open follows the initial hydrate, which already did this.
 */
export async function resyncTelemetryAfterReconnect(client: ApiClient): Promise<void> {
  const snap = await api.snapshot(client);
  useStore.getState().resyncTelemetry(snap.telemetryInFlight ?? []);
}

/** Load a node's saved requests on mount, and again after a re-hydrate. */
export function useEnsureTelemetryLoaded(client: ApiClient | null, nodeKey: string | null | undefined): void {
  const key = telemetryNodeKey(nodeKey);
  const loaded = useTelemetryLoaded(key);
  useEffect(() => {
    if (!client || !key || loaded) return;
    loadTelemetry(client, key).catch((err) => {
      notify.error(`Loading saved requests failed: ${(err as Error).message}`, err);
    });
  }, [client, key, loaded]);
}

/** Toast for a finished POST /request: the request was saved whatever its outcome. */
export function notifyTelemetryOutcome(request: SavedRequestDto): void {
  if (request.outcome === 'ok') notify.success('Telemetry saved');
  else notify.error(`${TELEMETRY_COPY[request.source].failed}: ${request.error ?? request.outcome}`);
}

/** The reason in "<failed>: <reason>" for a rejected POST: "radio busy" for a 409, else the error's message. */
export function telemetryRequestError(err: unknown): string {
  if ((err as { code?: unknown } | null)?.code === 'radio_busy') return 'radio busy';
  return err instanceof Error ? err.message : String(err);
}

const requesting = new Map<string, Promise<void>>();

/** True while this renderer has a POST /request out for the node (before main's in-flight push lands). */
export function isTelemetryRequesting(nodeKey: string): boolean {
  const key = telemetryNodeKey(nodeKey);
  return key !== null && requesting.has(key);
}

/**
 * Ask a node for telemetry (or read the radio) and toast the outcome. One
 * POST per node from this renderer: main joins a second click to the first,
 * so both would resolve with the same request and toast twice. A click while
 * one is out (a double click, or the rail's and the tab's buttons) is
 * dropped. `onError` handles a rejected POST before the default toast;
 * return true when it did.
 */
export function requestTelemetryOnce(
  client: ApiClient,
  nodeKey: string,
  source: TelemetrySource,
  onError?: (err: unknown) => boolean,
): Promise<void> {
  const key = telemetryNodeKey(nodeKey);
  if (!key) return Promise.resolve();
  const pending = requesting.get(key);
  if (pending) return pending;
  const run = api
    .requestTelemetry(client, nodeKey)
    .then(notifyTelemetryOutcome, (err: unknown) => {
      if (onError?.(err)) return;
      notify.error(`${TELEMETRY_COPY[source].failed}: ${telemetryRequestError(err)}`, err);
    })
    .finally(() => requesting.delete(key));
  requesting.set(key, run);
  return run;
}
