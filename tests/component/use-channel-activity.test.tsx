import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelActivity } from '@/hooks/useChannelActivity';
import { useStore } from '@/lib/store';
import type { ChannelActivity } from '../../src/shared/types';

const emptyWindow = (len: number) => ({ buckets: new Array(len).fill(0), total: 0, prevTotal: 0, startMs: 0 });
const payload = (): ChannelActivity => ({
  windows: { '24h': emptyWindow(24), '7d': emptyWindow(7), '30d': emptyWindow(30) },
  peakBand: null,
  quietBand: null,
  lastTs: 1_700_000_000_000,
});

const getChannelActivity = vi.fn(async () => payload());
vi.mock('@/lib/api', () => ({
  api: {
    getChannelActivity: (...args: unknown[]) => getChannelActivity(...(args as [])),
  },
}));

const client = {} as never;

describe('useChannelActivity', () => {
  beforeEach(() => {
    getChannelActivity.mockClear();
  });

  it('fetches on mount and exposes the payload', async () => {
    const { result } = renderHook(() => useChannelActivity('ch:Test', client));
    await waitFor(() => expect(result.current.activity).toBeTruthy());
    expect(result.current.loading).toBe(false);
    expect(result.current.activity?.windows['30d'].buckets).toHaveLength(30);
  });

  it('refetches when the channel message list changes', async () => {
    renderHook(() => useChannelActivity('ch:Test', client));
    await waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(1));
    act(() => {
      useStore.setState((s) => ({ messagesByKey: { ...s.messagesByKey, 'ch:Test': [] } }));
    });
    await waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(2));
  });

  it('surfaces a fetch error', async () => {
    getChannelActivity.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useChannelActivity('ch:Test', client));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });
});
