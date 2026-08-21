import { describe, expect, test } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import { filterLogs } from '../../../../src/renderer/panels/logs/filter';
import { DEFAULT_LOGS_SEARCH, DEFAULT_UI_STATE, type LogEntry } from '../../../../src/shared/types';

const entry = (patch: Partial<LogEntry> = {}): LogEntry => ({
  id: 'x',
  ts: 0,
  level: 'info',
  levelId: 3,
  source: 'main',
  logger: 'ble',
  message: 'connected',
  ...patch,
});

const base = { ...DEFAULT_UI_STATE.logsFilter, ...DEFAULT_LOGS_SEARCH };

describe('filterLogs', () => {
  test('drops entries below the minimum level', () => {
    const entries = [entry({ level: 'debug' }), entry({ level: 'error' })];
    expect(filterLogs(entries, { ...base, minLevel: 'warn' })).toEqual([entries[1]]);
  });

  test('honours the source toggles', () => {
    const entries = [entry({ source: 'main' }), entry({ source: 'renderer' })];
    expect(filterLogs(entries, { ...base, showMain: false })).toEqual([entries[1]]);
    expect(filterLogs(entries, { ...base, showRenderer: false })).toEqual([entries[0]]);
  });

  test('matches the logger substring case-insensitively', () => {
    const entries = [entry({ logger: 'ble' }), entry({ logger: 'transport' })];
    expect(filterLogs(entries, { ...base, loggerSubstring: '  BLE ' })).toEqual([entries[0]]);
  });

  test('matches the message substring case-insensitively', () => {
    const entries = [entry({ message: 'Connected' }), entry({ message: 'dropped' })];
    expect(filterLogs(entries, { ...base, textSubstring: 'conn' })).toEqual([entries[0]]);
  });

  test('an empty substring is not a filter', () => {
    const entries = [entry(), entry({ logger: 'other' })];
    expect(filterLogs(entries, { ...base, loggerSubstring: '   ' })).toEqual(entries);
  });
});

describe('logs search is session-only', () => {
  // The reason it moved out of `ui`: these are live text inputs, so every
  // character was landing on the persisted write path.
  test('typing a filter does not touch the ui slice', () => {
    useStore.setState({ logsSearch: { ...DEFAULT_LOGS_SEARCH } });
    const before = useStore.getState().ui;

    useStore.getState().setLogsSearch({ textSubstring: 'ble' });
    useStore.getState().setLogsSearch({ loggerSubstring: 'transport' });

    expect(useStore.getState().ui).toBe(before);
    expect(useStore.getState().logsSearch).toEqual({ loggerSubstring: 'transport', textSubstring: 'ble' });
  });

  test('the persisted logs filter no longer carries the substrings', () => {
    expect(DEFAULT_UI_STATE.logsFilter).not.toHaveProperty('loggerSubstring');
    expect(DEFAULT_UI_STATE.logsFilter).not.toHaveProperty('textSubstring');
  });
});
