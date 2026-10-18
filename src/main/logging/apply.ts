import { type LogLevel, parseLogLevel } from '../../shared/logLevels';
import type { AppSettings } from '../../shared/types';
import { setLogLevel } from '../log';
import { setEnabled as setFileSinkEnabled } from './fileSink';

/** A CORESENSE_LOG_LEVEL env override, if it names a valid level. Lets
 *  `CORESENSE_LOG_LEVEL=trace pnpm start` win over the persisted setting for
 *  debugging — otherwise the saved level (default 'info') silently clobbers it,
 *  and lazily-created child loggers (e.g. transport:ble, made on connect) never
 *  emit their trace frames. */
function envLogLevelOverride(): LogLevel | null {
  return parseLogLevel(process.env.CORESENSE_LOG_LEVEL);
}

export function applyLoggingSettings(logging: AppSettings['logging']): void {
  setLogLevel(envLogLevelOverride() ?? logging.level);
  setFileSinkEnabled(logging.fileEnabled);
}
