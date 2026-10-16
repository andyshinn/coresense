import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE } from '../../../../src/shared/types';

const settingsUi = () => useStore.getState().settingsUi;

beforeEach(() => {
  useStore.getState().clearSettingsUi();
  useStore.setState({
    ui: { ...structuredClone(DEFAULT_UI_STATE), activeKey: 'tool:settings' },
    navPast: ['ch:a'],
    navFuture: ['ch:b'],
  });
});

describe('Settings unsaved-changes guard on navigation', () => {
  it.each([
    ['setActiveKey', () => useStore.getState().setActiveKey('ch:c'), 'ch:c'],
    ['goBack', () => useStore.getState().goBack(), 'ch:a'],
    ['goForward', () => useStore.getState().goForward(), 'ch:b'],
  ])('%s out of a dirty Settings panel stashes the target instead of navigating', (_name, nav, target) => {
    useStore.getState().setSectionDirty('radio', true);
    nav();
    const s = useStore.getState();
    expect(s.ui.activeKey).toBe('tool:settings');
    expect(s.navPast).toEqual(['ch:a']);
    expect(s.navFuture).toEqual(['ch:b']);
    expect(settingsUi().pendingTarget).toEqual({ kind: 'nav', key: target });
  });

  it.each([
    ['setActiveKey', () => useStore.getState().setActiveKey('ch:c'), 'ch:c'],
    ['goBack', () => useStore.getState().goBack(), 'ch:a'],
    ['goForward', () => useStore.getState().goForward(), 'ch:b'],
  ])('%s out of a clean Settings panel navigates', (_name, nav, target) => {
    nav();
    expect(useStore.getState().ui.activeKey).toBe(target);
    expect(settingsUi().pendingTarget).toBeNull();
  });

  it('does not guard a move between Settings keys', () => {
    useStore.getState().setSectionDirty('radio', true);
    useStore.getState().setActiveKey('tool:settings:radio');
    expect(useStore.getState().ui.activeKey).toBe('tool:settings:radio');
    expect(settingsUi().pendingTarget).toBeNull();
  });
});
