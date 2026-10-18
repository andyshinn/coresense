import { describe, expect, it } from 'vitest';
import {
  isLogLevel,
  LOG_LEVELS,
  logLevelFromId,
  logLevelId,
  parseLogLevel,
  resolveLogLevel,
} from '../../../src/shared/logLevels';

describe('log levels', () => {
  it('orders levels by tslog id', () => {
    expect(LOG_LEVELS.map(logLevelId)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(logLevelId('silly')).toBe(0);
    expect(logLevelId('info')).toBe(3);
    expect(logLevelId('fatal')).toBe(6);
  });

  it('maps ids back to names, undefined for unknown ids', () => {
    expect(logLevelFromId(2)).toBe('debug');
    expect(logLevelFromId(7)).toBeUndefined();
    expect(logLevelFromId(-1)).toBeUndefined();
    expect(logLevelFromId(1.5)).toBeUndefined();
  });

  it('isLogLevel accepts only exact level names', () => {
    expect(isLogLevel('warn')).toBe(true);
    expect(isLogLevel('WARN')).toBe(false);
    expect(isLogLevel('constructor')).toBe(false);
    expect(isLogLevel(3)).toBe(false);
    expect(isLogLevel(undefined)).toBe(false);
  });

  it('parseLogLevel is case-insensitive and null for anything else', () => {
    expect(parseLogLevel('TRACE')).toBe('trace');
    expect(parseLogLevel('error')).toBe('error');
    expect(parseLogLevel('verbose')).toBeNull();
    expect(parseLogLevel('')).toBeNull();
    expect(parseLogLevel(undefined)).toBeNull();
    expect(parseLogLevel(null)).toBeNull();
    // Object.prototype keys are not levels (CORESENSE_LOG_LEVEL=constructor
    // falls back to the default rather than yielding a non-number minLevel).
    expect(parseLogLevel('constructor')).toBeNull();
  });

  it('resolveLogLevel prefers the name, then the id, then info', () => {
    expect(resolveLogLevel('WARN', 0)).toBe('warn');
    expect(resolveLogLevel(undefined, 5)).toBe('error');
    expect(resolveLogLevel('custom', 1)).toBe('trace');
    expect(resolveLogLevel('custom', 99)).toBe('info');
  });
});
