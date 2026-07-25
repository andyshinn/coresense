import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelStats } from '../../src/shared/types';

const getChannelStats = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = (await orig()) as typeof import('@/lib/api');
  return { ...actual, api: { ...actual.api, getChannelStats: (...a: unknown[]) => getChannelStats(...a) } };
});

import { useChannelStats } from '@/hooks/useChannelStats';
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
const msg = (id: string, key: string): Message => ({ id, key, ts: 1, body: 'b', state: 'received' });

beforeEach(() => {
  getChannelStats.mockReset();
  useStore.setState({ messagesByKey: {} });
});

// Each test below uses its own channel key. `useChannelStats` now shares an
// in-flight/last-settled request per channel key at module scope (see the
// `inflight` cache in useChannelStats.ts), and that cache is NOT reset between
// tests in this file — so two tests reusing the same key would see the second
// test's render silently reuse the first test's already-settled promise
// instead of calling the mock again. Distinct keys keep every test's cache
// entry independent without needing a test-only reset hook in production code.
describe('useChannelStats', () => {
  it('fetches on mount and returns stats', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    const { result } = renderHook(() => useChannelStats('ch:mount', client));
    await waitFor(() => expect(result.current.stats?.count).toBe(3));
    expect(getChannelStats).toHaveBeenCalledTimes(1);
  });

  it('refetches when messagesByKey[key] changes', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    renderHook(() => useChannelStats('ch:refetch', client));
    await waitFor(() => expect(getChannelStats).toHaveBeenCalledTimes(1));
    act(() => useStore.setState({ messagesByKey: { 'ch:refetch': [msg('m1', 'ch:refetch')] } }));
    await waitFor(() => expect(getChannelStats).toHaveBeenCalledTimes(2));
  });

  it('does not fetch without a client', () => {
    renderHook(() => useChannelStats('ch:noclient', null));
    expect(getChannelStats).not.toHaveBeenCalled();
  });

  it('shares one request between two hook instances on the same channel', async () => {
    getChannelStats.mockResolvedValue(stats(3));
    const a = renderHook(() => useChannelStats('ch:shared', client));
    const b = renderHook(() => useChannelStats('ch:shared', client));
    await waitFor(() => expect(a.result.current.stats?.count).toBe(3));
    await waitFor(() => expect(b.result.current.stats?.count).toBe(3));
    expect(getChannelStats).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected request, so the next render retries', async () => {
    getChannelStats.mockRejectedValueOnce(new Error('boom'));
    const { result, unmount } = renderHook(() => useChannelStats('ch:retry', client));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    unmount();

    getChannelStats.mockResolvedValueOnce(stats(5));
    const retry = renderHook(() => useChannelStats('ch:retry', client));
    await waitFor(() => expect(retry.result.current.stats?.count).toBe(5));
    expect(getChannelStats).toHaveBeenCalledTimes(2);
  });
});
