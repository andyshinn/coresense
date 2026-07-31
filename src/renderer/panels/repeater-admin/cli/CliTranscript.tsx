import { useEffect, useRef } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { CliRow, type FollowUp } from './CliRow';
import type { CliEntry } from './lib/queue';

export interface CliTranscriptProps {
  entries: CliEntry[];
  timeoutMs: number;
  followUpsFor: (entry: CliEntry) => FollowUp[];
  onRetry: (entry: CliEntry) => void;
  onEdit: (text: string) => void;
  onCancel: (id: string) => void;
}

function TranscriptEmpty() {
  return (
    <div className="px-4 py-4">
      <p className="text-[13px] text-cs-text-dim" style={{ textWrap: 'pretty' }}>
        Type a repeater CLI command (e.g.{' '}
        <code className="rounded bg-cs-bg-3 px-1 py-0.5 font-mono text-[12px] text-cs-text-muted">get radio</code>,{' '}
        <code className="rounded bg-cs-bg-3 px-1 py-0.5 font-mono text-[12px] text-cs-text-muted">discover.neighbors</code>).
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-cs-text-dim">
        <span>
          <Kbd>⌃Space</Kbd> suggestions
        </span>
        <span>
          <Kbd>↹</Kbd> complete
        </span>
        <span>
          <Kbd>↑</Kbd> previous
        </span>
        <span>
          <Kbd>⌃R</Kbd> reverse search
        </span>
        <span>
          <Kbd>⌃L</Kbd> clear
        </span>
      </div>
    </div>
  );
}

export function CliTranscript({ entries, timeoutMs, followUpsFor, onRetry, onEdit, onCancel }: CliTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: entries triggers scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-2">
      {entries.length === 0 ? <TranscriptEmpty /> : null}
      {entries.map((e) => (
        <CliRow
          key={e.id}
          entry={e}
          timeoutMs={timeoutMs}
          followUps={followUpsFor(e)}
          onRetry={onRetry}
          onEdit={onEdit}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}
