import {
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  type VirtuosoMessageListMethods,
  type VirtuosoMessageListProps,
} from '@virtuoso.dev/message-list';
import { useMemo, useRef } from 'react';
import type { LogEntry } from '../../../shared/types';
import { useStore } from '../../lib/store';
import { VIRTUOSO_LICENSE_KEY } from '../../lib/virtuosoLicense';
import { filterLogs } from './filter';
import { LogRow } from './LogRow';

export function LogsPanel() {
  const logs = useStore((s) => s.logs);
  const rendererLogs = useStore((s) => s.rendererLogs);
  const filter = useStore((s) => s.ui.logsFilter);
  // Main logs arrive over WS; renderer logs are appended in-process. Merge the
  // two feeds and order by timestamp (same-machine clocks, so ts is reliable).
  // Array.sort is stable, so equal-ts entries keep insertion order.
  const merged = useMemo(() => [...logs, ...rendererLogs].sort((a, b) => a.ts - b.ts), [logs, rendererLogs]);
  const visible = useMemo(() => filterLogs(merged, filter), [merged, filter]);
  const ref = useRef<VirtuosoMessageListMethods<LogEntry>>(null);

  const data = useMemo<VirtuosoMessageListProps<LogEntry, null>['data']>(
    () => ({
      data: visible,
      scrollModifier: filter.paused
        ? undefined
        : {
            type: 'auto-scroll-to-bottom',
            autoScroll: ({ atBottom, scrollInProgress }) => ({
              index: 'LAST',
              align: 'end',
              behavior: atBottom || scrollInProgress ? 'smooth' : 'auto',
            }),
          },
    }),
    [visible, filter.paused],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-cs-border px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-cs-text-dim">
        Logs ({visible.length} of {merged.length})
      </div>
      <div className="min-h-0 flex-1">
        <VirtuosoMessageListLicense licenseKey={VIRTUOSO_LICENSE_KEY}>
          <VirtuosoMessageList<LogEntry, null>
            ref={ref}
            data={data}
            computeItemKey={({ data: entry }) => entry.id}
            ItemContent={LogRow}
            style={{ height: '100%' }}
          />
        </VirtuosoMessageListLicense>
      </div>
    </div>
  );
}
