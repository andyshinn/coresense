import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelStats } from '../../src/shared/types';

const getChannelStats = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = (await orig()) as typeof import('@/lib/api');
  return { ...actual, api: { ...actual.api, getChannelStats: (...a: unknown[]) => getChannelStats(...a) } };
});

import { __resetChannelStatsCacheForTests, useChannelStats } from '@/hooks/useChannelStats';
import { useStore } from '@/lib/store';
import type { Message } from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const stats = (count: number): ChannelStats => ({
  count,
  firstTs: 1,
  lastTs: 2,
  count24h: 0,
  count7d: count,
  distinctSenders: 0,
  roster: [],
  perDay: [0, 0, 0, 0, 0, 0, 0],
});
const msg = (id: string): Message => ({ id, key: 'ch:X', ts: 1, body: 'b', state: 'received' });

beforeEach(() => {
  getChannelStats.mockReset();
  useStore.setState({ messagesByKey: {} });
  // useChannelStats shares an in-flight/last-settled request per channel key
  // at module scope (see the `inflight` cache in useChannelStats.ts). That
  // cache is a module singleton and survives across `it()` blocks, so without
  // clearing it here, a later test reusing 'ch:X' would silently reuse an
  // earlier test's already-settled promise instead of calling the mock.
  __resetChannelStatsCacheForTests();
});

describe('useChannelStats', () => {
  it('fetches on mount and returns stats', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    const { result } = renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(result.current.stats?.count).toBe(3));
    expect(getChannelStats).toHaveBeenCalledTimes(1);
  });

  it('refetches when messagesByKey[key] changes', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(getChannelStats).toHaveBeenCalledTimes(1));
    act(() => useStore.setState({ messagesByKey: { 'ch:X': [msg('m1')] } }));
    await waitFor(() => expect(getChannelStats).toHaveBeenCalledTimes(2));
  });

  // Regression test for I-2: `applyMessageState` (store.ts) rebuilds EVERY
  // key's `messagesByKey` array — a new array identity, same length and same
  // last timestamp — on any message's pending → sent → delivered transition,
  // even for channels the transitioning message doesn't belong to. The old
  // effect keyed on array identity, so this unrelated churn refetched every
  // open channel's stats. Keying on a length+lastTs "version" instead must
  // NOT refetch when a new array has the same shape.
  it('does not refetch when messagesByKey[key] gets a new array of the same shape', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    useStore.setState({ messagesByKey: { 'ch:X': [msg('m1')] } });
    renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(getChannelStats).toHaveBeenCalledTimes(1));

    // A fresh array, same length, same last message ts — exactly what
    // applyMessageState produces for a channel whose own messages didn't
    // change state.
    act(() => useStore.setState({ messagesByKey: { 'ch:X': [{ ...msg('m1') }] } }));
    // Give any (incorrect) refetch a chance to fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(getChannelStats).toHaveBeenCalledTimes(1);
  });

  // Secondary fix in I-2: the shared in-flight cache used to key on channel
  // key alone, so a promise fetched against one server/apiKey combo could be
  // served to a caller now pointed at a different one.
  it('does not serve a cached promise from a different client', async () => {
    getChannelStats.mockResolvedValueOnce(stats(3));
    const first = renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(first.result.current.stats?.count).toBe(3));

    const otherClient = { baseUrl: 'http://y', apiKey: 'k2' };
    getChannelStats.mockResolvedValueOnce(stats(7));
    const second = renderHook(() => useChannelStats('ch:X', otherClient));
    await waitFor(() => expect(second.result.current.stats?.count).toBe(7));
    expect(getChannelStats).toHaveBeenCalledTimes(2);
  });

  it('does not fetch without a client', () => {
    renderHook(() => useChannelStats('ch:X', null));
    expect(getChannelStats).not.toHaveBeenCalled();
  });

  it('shares one request between two hook instances on the same channel', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    const a = renderHook(() => useChannelStats('ch:X', client));
    const b = renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(a.result.current.stats?.count).toBe(3));
    await waitFor(() => expect(b.result.current.stats?.count).toBe(3));
    expect(getChannelStats).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected request, so the next render retries', async () => {
    getChannelStats.mockRejectedValueOnce(new Error('boom'));
    const { result, unmount } = renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    unmount();

    getChannelStats.mockResolvedValueOnce(stats(5));
    const retry = renderHook(() => useChannelStats('ch:X', client));
    await waitFor(() => expect(retry.result.current.stats?.count).toBe(5));
    expect(getChannelStats).toHaveBeenCalledTimes(2);
  });
});
