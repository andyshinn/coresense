import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { putDraft } = vi.hoisted(() => ({ putDraft: vi.fn(async () => {}) }));
vi.mock('@/lib/api', () => ({ api: { putDraft } }));

import { flushDrafts, useDraftsPersistence } from '@/app/useDraftsPersistence';
import { useStore } from '@/lib/store';

const CLIENT = { baseUrl: 'http://127.0.0.1:7654', apiKey: 'k' };

function Host() {
  useDraftsPersistence(CLIENT, true);
  return null;
}

const calls = () => putDraft.mock.calls.map((c) => (c as unknown as [unknown, string, string]).slice(1));
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  putDraft.mockClear();
  act(() => {
    useStore.setState({ drafts: {}, windowFocused: true });
  });
});

afterEach(() => {
  act(() => {
    useStore.setState({ drafts: {} });
  });
});

describe('useDraftsPersistence', () => {
  test('typing alone does not write — there is no timer to wait on', async () => {
    render(<Host />);
    for (const text of ['h', 'he', 'hel']) {
      act(() => {
        useStore.getState().setDraft('ch:one', text);
      });
    }
    await settle();
    expect(putDraft).not.toHaveBeenCalled();
  });

  test('navigating to another conversation flushes the draft', async () => {
    render(<Host />);
    act(() => {
      useStore.getState().setDraft('ch:one', 'hello');
    });
    act(() => {
      useStore.getState().setActiveKey('ch:two');
    });
    await settle();

    expect(calls()).toEqual([['ch:one', 'hello']]);
  });

  test('losing window focus flushes the draft', async () => {
    render(<Host />);
    act(() => {
      useStore.getState().setDraft('ch:one', 'hello');
    });
    act(() => {
      useStore.getState().applyWindowFocus(false);
    });
    await settle();

    expect(calls()).toEqual([['ch:one', 'hello']]);
  });

  test('regaining focus does not write anything on its own', async () => {
    render(<Host />);
    act(() => {
      useStore.getState().applyWindowFocus(false);
    });
    await settle();
    putDraft.mockClear();

    act(() => {
      useStore.getState().applyWindowFocus(true);
    });
    await settle();
    expect(putDraft).not.toHaveBeenCalled();
  });

  // A cleared draft that never reaches disk re-offers text the user already
  // sent, so removals do not wait for a boundary.
  test('clearing a draft writes the removal through immediately', async () => {
    render(<Host />);
    act(() => {
      useStore.getState().setDraft('ch:one', 'hello');
    });
    act(() => {
      useStore.getState().setDraft('ch:one', '');
    });
    await settle();

    expect(calls()).toEqual([['ch:one', '']]);
  });

  test('flushDrafts writes every touched key, one request each', async () => {
    render(<Host />);
    act(() => {
      useStore.getState().setDraft('ch:one', 'first');
      useStore.getState().setDraft('ch:two', 'second');
    });
    await act(async () => {
      await flushDrafts();
    });

    expect(calls()).toHaveLength(2);
    expect(calls()).toEqual(
      expect.arrayContaining([
        ['ch:one', 'first'],
        ['ch:two', 'second'],
      ]),
    );
  });

  test('a flush sends the latest text, not the value at the time of typing', async () => {
    render(<Host />);
    act(() => {
      useStore.getState().setDraft('ch:one', 'stale');
      useStore.getState().setDraft('ch:one', 'fresh');
    });
    await act(async () => {
      await flushDrafts();
    });

    expect(calls()).toEqual([['ch:one', 'fresh']]);
  });

  test('unmounting flushes rather than dropping the draft', async () => {
    const view = render(<Host />);
    act(() => {
      useStore.getState().setDraft('ch:one', 'hello');
    });
    view.unmount();
    await settle();

    expect(calls()).toEqual([['ch:one', 'hello']]);
  });
});
