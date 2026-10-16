import { DEFAULT_LOGS_SEARCH, type LogEntry, type LogsSearch, type UiState } from '../../../shared/types';
import type { SliceCreator } from './coreState';
import { keepLast } from './util';

const MAX_LOGS = 5000;

/** The Logs panel: main's and this renderer's log streams, and its search. Its
 *  level/source filter is persisted, so setLogsFilter writes `ui`. */
export interface LogsSlice {
  // Live log entries from main, mirrored over WS (capped ring buffer).
  logs: LogEntry[];
  // Live log entries from this renderer, fed in-process by the tslog transport
  // (see logger.ts). Kept separate from `logs` so the WS `log:snapshot` replace
  // can't wipe them on reconnect. The Logs panel merges the two by timestamp.
  rendererLogs: LogEntry[];

  /** Logs panel substring boxes. Session-only and at the store ROOT: they are
   *  live text inputs, so keeping them in `ui` put a keystroke on the persisted
   *  write path, and a stale substring would silently empty the panel on the
   *  next launch. Cf. `peopleQuery`. */
  logsSearch: LogsSearch;
  setLogsSearch: (patch: Partial<LogsSearch>) => void;

  appendLog: (entry: LogEntry) => void;
  appendRendererLog: (entry: LogEntry) => void;
  replaceLogs: (entries: LogEntry[]) => void;
  setLogsFilter: (patch: Partial<UiState['logsFilter']>) => void;
  clearLogs: () => void;
}

export const createLogsSlice: SliceCreator<LogsSlice> = (set) => ({
  logs: [],
  rendererLogs: [],
  logsSearch: { ...DEFAULT_LOGS_SEARCH },

  appendLog: (entry) =>
    set((s) => {
      // snapshot+live can overlap during ws connect, so dedupe by id
      for (let i = s.logs.length - 1; i >= Math.max(0, s.logs.length - 10); i--) {
        if (s.logs[i].id === entry.id) return s;
      }
      return { logs: keepLast([...s.logs, entry], MAX_LOGS) };
    }),
  appendRendererLog: (entry) => set((s) => ({ rendererLogs: keepLast([...s.rendererLogs, entry], MAX_LOGS) })),
  replaceLogs: (entries) => set(() => ({ logs: keepLast(entries, MAX_LOGS) })),
  setLogsFilter: (patch) => set((s) => ({ ui: { ...s.ui, logsFilter: { ...s.ui.logsFilter, ...patch } } })),
  setLogsSearch: (patch) => set((s) => ({ logsSearch: { ...s.logsSearch, ...patch } })),
  clearLogs: () => set(() => ({ logs: [], rendererLogs: [] })),
});
