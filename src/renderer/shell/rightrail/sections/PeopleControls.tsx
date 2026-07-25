import { Search } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { PeopleFilter, PeopleSort } from '../../../../shared/types';
import { cn } from '../../../lib/utils';

// Below RAIL_COLLAPSE_WIDTH the control row is dropped and the volume bar is
// omitted; search stands alone. 304 rather than the handoff's 330 so a default
// 320px rail is not stranded in the degraded mode — and it is the same width
// the Activity section above already collapses at.

const SORTS: ReadonlyArray<{ value: PeopleSort; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'loud', label: 'Loudest' },
  { value: 'name', label: 'A–Z' },
];

const FILTERS: ReadonlyArray<{ value: PeopleFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'contacts', label: 'Contacts' },
];

// ToggleGroupItem ships as a segmented bar: flex-1 (equal widths), rounded-none
// with first/last corner rounding, and data-[state=on]:bg-accent — which is
// cs-bg-3 on a cs-bg-2 rail, about 1.05:1 and effectively invisible. The design
// inverts that: an intrinsic-width pill, individually rounded, and the SELECTED
// item goes darker with an amber label.
const ITEM = cn(
  'h-[22px] min-w-0 flex-none rounded-[5px] px-[7px] py-[3px] font-mono text-[9.5px] font-medium',
  'first:rounded-[5px] last:rounded-[5px]',
  'text-cs-text-muted hover:bg-transparent hover:text-cs-text',
  'data-[state=on]:bg-cs-bg data-[state=on]:text-cs-accent data-[state=on]:shadow-[0_1px_0_rgba(0,0,0,.3)]',
);

const GROUP = 'gap-0.5 rounded-[7px] border border-cs-border bg-cs-bg-3 p-0.5';

interface PeopleControlsProps {
  query: string;
  sort: PeopleSort;
  filter: PeopleFilter;
  /** False below RAIL_COLLAPSE_WIDTH — search stands alone. */
  showToggles: boolean;
  onQuery: (q: string) => void;
  onSort: (s: PeopleSort) => void;
  onFilter: (f: PeopleFilter) => void;
}

export function PeopleControls({ query, sort, filter, showToggles, onQuery, onSort, onFilter }: PeopleControlsProps) {
  return (
    <>
      <div className="mx-2.5 mb-2 flex h-[26px] items-center gap-[7px] rounded-[7px] border border-cs-border bg-cs-bg-2 px-2">
        <Search size={11} aria-hidden className="shrink-0 text-cs-text-dim" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-cs-text outline-none placeholder:text-cs-text-dim"
        />
      </div>

      {showToggles && (
        <div className="mx-2.5 mb-1.5 flex items-center gap-1.5">
          <ToggleGroup
            type="single"
            value={sort}
            onValueChange={(v) => v && onSort(v as PeopleSort)}
            aria-label="Sort people"
            className={GROUP}
          >
            {SORTS.map((s) => (
              <ToggleGroupItem key={s.value} value={s.value} className={ITEM}>
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => v && onFilter(v as PeopleFilter)}
            aria-label="Filter people"
            className={cn(GROUP, 'ml-auto')}
          >
            {FILTERS.map((f) => (
              <ToggleGroupItem key={f.value} value={f.value} className={ITEM}>
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
    </>
  );
}
