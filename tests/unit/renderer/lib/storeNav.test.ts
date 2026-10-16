import { beforeEach, describe, expect, it } from 'vitest';
import { selectAnySettingsDirty, useStore } from '../../../../src/renderer/lib/store';
import type { ActiveKey } from '../../../../src/shared/keys';
import { DEFAULT_UI_STATE } from '../../../../src/shared/types';

// Navigation and the Settings unsaved-changes guard share one slice because
// they write each other's state: a guarded move parks its target in
// settingsUi, and resolving the prompt commits the move through the same
// history/recents logic as an unguarded one. storeNavGuard.test.ts covers the
// guard firing; this file covers history, recents and the deferred commit.

const initial = useStore.getState();
const at = (activeKey: ActiveKey) =>
  useStore.setState({ ui: { ...structuredClone(DEFAULT_UI_STATE), activeKey }, navPast: [], navFuture: [] });

// zustand allocates a new root object even for a `{}` update, so "nothing
// changed" means every member kept its identity.
function expectUnchanged(before: ReturnType<typeof useStore.getState>) {
  const after = useStore.getState();
  for (const [k, v] of Object.entries(before)) expect(after[k as keyof typeof after], k).toBe(v);
}

beforeEach(() => {
  useStore.setState(initial, true);
  at('ch:start');
});

describe('setActiveKey', () => {
  it('is a no-op on the already-active key', () => {
    const before = useStore.getState();
    before.setActiveKey('ch:start');
    expectUnchanged(before);
  });

  it('pushes the previous key onto the back stack and clears the forward stack', () => {
    useStore.setState({ navFuture: ['ch:later'] });
    useStore.getState().setActiveKey('ch:a');
    const s = useStore.getState();
    expect(s.ui.activeKey).toBe('ch:a');
    expect(s.navPast).toEqual(['ch:start']);
    expect(s.navFuture).toEqual([]);
  });

  it('leaves both stacks alone with skipHistory', () => {
    useStore.setState({ navPast: ['ch:p'], navFuture: ['ch:f'] });
    useStore.getState().setActiveKey('ch:a', { skipHistory: true });
    const s = useStore.getState();
    expect(s.ui.activeKey).toBe('ch:a');
    expect(s.navPast).toEqual(['ch:p']);
    expect(s.navFuture).toEqual(['ch:f']);
  });

  it('does not push a duplicate of the top of the back stack', () => {
    useStore.setState({ navPast: ['ch:start'] });
    useStore.getState().setActiveKey('ch:a');
    expect(useStore.getState().navPast).toEqual(['ch:start']);
  });

  it('caps the back stack at 50, dropping the oldest', () => {
    useStore.setState({ navPast: Array.from({ length: 50 }, (_, i): ActiveKey => `ch:${i}`) });
    useStore.getState().setActiveKey('ch:a');
    const past = useStore.getState().navPast;
    expect(past).toHaveLength(50);
    expect(past[0]).toBe('ch:1');
    expect(past[49]).toBe('ch:start');
  });

  it('moves the key to the front of recents, deduped and capped at 10', () => {
    const recents = Array.from({ length: 10 }, (_, i): ActiveKey => `ch:${i}`);
    useStore.setState({ ui: { ...useStore.getState().ui, recentKeys: recents } });
    useStore.getState().setActiveKey('ch:5');
    expect(useStore.getState().ui.recentKeys).toEqual(['ch:5', ...recents.filter((k) => k !== 'ch:5')]);
    useStore.getState().setActiveKey('ch:new');
    const next = useStore.getState().ui.recentKeys;
    expect(next).toHaveLength(10);
    expect(next[0]).toBe('ch:new');
  });

  it('clears the per-view selections', () => {
    useStore.setState({
      selectedMessageId: 'm1',
      ui: { ...useStore.getState().ui, selectedContactKey: 'c:a', selectedSiteKey: 'site:1' },
    });
    useStore.getState().setActiveKey('ch:a');
    const s = useStore.getState();
    expect(s.selectedMessageId).toBeNull();
    expect(s.ui.selectedContactKey).toBeNull();
    expect(s.ui.selectedSiteKey).toBeNull();
  });

  it('opens the right rail on the Contact Manager and preserves it elsewhere', () => {
    useStore.setState({ ui: { ...useStore.getState().ui, rightOpen: false } });
    useStore.getState().setActiveKey('ch:a');
    expect(useStore.getState().ui.rightOpen).toBe(false);
    useStore.getState().setActiveKey('tool:contacts');
    expect(useStore.getState().ui.rightOpen).toBe(true);
  });
});

