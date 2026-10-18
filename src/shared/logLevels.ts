// Log level names, in tslog's numeric order: a level's index here IS its tslog
// level id (0 = silly … 6 = fatal). Shared so main and the renderer map names
// and ids the same way.

/** All log levels, ordered by tslog level id. */
export const LOG_LEVELS = ['silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** True iff `x` is exactly one of the level names. */
export function isLogLevel(x: unknown): x is LogLevel {
  return typeof x === 'string' && (LOG_LEVELS as readonly string[]).includes(x);
}

/** Case-insensitive level-name parse (e.g. an env var); null if it names no level. */
export function parseLogLevel(raw: string | null | undefined): LogLevel | null {
  const name = raw?.toLowerCase();
  return isLogLevel(name) ? name : null;
}

/** tslog numeric level id for a level name. */
export function logLevelId(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

/** Level name for a tslog numeric level id; undefined for an unknown id. */
export function logLevelFromId(id: number): LogLevel | undefined {
  return Number.isInteger(id) ? LOG_LEVELS[id] : undefined;
}

/** Level for a tslog record: its level name, else its numeric id, else 'info'. */
export function resolveLogLevel(name: string | undefined, id: number): LogLevel {
  return parseLogLevel(name) ?? logLevelFromId(id) ?? 'info';
}
