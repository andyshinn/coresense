import * as util from 'node:util';
import { type ILogObjMeta, Logger } from 'tslog';
import type { LogEntry, LogLevel } from '../shared/types';
import { emit } from './events/bus';
import { write as fileSinkWrite } from './logging/fileSink';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 5000;

// ---------------------------------------------------------------------------
// Level mapping: tslog numeric → LogLevel string
// ---------------------------------------------------------------------------

const LEVEL_ID_TO_NAME: Record<number, LogLevel> = {
  0: 'silly',
  1: 'trace',
  2: 'debug',
  3: 'info',
  4: 'warn',
  5: 'error',
  6: 'fatal',
};

const LEVEL_NAME_TO_ID: Record<LogLevel, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_NAME_TO_ID));

// ---------------------------------------------------------------------------
// Root logger (preserve existing behaviour)
// ---------------------------------------------------------------------------

const minLevel = (() => {
  const raw = process.env.CORESENSE_LOG_LEVEL?.toLowerCase();
  return LEVEL_NAME_TO_ID[raw as LogLevel] ?? 2; // default: debug
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
  const rawName = meta.logLevelName?.toLowerCase();
  const level: LogLevel = VALID_LEVELS.has(rawName)
    ? (rawName as LogLevel)
    : (LEVEL_ID_TO_NAME[levelId] ?? 'info');

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
  const parts2 = args.map((arg) =>
    typeof arg === 'string' ? arg : util.inspect(arg, { depth: 3, breakLength: 200 }),
  );
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
  log.settings.minLevel = LEVEL_NAME_TO_ID[level];
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
