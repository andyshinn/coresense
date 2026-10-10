import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE, type LogEntry } from '../../../../src/shared/types';

const settingsUi = () => useStore.getState().settingsUi;

beforeEach(() => {
  useStore.getState().clearSettingsUi();
  useStore.setState({
    ui: { ...structuredClone(DEFAULT_UI_STATE), activeKey: 'tool:settings' },
    navPast: ['ch:a'],
    navFuture: ['ch:b'],
    logs: [],
    rendererLogs: [],
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

describe('log ring buffers', () => {
  const entry = (n: number): LogEntry => ({
    id: `l${n}`,
    ts: n,
    level: 'info',
    levelId: 3,
    source: 'main',
    logger: 'test',
    message: `m${n}`,
  });
  const many = (count: number) => Array.from({ length: count }, (_, i) => entry(i));

  it('appendLog keeps the newest 5000 entries', () => {
    useStore.setState({ logs: many(5000) });
    useStore.getState().appendLog(entry(5000));
    const logs = useStore.getState().logs;
    expect(logs).toHaveLength(5000);
    expect(logs[0].id).toBe('l1');
    expect(logs.at(-1)?.id).toBe('l5000');
  });

  it('appendRendererLog keeps the newest 5000 entries', () => {
    useStore.setState({ rendererLogs: many(5000) });
    useStore.getState().appendRendererLog(entry(5000));
    const logs = useStore.getState().rendererLogs;
    expect(logs).toHaveLength(5000);
    expect(logs[0].id).toBe('l1');
  });

  it('replaceLogs keeps the newest 5000 entries', () => {
    useStore.getState().replaceLogs(many(5003));
    const logs = useStore.getState().logs;
    expect(logs).toHaveLength(5000);
    expect(logs[0].id).toBe('l3');
  });

  it('appendLog ignores an entry it already holds', () => {
    useStore.setState({ logs: [entry(1)] });
    const before = useStore.getState().logs;
    useStore.getState().appendLog(entry(1));
    expect(useStore.getState().logs).toBe(before);
  });
});
