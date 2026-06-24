import { Checkbox, Flex, Text, TextField } from '@radix-ui/themes';
import type { LogLevel } from '../../../../shared/types';
import { Select } from '../../../components/settings/Field';
import { useStore } from '../../../lib/store';

const LEVEL_OPTIONS = [
  { value: 'silly', label: 'silly' },
  { value: 'trace', label: 'trace' },
  { value: 'debug', label: 'debug' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' },
  { value: 'fatal', label: 'fatal' },
] as const satisfies ReadonlyArray<{ value: LogLevel; label: string }>;

/** Minimum log level selector for the logs right-rail filter. */
export function LogsLevelSection() {
  const minLevel = useStore((s) => s.ui.logsFilter.minLevel);
  const setLogsFilter = useStore((s) => s.setLogsFilter);
  return <Select value={minLevel} options={LEVEL_OPTIONS} onChange={(v) => setLogsFilter({ minLevel: v as LogLevel })} />;
}

/** Source checkboxes (Main / Renderer) for the logs right-rail filter. */
export function LogsSourceSection() {
  const showMain = useStore((s) => s.ui.logsFilter.showMain);
  const showRenderer = useStore((s) => s.ui.logsFilter.showRenderer);
  const setLogsFilter = useStore((s) => s.setLogsFilter);
  return (
    <Flex direction="column" gap="2">
      <Flex
        align="center"
        gap="2"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setLogsFilter({ showMain: !showMain })}
      >
        <Checkbox size="1" checked={showMain} onCheckedChange={(checked) => setLogsFilter({ showMain: checked === true })} />
        <Text size="2">Main</Text>
      </Flex>
      <Flex
        align="center"
        gap="2"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setLogsFilter({ showRenderer: !showRenderer })}
      >
        <Checkbox
          size="1"
          checked={showRenderer}
          onCheckedChange={(checked) => setLogsFilter({ showRenderer: checked === true })}
        />
        <Text size="2">Renderer</Text>
      </Flex>
    </Flex>
  );
}

/** Logger substring filter input for the logs right-rail filter. */
export function LogsLoggerSection() {
  const loggerSubstring = useStore((s) => s.ui.logsFilter.loggerSubstring);
  const setLogsFilter = useStore((s) => s.setLogsFilter);
  return (
    <TextField.Root
      size="1"
      value={loggerSubstring}
      placeholder="substring match (e.g. ble)"
      onChange={(e) => setLogsFilter({ loggerSubstring: e.target.value })}
    />
  );
}

/** Message text substring filter input for the logs right-rail filter. */
export function LogsSearchSection() {
  const textSubstring = useStore((s) => s.ui.logsFilter.textSubstring);
  const setLogsFilter = useStore((s) => s.setLogsFilter);
  return (
    <TextField.Root
      size="1"
      value={textSubstring}
      placeholder="search messages"
      onChange={(e) => setLogsFilter({ textSubstring: e.target.value })}
    />
  );
}

/** Pause toggle and Clear button for the logs right-rail actions section. */
export function LogsActionsSection() {
  const paused = useStore((s) => s.ui.logsFilter.paused);
  const setLogsFilter = useStore((s) => s.setLogsFilter);
  const clearLogs = useStore((s) => s.clearLogs);
  const setActiveKey = useStore((s) => s.setActiveKey);
  return (
    <Flex direction="column" gap="2">
      <Flex
        align="center"
        gap="2"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setLogsFilter({ paused: !paused })}
      >
        <Checkbox size="1" checked={paused} onCheckedChange={(checked) => setLogsFilter({ paused: checked === true })} />
        <Text size="2">Pause auto-scroll</Text>
      </Flex>
      <Flex gap="2">
        <button
          type="button"
          onClick={clearLogs}
          className="border border-cs-border bg-cs-bg-3 text-cs-text hover:bg-cs-border"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 'var(--radius-2)',
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setActiveKey('tool:settings:app')}
          className="border border-cs-border bg-cs-bg-3 text-cs-text hover:bg-cs-border"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 'var(--radius-2)',
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Back to Settings
        </button>
      </Flex>
    </Flex>
  );
}
