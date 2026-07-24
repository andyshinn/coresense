import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE, type UiState } from '../../../../src/shared/types';

describe('recordMacroUse', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE } });
  });

  it('increments usage count for the macro id', () => {
    useStore.getState().recordMacroUse('mac_7f');
    useStore.getState().recordMacroUse('mac_7f');
    expect(useStore.getState().ui.macroUsage.mac_7f.count).toBe(2);
  });

  it('keeps emoji and macro tallies in separate maps', () => {
    useStore.getState().recordMacroUse('mac_7f');
    expect(useStore.getState().ui.emojiUsage.mac_7f).toBeUndefined();
  });
});

describe('applyUiState merges macroUsage (account-global)', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE } });
  });

  it('adopts a remote macroUsage broadcast', () => {
    useStore.getState().applyUiState({
      ...DEFAULT_UI_STATE,
      macroUsage: { mac_7f: { count: 4, lastUsedMs: 123 } },
    });
    expect(useStore.getState().ui.macroUsage.mac_7f.count).toBe(4);
  });

  it('an equal-value macroUsage echo preserves ui identity (no re-PUT loop)', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, macroUsage: { mac_7f: { count: 3, lastUsedMs: 42 } } } });
    const before = useStore.getState().ui;
    // Simulate a broadcast echo: same values, fresh object refs, as a JSON
    // round-trip over the wire would produce.
    const incoming = { ...DEFAULT_UI_STATE, macroUsage: { mac_7f: { count: 3, lastUsedMs: 42 } } };
    useStore.getState().applyUiState(incoming);
    expect(useStore.getState().ui).toBe(before); // identity preserved -> App effect won't re-fire
  });

  it('tolerates a payload that omits macroUsage (legacy/partial producer)', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, macroUsage: { mac_7f: { count: 1, lastUsedMs: 1 } } } });
    const legacy: UiState = { ...DEFAULT_UI_STATE };
    delete (legacy as { macroUsage?: unknown }).macroUsage;
    expect(() => useStore.getState().applyUiState(legacy)).not.toThrow();
    expect(useStore.getState().ui.macroUsage).toEqual({});
  });
});
