import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE, type UiState } from '../../../../src/shared/types';

const incoming = (patch: Partial<UiState> = {}): UiState => ({ ...DEFAULT_UI_STATE, ...patch });

const setUi = (patch: Partial<UiState>) => useStore.setState((s) => ({ ui: { ...s.ui, ...patch } }));

beforeEach(() => {
  useStore.setState({ ui: { ...DEFAULT_UI_STATE }, drafts: {} });
});

describe('applyUiState echo handling', () => {
  test('an echo carrying nothing new preserves ui identity', () => {
    setUi({ lastReadByKey: { 'ch:a': 500 } });
    const before = useStore.getState().ui;

    useStore.getState().applyUiState(incoming({ lastReadByKey: { 'ch:a': 500 } }));

    // Identity is what the persistence subscriber filters on; a new object
    // here would bounce a PUT straight back at the sender.
    expect(useStore.getState().ui).toBe(before);
  });

  // The 2-cycle this guards: two markRead advances land inside one loopback
  // round trip, so the first echo arrives carrying an already-stale cursor.
  test('a stale echo does not drag the read cursor backwards', () => {
    setUi({ lastReadByKey: { 'ch:a': 2000 } });
    const before = useStore.getState().ui;

    useStore.getState().applyUiState(incoming({ lastReadByKey: { 'ch:a': 1000 } }));

    expect(useStore.getState().ui.lastReadByKey['ch:a']).toBe(2000);
    expect(useStore.getState().ui).toBe(before);
  });

  test('a newer echo is adopted, and per key', () => {
    setUi({ lastReadByKey: { 'ch:a': 1000, 'ch:b': 9000 } });

    useStore.getState().applyUiState(incoming({ lastReadByKey: { 'ch:a': 3000, 'ch:b': 1 } }));

    expect(useStore.getState().ui.lastReadByKey).toEqual({ 'ch:a': 3000, 'ch:b': 9000 });
  });

  test('a key only the other client knows about is adopted', () => {
    setUi({ lastReadByKey: { 'ch:a': 1000 } });

    useStore.getState().applyUiState(incoming({ lastReadByKey: { 'ch:a': 1000, 'ch:b': 40 } }));

    expect(useStore.getState().ui.lastReadByKey).toEqual({ 'ch:a': 1000, 'ch:b': 40 });
  });

  test('applying a peer ui never disturbs local drafts', () => {
    useStore.setState({ drafts: { 'ch:a': 'mine, still typing' } });

    useStore.getState().applyUiState(incoming({ lastReadByKey: { 'ch:a': 5 } }));

    expect(useStore.getState().drafts).toEqual({ 'ch:a': 'mine, still typing' });
  });
});