describe('goBack / goForward', () => {
  it('are no-ops on an empty stack', () => {
    const before = useStore.getState();
    before.goBack();
    before.goForward();
    expectUnchanged(before);
  });

  it('walk back and forward through history', () => {
    useStore.getState().setActiveKey('ch:a');
    useStore.getState().setActiveKey('ch:b');
    useStore.getState().goBack();
    expect(useStore.getState()).toMatchObject({ navPast: ['ch:start'], navFuture: ['ch:b'] });
    expect(useStore.getState().ui.activeKey).toBe('ch:a');
    useStore.getState().goForward();
    expect(useStore.getState()).toMatchObject({ navPast: ['ch:start', 'ch:a'], navFuture: [] });
    expect(useStore.getState().ui.activeKey).toBe('ch:b');
  });
});

describe('Settings tabs and the deferred commit', () => {
  beforeEach(() => at('tool:settings'));

  it('setSettingsTab switches straight away when nothing is dirty', () => {
    useStore.getState().setSettingsTab('radio');
    expect(useStore.getState().settingsUi).toMatchObject({ activeTab: 'radio', pendingTarget: null });
  });

  it('setSettingsTab parks the tab when a section is dirty', () => {
    useStore.getState().setSectionDirty('app-behavior', true);
    expect(selectAnySettingsDirty(useStore.getState())).toBe(true);
    useStore.getState().setSettingsTab('radio');
    expect(useStore.getState().settingsUi).toMatchObject({
      activeTab: 'app',
      pendingTarget: { kind: 'tab', tab: 'radio' },
    });
    useStore.getState().commitPendingTarget();
    expect(useStore.getState().settingsUi).toMatchObject({ activeTab: 'radio', pendingTarget: null });
  });

  it('commitPendingTarget carries out a parked navigation as a fresh forward move', () => {
    useStore.setState({ navPast: ['ch:p'], navFuture: ['ch:f'], selectedMessageId: 'm1' });
    useStore.getState().setSectionDirty('app-behavior', true);
    useStore.getState().goBack();
    expect(useStore.getState().settingsUi.pendingTarget).toEqual({ kind: 'nav', key: 'ch:p' });
    useStore.getState().commitPendingTarget();
    const s = useStore.getState();
    expect(s.ui.activeKey).toBe('ch:p');
    expect(s.ui.recentKeys[0]).toBe('ch:p');
    expect(s.navPast).toEqual(['ch:p', 'tool:settings']);
    expect(s.navFuture).toEqual([]);
    expect(s.selectedMessageId).toBeNull();
    expect(s.settingsUi.pendingTarget).toBeNull();
  });

  it('commitPendingTarget only clears a parked quit', () => {
    useStore.getState().setPendingTarget({ kind: 'quit' });
    useStore.getState().commitPendingTarget();
    const s = useStore.getState();
    expect(s.settingsUi.pendingTarget).toBeNull();
    expect(s.ui.activeKey).toBe('tool:settings');
  });

  it('commitPendingTarget does nothing without a parked target', () => {
    const before = useStore.getState();
    before.commitPendingTarget();
    expectUnchanged(before);
  });

  it('setSectionDirty keeps settingsUi identity when the flag is unchanged', () => {
    const before = useStore.getState().settingsUi;
    useStore.getState().setSectionDirty('app-behavior', false);
    expect(useStore.getState().settingsUi).toBe(before);
  });

  it('clearSettingsUi resets the panel state', () => {
    useStore.getState().setSectionDirty('app-behavior', true);
    useStore.getState().setPendingTarget({ kind: 'quit' });
    useStore.getState().clearSettingsUi();
    expect(useStore.getState().settingsUi).toEqual(initial.settingsUi);
    expect(selectAnySettingsDirty(useStore.getState())).toBe(false);
  });
});
