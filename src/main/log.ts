import { Logger } from 'tslog';

const minLevel = (() => {
  const raw = process.env.CORESENSE_LOG_LEVEL?.toLowerCase();
  switch (raw) {
    case 'silly':
      return 0;
    case 'trace':
      return 1;
    case 'debug':
      return 2;
    case 'info':
      return 3;
    case 'warn':
      return 4;
    case 'error':
      return 5;
    case 'fatal':
      return 6;
    default:
      return 2;
  }
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
