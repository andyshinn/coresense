import { Kbd } from '@/components/ui/kbd';
import type { CliHistoryEntry } from './lib/persistence';

export interface CliReverseSearchProps {
  query: string;
  match: CliHistoryEntry | null;
  index: number;
  total: number;
}

const GLYPH: Record<CliHistoryEntry['status'], [string, string]> = {
  ok: ['✓', 'text-cs-online'],
  error: ['✕', 'text-cs-danger'],
  timeout: ['⧗', 'text-cs-danger'],
  sent: ['·', 'text-cs-text-dim'],
};

export function CliReverseSearch({ query, match, index, total }: CliReverseSearchProps) {
  const at = match ? match.text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  const glyph = match ? GLYPH[match.status] : GLYPH.ok;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden border-t border-cs-border bg-cs-bg-3 px-4 py-2">
      <span className="shrink-0 font-mono text-[12.5px] text-cs-accent">
        (reverse-i-search)`<span className="text-cs-text">{query}</span>':
      </span>
      {match ? (
        <span className="truncate font-mono text-[12.5px] text-cs-text" style={{ flex: '1 1 140px', minWidth: 120 }}>
          {at >= 0 ? (
            <>
              {match.text.slice(0, at)}
              <span className="bg-cs-accent-soft text-cs-accent">{match.text.slice(at, at + query.length)}</span>
              {match.text.slice(at + query.length)}
            </>
          ) : (
            match.text
          )}
        </span>
      ) : (
        <span className="font-mono text-[12.5px] text-cs-danger" style={{ flex: '1 1 140px', minWidth: 120 }}>
          failing reverse-i-search
        </span>
      )}
      {match ? (
        <span className={`shrink-0 font-mono text-[12px] ${glyph[1]}`} title={match.status}>
          {glyph[0]}
        </span>
      ) : null}
      {total > 0 ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-cs-text-dim">
          {index + 1}/{total}
        </span>
      ) : null}
      <span className="flex min-w-0 shrink items-center gap-2 overflow-hidden text-[10px] text-cs-text-dim">
        <span className="whitespace-nowrap">
          <Kbd>⌃R</Kbd> older
        </span>
        <span className="whitespace-nowrap">
          <Kbd>↵</Kbd> run
        </span>
        <span className="whitespace-nowrap">
          <Kbd>→</Kbd> edit
        </span>
        <span className="whitespace-nowrap">
          <Kbd>⌃G</Kbd> abort
        </span>
      </span>
    </div>
  );
}
