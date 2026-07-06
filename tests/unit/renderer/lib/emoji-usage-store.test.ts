import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE } from '../../../../src/shared/types';

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
});
