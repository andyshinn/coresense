import type { AppSettings } from '../../shared/types';
import { setLogLevel } from '../log';
import { setEnabled as setFileSinkEnabled } from './fileSink';

export function applyLoggingSettings(logging: AppSettings['logging']): void {
  setLogLevel(logging.level);
  setFileSinkEnabled(logging.fileEnabled);
}
