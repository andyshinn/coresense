import * as util from 'node:util';
import { type ILogObjMeta, Logger } from 'tslog';
import { type LogLevel, logLevelFromId, logLevelId, parseLogLevel } from '../shared/logLevels';
import type { LogEntry } from '../shared/types';
import { emit } from './events/bus';
import { write as fileSinkWrite } from './logging/fileSink';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 5000;

// ---------------------------------------------------------------------------
// Root logger (preserve existing behaviour)
// ---------------------------------------------------------------------------

const minLevel = (() => {
  const level = parseLogLevel(process.env.CORESENSE_LOG_LEVEL);
  return level ? logLevelId(level) : 2; // default: debug
})();

export const log = new Logger({
  name: 'coresense',
  minLevel,
  type: 'pretty',
  prettyLogTemplate: '{{hh}}:{{MM}}:{{ss}}.{{ms}} {{logLevelName}} [{{name}}] ',
  hideLogPositionForProduction: true,
});

export function child(name: string): Logger<unknown> {
  return log.getSubLogger({ name });
}

// ---------------------------------------------------------------------------
// In-memory ring buffer
// ---------------------------------------------------------------------------

const buffer: LogEntry[] = [];
let counter = 0;

function pushToBuffer(entry: LogEntry): void {
  if (buffer.length >= MAX_LOG_ENTRIES) {
    buffer.shift();
  }
  buffer.push(entry);
}

export function getLogBuffer(): readonly LogEntry[] {
  return buffer;
}

// ---------------------------------------------------------------------------
// toLogEntry — convert a tslog logObj to LogEntry
// ---------------------------------------------------------------------------

type TslogObj = Record<string | number, unknown> & ILogObjMeta;

export function toLogEntry(logObj: TslogObj): LogEntry {
  const meta = logObj._meta as {
    logLevelId: number;
    logLevelName: string;
    name?: string;
    parentNames?: string[];
  };

  const levelId = meta.logLevelId;
  const level: LogLevel = parseLogLevel(meta.logLevelName) ?? logLevelFromId(levelId) ?? 'info';

  // Build logger name: join parent names + own name (mirrors tslog's template {{name}})
  const parts: string[] = [];
  if (meta.parentNames && meta.parentNames.length > 0) {
    parts.push(...meta.parentNames);
  }
  if (meta.name) {
    parts.push(meta.name);
  }
  const logger = parts.join('.') || 'coresense';

  // Collect positional args from numeric keys (tslog stores them as 0, 1, 2, …)
  const args: unknown[] = [];
  for (let i = 0; ; i++) {
    if (!(i in logObj)) break;
    args.push(logObj[i]);
  }

  // Stringify to a single message
  const parts2 = args.map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { depth: 3, breakLength: 200 })));
  const message = parts2.join(' ');

  // Only include args if at least one was non-string
  const hasNonString = args.some((a) => typeof a !== 'string');

  const id = `m-${++counter}`;

  return {
    id,
    ts: Date.now(),
    level,
    levelId,
    source: 'main',
    logger,
    message,
    ...(hasNonString && args.length > 0 ? { args } : {}),
  };
}

// ---------------------------------------------------------------------------
// ingestLogEntry — shared pipeline: buffer + bus + file sink
// ---------------------------------------------------------------------------

export function ingestLogEntry(entry: LogEntry): void {
  pushToBuffer(entry);
  emit.logEntry(entry);
  fileSinkWrite(entry);
}

// ---------------------------------------------------------------------------
// setLogLevel
// ---------------------------------------------------------------------------

export function setLogLevel(level: LogLevel): void {
  log.settings.minLevel = logLevelId(level);
}

// ---------------------------------------------------------------------------
// Attach transport to root logger
// (sub-loggers inherit attachedTransports from parent at construction time,
//  so we attach before any child() calls happen)
// ---------------------------------------------------------------------------

log.attachTransport((logObj: unknown) => {
  const entry = toLogEntry(logObj as TslogObj);
  ingestLogEntry(entry);
});
