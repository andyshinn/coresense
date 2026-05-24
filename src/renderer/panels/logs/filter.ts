import type { LogEntry, LogLevel, UiState } from '../../../shared/types';

const LEVEL_ORDER: Record<LogLevel, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

export function filterLogs(entries: LogEntry[], filter: UiState['logsFilter']): LogEntry[] {
  const minLevelId = LEVEL_ORDER[filter.minLevel];
  const loggerNeedle = filter.loggerSubstring.toLowerCase().trim();
  const textNeedle = filter.textSubstring.toLowerCase().trim();
  return entries.filter((e) => {
    if (LEVEL_ORDER[e.level] < minLevelId) return false;
    if (e.source === 'main' && !filter.showMain) return false;
    if (e.source === 'renderer' && !filter.showRenderer) return false;
    if (loggerNeedle && !e.logger.toLowerCase().includes(loggerNeedle)) return false;
    if (textNeedle && !e.message.toLowerCase().includes(textNeedle)) return false;
    return true;
  });
}
