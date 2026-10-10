import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import type { LogEntry } from '../../../../src/shared/types';

beforeEach(() => {
  useStore.setState({ logs: [], rendererLogs: [] });
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
