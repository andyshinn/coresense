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
    <div className="space-y-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-cs-text select-none">
        <input
          type="checkbox"
          checked={showMain}
          onChange={(e) => setLogsFilter({ showMain: e.target.checked })}
          className="h-3.5 w-3.5 accent-cs-accent"
        />
        Main
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-cs-text select-none">
        <input
          type="checkbox"
          checked={showRenderer}
          onChange={(e) => setLogsFilter({ showRenderer: e.target.checked })}
          className="h-3.5 w-3.5 accent-cs-accent"
        />
        Renderer
      </label>
    </div>
  );
}

/** Logger substring filter input for the logs right-rail filter. */
export function LogsLoggerSection() {
  const loggerSubstring = useStore((s) => s.ui.logsFilter.loggerSubstring);
  const setLogsFilter = useStore((s) => s.setLogsFilter);
  return (
    <input
      type="text"
      value={loggerSubstring}
      placeholder="substring match (e.g. ble)"
      onChange={(e) => setLogsFilter({ loggerSubstring: e.target.value })}
      className="w-full rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text placeholder:text-cs-text-dim outline-none focus:border-cs-accent"
    />
  );
}

/** Message text substring filter input for the logs right-rail filter. */
export function LogsSearchSection() {
  const textSubstring = useStore((s) => s.ui.logsFilter.textSubstring);
  const setLogsFilter = useStore((s) => s.setLogsFilter);
  return (
    <input
      type="text"
      value={textSubstring}
      placeholder="search messages"
      onChange={(e) => setLogsFilter({ textSubstring: e.target.value })}
      className="w-full rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text placeholder:text-cs-text-dim outline-none focus:border-cs-accent"
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
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-cs-text select-none">
        <input
          type="checkbox"
          checked={paused}
          onChange={(e) => setLogsFilter({ paused: e.target.checked })}
          className="h-3.5 w-3.5 accent-cs-accent"
        />
        Pause auto-scroll
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={clearLogs}
          className="inline-flex items-center rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text hover:bg-cs-border"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setActiveKey('tool:settings:app')}
          className="inline-flex items-center rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text hover:bg-cs-border"
        >
          Back to Settings
        </button>
      </div>
    </div>
  );
}
