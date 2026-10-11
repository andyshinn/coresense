import { useEffect } from 'react';
import { normalizeNodeKey } from '../../shared/telemetry/dto';
import type { SavedRequestDto, TelemetryInFlight } from '../../shared/telemetry/types';
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
  else notify.error(`Telemetry request failed: ${request.error ?? request.outcome}`);
}
