import type { ILogObjMeta } from 'tslog';
import { Logger } from 'tslog';
import type { LogEntry, LogLevel } from '../../shared/types';

// ---------------------------------------------------------------------------
// Level mapping (renderer-local — do not import from main)
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
// Logger
// ---------------------------------------------------------------------------
//
// Renderer logging stays in-process: tslog's default browser pretty output
// goes to the DevTools console, and the transport below tees a structured
// LogEntry into a registered sink (the Zustand store) so the in-app Logs panel
// can show renderer logs WITHOUT any IPC round-trip through main. Main and
// renderer each own their own log sources; the panel merges them by timestamp.

export const log = new Logger({ name: 'renderer', minLevel: 2 });

// ---------------------------------------------------------------------------
// Sink registration
// ---------------------------------------------------------------------------
//
// The store registers a sink via setRendererLogSink() once it's created. We
// keep this indirection so logger.ts never imports the store (store.ts already
// imports this module for setRendererLogLevel — a direct back-import would be a
// circular dependency). Until a sink is registered, renderer logs still reach
// the DevTools console; they just aren't buffered for the panel.

type RendererLogSink = (entry: LogEntry) => void;

let sink: RendererLogSink | null = null;

export function setRendererLogSink(fn: RendererLogSink | null): void {
  sink = fn;
}

// ---------------------------------------------------------------------------
// Transport: converts tslog logObj → LogEntry and hands it to the sink
// ---------------------------------------------------------------------------

type TslogObj = Record<string | number, unknown> & ILogObjMeta;

let counter = 0;

log.attachTransport((logObj: unknown) => {
  if (!sink) return;
  try {
    const obj = logObj as TslogObj;
    const meta = obj._meta as {
      logLevelId: number;
      logLevelName: string;
      name?: string;
      parentNames?: string[];
    };

    const levelId = meta.logLevelId;
    const rawName = meta.logLevelName?.toLowerCase();
    const level: LogLevel = VALID_LEVELS.has(rawName) ? (rawName as LogLevel) : (LEVEL_ID_TO_NAME[levelId] ?? 'info');

    // Build logger name: join parent names + own name
    const nameParts: string[] = [];
    if (meta.parentNames && meta.parentNames.length > 0) {
      nameParts.push(...meta.parentNames);
    }
    if (meta.name) {
      nameParts.push(meta.name);
    }
    const logger = nameParts.join('.') || 'renderer';

    // Collect positional args from numeric keys (tslog stores them as 0, 1, 2, …)
    const args: unknown[] = [];
    for (let i = 0; ; i++) {
      if (!(i in obj)) break;
      args.push(obj[i]);
    }

    // Stringify to a single message — no util.inspect in browser env
    const messageParts = args.map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    });
    const message = messageParts.join(' ');

    const hasNonString = args.some((a) => typeof a !== 'string');

    const entry: LogEntry = {
      id: `r-${++counter}`,
      ts: Date.now(),
      level,
      levelId,
      source: 'renderer',
      logger,
      message,
      ...(hasNonString && args.length > 0 ? { args } : {}),
    };

    sink(entry);
  } catch {
    // Silently swallow transport errors — never break the log call
  }
});

// ---------------------------------------------------------------------------
// setRendererLogLevel — driven by the app-settings subscription
// ---------------------------------------------------------------------------

export function setRendererLogLevel(level: LogLevel): void {
  log.settings.minLevel = LEVEL_NAME_TO_ID[level];
}
