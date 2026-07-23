import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE, type UiState } from '../../../../src/shared/types';

describe('recordEmojiUse', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE } });
  });

  it('increments usage count for the emoji', () => {
    useStore.getState().recordEmojiUse('📡');
    useStore.getState().recordEmojiUse('📡');
    expect(useStore.getState().ui.emojiUsage['📡'].count).toBe(2);
  });
});

describe('applyUiState merges emojiUsage (account-global)', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE } });
  });

  it('adopts a remote emojiUsage broadcast', () => {
    useStore.getState().applyUiState({
      ...DEFAULT_UI_STATE,
      emojiUsage: { '🔥': { count: 4, lastUsedMs: 123 } },
    });
    expect(useStore.getState().ui.emojiUsage['🔥'].count).toBe(4);
  });

  it('applyUiState with an equal-value emojiUsage echo preserves ui identity (no re-PUT loop)', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, emojiUsage: { '🔥': { count: 3, lastUsedMs: 42 } } } });
    const before = useStore.getState().ui;
    // Simulate a broadcast echo: same values, but fresh object references, as a
    // JSON round-trip over the wire would produce.
    const incoming = { ...DEFAULT_UI_STATE, emojiUsage: { '🔥': { count: 3, lastUsedMs: 42 } } };
    useStore.getState().applyUiState(incoming);
    expect(useStore.getState().ui).toBe(before); // identity preserved -> App effect won't re-fire
  });

  it('tolerates a payload that omits emojiUsage (legacy/partial producer) without throwing', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, emojiUsage: { '🔥': { count: 1, lastUsedMs: 1 } } } });
    const legacy: UiState = { ...DEFAULT_UI_STATE };
    delete (legacy as { emojiUsage?: unknown }).emojiUsage;
    expect(() => useStore.getState().applyUiState(legacy)).not.toThrow();
    // A missing field coalesces to an empty object, never undefined.
    expect(useStore.getState().ui.emojiUsage).toEqual({});
  });
});
