import type { AppSettings, LogLevel } from '../../shared/types';
import { setLogLevel } from '../log';
import { setEnabled as setFileSinkEnabled } from './fileSink';

const VALID_LEVELS = new Set<LogLevel>(['silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal']);

/** A CORESENSE_LOG_LEVEL env override, if it names a valid level. Lets
 *  `CORESENSE_LOG_LEVEL=trace pnpm start` win over the persisted setting for
 *  debugging — otherwise the saved level (default 'info') silently clobbers it,
 *  and lazily-created child loggers (e.g. transport:ble, made on connect) never
 *  emit their trace frames. */
function envLogLevelOverride(): LogLevel | null {
  const raw = process.env.CORESENSE_LOG_LEVEL?.toLowerCase();
  return raw && VALID_LEVELS.has(raw as LogLevel) ? (raw as LogLevel) : null;
}

export function applyLoggingSettings(logging: AppSettings['logging']): void {
  setLogLevel(envLogLevelOverride() ?? logging.level);
  setFileSinkEnabled(logging.fileEnabled);
}
