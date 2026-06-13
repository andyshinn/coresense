import type { VirtuosoMessageListProps } from '@virtuoso.dev/message-list';
import type { LogEntry, LogLevel } from '../../../shared/types';

// Mirrors tslog's default prettyLogStyles.logLevelName palette.
const LEVEL_COLOR: Record<LogLevel, string> = {
  silly: 'text-white',
  trace: 'text-white',
  debug: 'text-green-400',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  fatal: 'text-red-500',
};

function fmtLogTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export const LogRow: VirtuosoMessageListProps<LogEntry, null>['ItemContent'] = ({ data }) => {
  const source = data.source === 'main' ? 'M' : 'R';

  return (
    <div className="flex gap-2 px-4 py-0.5 font-mono text-xs hover:bg-cs-bg-3">
      <span className="inline-block shrink-0 text-cs-text-dim">{fmtLogTime(data.ts)}</span>
      <span className={`inline-block w-14 shrink-0 font-bold uppercase ${LEVEL_COLOR[data.level]}`}>{data.level}</span>
      <span className="inline-block shrink-0 text-cs-text-dim">{source}</span>
      <span className="inline-block shrink-0 font-bold text-cs-text">[{data.logger}]</span>
      <span className="inline-block min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-cs-text">{data.message}</span>
    </div>
  );
};
