import { beforeEach, describe, expect, it } from 'vitest';
import { selectAnyUnsaved, useStore } from '../../../../src/renderer/lib/store';
import { NODE_TELEMETRY_KEY } from '../../../../src/shared/keys';
import { DEFAULT_UI_STATE } from '../../../../src/shared/types';

const settingsUi = () => useStore.getState().settingsUi;

beforeEach(() => {
  useStore.getState().clearSettingsUi();
  useStore.getState().setLocationDirty(false);
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

describe('My Node position-draft guard on navigation', () => {
  beforeEach(() => {
    useStore.setState({ ui: { ...structuredClone(DEFAULT_UI_STATE), activeKey: 'tool:node' } });
  });

  it.each([
    ['setActiveKey', () => useStore.getState().setActiveKey('ch:c'), 'ch:c'],
    ['goBack', () => useStore.getState().goBack(), 'ch:a'],
    ['goForward', () => useStore.getState().goForward(), 'ch:b'],
  ])('%s out of My Node with an unsaved position stashes the target', (_name, nav, target) => {
    useStore.getState().setLocationDirty(true);
    nav();
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
    expect(settingsUi().pendingTarget).toEqual({ kind: 'nav', key: target });
  });

  it('guards the move to its own telemetry view too (the Location card unmounts there)', () => {
    useStore.getState().setLocationDirty(true);
    useStore.getState().setActiveKey(NODE_TELEMETRY_KEY);
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
    expect(settingsUi().pendingTarget).toEqual({ kind: 'nav', key: NODE_TELEMETRY_KEY });
  });

  it('lets the move through once the user resolves the prompt', () => {
    useStore.getState().setLocationDirty(true);
    useStore.getState().setActiveKey('ch:c');
    useStore.getState().commitPendingTarget();
    expect(useStore.getState().ui.activeKey).toBe('ch:c');
    expect(settingsUi().pendingTarget).toBeNull();
  });

  it('a clean My Node navigates', () => {
    useStore.getState().setActiveKey('ch:c');
    expect(useStore.getState().ui.activeKey).toBe('ch:c');
    expect(settingsUi().pendingTarget).toBeNull();
  });

  it('a stray dirty flag elsewhere does not block', () => {
    useStore.setState({ ui: { ...structuredClone(DEFAULT_UI_STATE), activeKey: 'ch:a' } });
    useStore.getState().setLocationDirty(true);
    useStore.getState().setActiveKey('ch:c');
    expect(useStore.getState().ui.activeKey).toBe('ch:c');
  });

  it('counts as unsaved for quit', () => {
    expect(selectAnyUnsaved(useStore.getState())).toBe(false);
    useStore.getState().setLocationDirty(true);
    expect(selectAnyUnsaved(useStore.getState())).toBe(true);
  });
});
