import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UiState } from '../../src/shared/types';

const { putUiState } = vi.hoisted(() => ({ putUiState: vi.fn(async () => {}) }));
vi.mock('@/lib/api', () => ({ api: { putUiState } }));

import { useUiStatePersistence } from '@/app/useUiStatePersistence';
import { useStore } from '@/lib/store';

const CLIENT = { baseUrl: 'http://127.0.0.1:7654', apiKey: 'k' };
const COALESCE_MS = 250;

/** Counts its own renders so a test can assert the persistence hook never
 *  drags its host — in the real app, the App root — into a re-render. */
function Host({ onRender }: { onRender: () => void }) {
  onRender();
  useUiStatePersistence(CLIENT, true);
  return null;
}

const sentStates = () => putUiState.mock.calls.map((c) => (c as unknown as [unknown, UiState])[1]);
// Let the write chain's promise callbacks run.
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  putUiState.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    useStore.setState({ drafts: {} });
    useStore.setState((s) => ({ ui: { ...s.ui, lastReadByKey: {} } }));
  });
});

describe('useUiStatePersistence', () => {
  // The original regression: App.tsx read the whole `ui` object with
  // `useStore((s) => s.ui)` purely to persist it, so every store change that
  // touched `ui` re-rendered the app ROOT — and with no memo boundaries below
  // it, the entire tree.
  test('does not re-render its host when ui changes', () => {
    const onRender = vi.fn();
    render(<Host onRender={onRender} />);
    const before = onRender.mock.calls.length;

    act(() => {
      useStore.getState().markRead('ch:test', 1000);
      useStore.getState().markRead('ch:test', 2000);
    });

    expect(onRender.mock.calls.length).toBe(before);
  });

  // The drafts split: typing must not reach this path at all.
  test('a composer draft does not touch ui, so it never schedules a write', async () => {
    render(<Host onRender={() => {}} />);
    const uiBefore = useStore.getState().ui;

    act(() => {
      useStore.getState().setDraft('ch:test', 'hello');
    });
    await settle();
    act(() => {
      vi.advanceTimersByTime(COALESCE_MS * 4);
    });
    await settle();

    expect(useStore.getState().ui).toBe(uiBefore);
    expect(putUiState).not.toHaveBeenCalled();
  });

  test('writes the first change immediately, without waiting for a window', async () => {
    render(<Host onRender={() => {}} />);

    act(() => {
      useStore.getState().markRead('ch:test', 1000);
    });
    await settle();

    expect(putUiState).toHaveBeenCalledTimes(1);
    expect(sentStates()[0].lastReadByKey['ch:test']).toBe(1000);
  });

  test('coalesces a burst into one leading and one trailing write', async () => {
    render(<Host onRender={() => {}} />);

    for (const ts of [1000, 2000, 3000, 4000, 5000]) {
      act(() => {
        useStore.getState().markRead('ch:test', ts);
      });
      await settle();
      act(() => {
        vi.advanceTimersByTime(20);
      });
    }
    // Leading edge only so far — the rest are still collapsed.
    expect(putUiState).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(COALESCE_MS);
    });
    await settle();

    expect(putUiState).toHaveBeenCalledTimes(2);
    // The trailing write carries the newest value, not a stale queued one.
    expect(sentStates()[1].lastReadByKey['ch:test']).toBe(5000);
  });

  test('hydrating a snapshot does not immediately PUT it straight back', async () => {
    render(<Host onRender={() => {}} />);
    await settle();
    expect(putUiState).not.toHaveBeenCalled();
  });

  test('stops writing once the host unmounts', async () => {
    const view = render(<Host onRender={() => {}} />);
    act(() => {
      useStore.getState().markRead('ch:test', 1000);
    });
    await settle();
    putUiState.mockClear();

    view.unmount();
    act(() => {
      useStore.getState().markRead('ch:test', 2000);
      vi.advanceTimersByTime(COALESCE_MS * 4);
    });
    await settle();

    expect(putUiState).not.toHaveBeenCalled();
  });
});
