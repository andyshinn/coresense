import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedRequestDto, TelemetryInFlight } from '../../src/shared/telemetry/types';

const listTelemetry = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = (await orig()) as typeof import('@/lib/api');
  return { ...actual, api: { ...actual.api, listTelemetry: (...a: unknown[]) => listTelemetry(...a) } };
});
vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { notify } from '@/lib/notify';
import { useStore } from '@/lib/store';
import {
  compareWithPreviousIds,
  loadTelemetry,
  useEnsureTelemetryLoaded,
  useRadioBusy,
  useSelectedTelemetryRequest,
  useTelemetryCompare,
  useTelemetryInFlight,
  useTelemetryLoaded,
  useTelemetryRequests,
} from '@/lib/telemetry';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const req = (id: string, requestedAt: number, over: Partial<SavedRequestDto> = {}) =>
  ({ id, nodeKey: A, requestedAt, outcome: 'ok', readings: [], ...over }) as SavedRequestDto;
const flight = (nodeKey: string, source: TelemetryInFlight['source']): TelemetryInFlight => ({
  nodeKey,
  source,
  startedAt: 1,
  deadlineAt: null,
});

beforeEach(() => {
  listTelemetry.mockReset();
  vi.mocked(notify.error).mockClear();
  useStore.setState({
    telemetryByNode: {},
    telemetryLoaded: {},
    telemetryInFlight: [],
    telemetrySelectedId: {},
    telemetryCompare: {},
    telemetryFetchLedger: {},
  });
});

describe('telemetry read hooks', () => {
  it('useTelemetryRequests accepts a contact key and keeps a stable empty list', () => {
    const { result, rerender } = renderHook(() => useTelemetryRequests(`c:${A}`));
    const empty = result.current;
    rerender();
    expect(result.current).toBe(empty);
    act(() => useStore.getState().setTelemetryList(A, [req('r1', 1)]));
    expect(result.current.map((r) => r.id)).toEqual(['r1']);
  });

  it("doesn't re-render for another node's save", () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useTelemetryRequests(A);
    });
    const before = renders;
    act(() => useStore.getState().applyTelemetrySaved(req('b1', 1, { nodeKey: B })));
    expect(renders).toBe(before);
  });

  it('useSelectedTelemetryRequest shows the newest, then a pinned one', () => {
    useStore.getState().setTelemetryList(A, [req('r1', 1), req('r2', 2)]);
    const { result } = renderHook(() => useSelectedTelemetryRequest(A));
    expect(result.current?.id).toBe('r2');
    act(() => useStore.getState().setTelemetrySelected(A, 'r1'));
    expect(result.current?.id).toBe('r1');
  });

  it('useTelemetryCompare is null outside compare mode', () => {
    const { result } = renderHook(() => useTelemetryCompare(A));
    expect(result.current).toBeNull();
    act(() => useStore.getState().setTelemetryCompare(A, []));
    expect(result.current).toEqual([]);
  });

  it('useTelemetryInFlight finds the node; useRadioBusy ignores self reads', () => {
    const inFlight = renderHook(() => useTelemetryInFlight(`c:${A.toUpperCase()}`));
    const busy = renderHook(() => useRadioBusy());
    expect(inFlight.result.current).toBeNull();
    expect(busy.result.current).toBe(false);
    act(() => useStore.getState().applyTelemetryInFlight([flight(B, 'companion')]));
    expect(busy.result.current).toBe(false);
    act(() => useStore.getState().applyTelemetryInFlight([flight(B, 'companion'), flight(A, 'repeater')]));
    expect(inFlight.result.current?.nodeKey).toBe(A);
    expect(busy.result.current).toBe(true);
  });
});

describe('loading', () => {
  it('useEnsureTelemetryLoaded fetches once and marks the node loaded', async () => {
    listTelemetry.mockResolvedValue([req('r1', 1)]);
    const { result } = renderHook(() => {
      useEnsureTelemetryLoaded(client, `c:${A}`);
      return useTelemetryLoaded(A);
    });
    await waitFor(() => expect(result.current).toBe(true));
    expect(listTelemetry).toHaveBeenCalledTimes(1);
    expect(listTelemetry).toHaveBeenCalledWith(client, A);
    expect(useStore.getState().telemetryByNode[A].map((r) => r.id)).toEqual(['r1']);
  });

  it('concurrent loadTelemetry calls share one GET', async () => {
    listTelemetry.mockResolvedValue([]);
    await Promise.all([loadTelemetry(client, A), loadTelemetry(client, `c:${A}`)]);
    expect(listTelemetry).toHaveBeenCalledTimes(1);
  });

  it('loadTelemetry keeps a save pushed mid-GET and drops a held row the server no longer has', async () => {
    useStore.getState().setTelemetryList(A, [req('r1', 1), req('gone', 2)]);
    let answer: (list: SavedRequestDto[]) => void = () => {};
    listTelemetry.mockReturnValue(new Promise((r) => (answer = r)));
    const loading = loadTelemetry(client, A);
    useStore.getState().applyTelemetrySaved(req('r3', 3));
    answer([req('r1', 1)]);
    await loading;
    expect(useStore.getState().telemetryByNode[A].map((r) => r.id)).toEqual(['r3', 'r1']);
  });

  it('reports a failed load and does nothing without a client', async () => {
    listTelemetry.mockRejectedValueOnce(new Error('503'));
    renderHook(() => useEnsureTelemetryLoaded(client, A));
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(vi.mocked(notify.error).mock.calls[0][0]).toBe('Loading saved requests failed: 503');
    listTelemetry.mockClear();
    renderHook(() => useEnsureTelemetryLoaded(null, B));
    expect(listTelemetry).not.toHaveBeenCalled();
  });
});

describe('compareWithPreviousIds', () => {
  const list = [req('r4', 4), req('r3', 3, { outcome: 'timeout' }), req('r2', 2), req('r1', 1)];

  it('pairs a request with the next older ok one, skipping failures', () => {
    expect(compareWithPreviousIds(list, 'r4')).toEqual(['r4', 'r2']);
  });

  it('returns just the request when nothing older is ok, and [] for an unknown id', () => {
    expect(compareWithPreviousIds(list, 'r1')).toEqual(['r1']);
    expect(compareWithPreviousIds(list, 'zz')).toEqual([]);
  });
});
