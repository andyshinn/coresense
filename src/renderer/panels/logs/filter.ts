import { logLevelId } from '../../../shared/logLevels';
import type { LogEntry, LogsFilter, LogsSearch } from '../../../shared/types';

export function filterLogs(entries: LogEntry[], filter: LogsFilter & LogsSearch): LogEntry[] {
  const minLevelId = logLevelId(filter.minLevel);
  const loggerNeedle = filter.loggerSubstring.toLowerCase().trim();
  const textNeedle = filter.textSubstring.toLowerCase().trim();
  return entries.filter((e) => {
    if (logLevelId(e.level) < minLevelId) return false;
    if (e.source === 'main' && !filter.showMain) return false;
    if (e.source === 'renderer' && !filter.showRenderer) return false;
    if (loggerNeedle && !e.logger.toLowerCase().includes(loggerNeedle)) return false;
    if (textNeedle && !e.message.toLowerCase().includes(textNeedle)) return false;
    return true;
  });
}
