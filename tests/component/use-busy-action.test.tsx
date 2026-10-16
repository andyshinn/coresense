import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBusyAction } from '@/hooks/useBusyAction';
import { notify } from '../support/notifyMock';

vi.mock('@/lib/notify', () => import('../support/notifyMock'));

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useBusyAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is busy while the action runs and idle after', async () => {
    const d = deferred();
    const { result } = renderHook(() => useBusyAction(() => d.promise, 'Fetch'));
    expect(result.current[1]).toBe(false);
    let done!: Promise<void>;
    act(() => {
      done = result.current[0]();
    });
    expect(result.current[1]).toBe(true);
    await act(async () => {
      d.resolve();
      await done;
    });
    expect(result.current[1]).toBe(false);
  });

  it('drops a second call made while the first is still in flight', async () => {
    const d = deferred();
    const fn = vi.fn(() => d.promise);
    const { result } = renderHook(() => useBusyAction(fn, 'Fetch'));
    let first!: Promise<void>;
    act(() => {
      first = result.current[0]();
      void result.current[0]();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve();
      await first;
    });
    await act(() => result.current[0]());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reports a throw as "<label> failed" and clears busy', async () => {
    const err = new Error('boom');
    const { result } = renderHook(() => useBusyAction(() => Promise.reject(err), 'ACL fetch'));
    await act(() => result.current[0]());
    expect(notify.failure).toHaveBeenCalledWith('ACL fetch', err);
    expect(result.current[1]).toBe(false);
  });
});
