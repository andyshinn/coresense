import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelActivity } from '@/hooks/useChannelActivity';
import { useStore } from '@/lib/store';
import type { ChannelActivity } from '../../src/shared/types';
import { renderHookWithClient } from '../support/renderWithClient';

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

describe('useChannelActivity', () => {
  beforeEach(() => {
    getChannelActivity.mockClear();
  });

  it('fetches on mount and exposes the payload', async () => {
    const { result } = renderHookWithClient(() => useChannelActivity('ch:Test'));
    await waitFor(() => expect(result.current.activity).toBeTruthy());
    expect(result.current.loading).toBe(false);
    expect(result.current.activity?.windows['30d'].buckets).toHaveLength(30);
  });

  it('refetches when the channel message list changes', async () => {
    renderHookWithClient(() => useChannelActivity('ch:Test'));
    await waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(1));
    act(() => {
      useStore.setState((s) => ({ messagesByKey: { ...s.messagesByKey, 'ch:Test': [] } }));
    });
    await waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(2));
  });

  it("does not refetch when another conversation's message changes state", async () => {
    useStore.setState({
      messagesByKey: {
        'ch:Test': [{ id: 'c1', key: 'ch:Test', body: 'hi', ts: 1, state: 'received' }],
        'c:dm': [{ id: 'd1', key: 'c:dm', body: 'yo', ts: 2, state: 'sending' }],
      },
    });
    renderHookWithClient(() => useChannelActivity('ch:Test'));
    await waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(1));
    // Used to rebuild every key's array, so the channel's list changed identity
    // and the histogram refetched on every DM delivery-state transition.
    await act(async () => {
      useStore.getState().applyMessageState('d1', 'ack');
    });
    expect(getChannelActivity).toHaveBeenCalledTimes(1);
  });

  it('surfaces a fetch error', async () => {
    getChannelActivity.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHookWithClient(() => useChannelActivity('ch:Test'));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });

  it('keeps the refresh timer on its own schedule when messages arrive', async () => {
    vi.useFakeTimers();
    try {
      renderHookWithClient(() => useChannelActivity('ch:Test'));
      await vi.waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(1));

      // Four minutes in, a message push forces its own refetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(240_000);
      });
      await act(async () => {
        useStore.setState((s) => ({ messagesByKey: { ...s.messagesByKey, 'ch:Test': [] } }));
      });
      await vi.waitFor(() => expect(getChannelActivity).toHaveBeenCalledTimes(2));

      // One more minute reaches the 5-minute mark measured from MOUNT. If the
      // push had re-created the interval, this would not fire until 8 minutes.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(getChannelActivity).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the refresh interval on unmount', () => {
    // A leaked interval only ever calls `setTick`; on an unmounted component that
    // never re-renders or re-runs an effect, so it can't be observed through the
    // fetch mock's call count. Assert on the pending timer itself instead.
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      const { unmount } = renderHookWithClient(() => useChannelActivity('ch:Test'));
      // The hook owns exactly one long-lived interval while mounted.
      expect(vi.getTimerCount()).toBeGreaterThan(before);
      unmount();
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
