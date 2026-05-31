import { ArrowDownUp, LayoutGrid, List, Rows3, Search, Star } from 'lucide-react';
import type { ContactKind } from '../../../shared/types';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import type { CmCounts } from '../../lib/contactManagerView';
import type { CmHeard, CmSortField, CmStateTab } from '../../lib/store';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';

const STATE_TABS: Array<{ tab: CmStateTab; label: string; key: keyof CmCounts }> = [
  { tab: 'all', label: 'All', key: 'all' },
  { tab: 'on-radio', label: 'On Radio', key: 'onRadio' },
  { tab: 'discovered', label: 'Discovered', key: 'discovered' },
  { tab: 'blocked', label: 'Blocked', key: 'blocked' },
];

const KIND_OPTIONS: Array<{ kind: ContactKind; label: string }> = [
  { kind: 'chat', label: 'Users' },
  { kind: 'repeater', label: 'Repeaters' },
  { kind: 'room', label: 'Room Servers' },
  { kind: 'sensor', label: 'Sensors' },
];

const HEARD_LABEL: Record<CmHeard, string> = {
  any: 'Any time',
  hour: 'Last hour',
  day: 'Last 24h',
  week: 'Last 7 days',
};

const SORT_LABEL: Record<CmSortField, string> = {
  lastHeard: 'Last heard',
  firstHeard: 'First heard',
  name: 'Name',
  type: 'Type',
  hops: 'Hops',
  key: 'Public key',
};

export function Toolbar({ counts }: { counts: CmCounts }) {
  const cm = useStore((s) => s.contactManager);
  const setCmFilter = useStore((s) => s.setCmFilter);
  const setCmSort = useStore((s) => s.setCmSort);

  function toggleType(kind: ContactKind) {
    const next = cm.types.includes(kind) ? cm.types.filter((k) => k !== kind) : [...cm.types, kind];
    setCmFilter({ types: next });
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-cs-border px-4 py-2.5">
      {/* Row 1: search + state segments */}
      <div className="flex items-center gap-3">
        <div className="relative w-64 shrink-0">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-cs-text-dim"
            aria-hidden="true"
          />
          <Input
            value={cm.search}
            onChange={(e) => setCmFilter({ search: e.target.value })}
            placeholder={`Search ${counts.all} contacts by name or key…`}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          {STATE_TABS.map(({ tab, label, key }) => {
            const active = cm.stateTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setCmFilter({ stateTab: tab })}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-2 py-1 transition-colors',
                  active
                    ? 'border-cs-accent text-cs-text'
                    : 'border-transparent text-cs-text-muted hover:text-cs-text',
                )}
              >
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px font-mono text-[9px] tabular-nums',
                    active ? 'bg-cs-accent-soft/30 text-cs-text' : 'bg-cs-bg-3 text-cs-text-dim',
                  )}
                >
                  {counts[key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 2: type / heard / favourites · sort · view */}
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              Type
              {cm.types.length > 0 && (
                <span className="rounded-full bg-cs-accent-soft/30 px-1.5 py-px font-mono text-[9px] text-cs-text tabular-nums">
                  {cm.types.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-2">
            <div className="flex flex-col gap-1">
              {KIND_OPTIONS.map(({ kind, label }) => (
                <label
                  key={kind}
                  htmlFor={`cm-type-${kind}`}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-cs-bg-3"
                >
                  <Checkbox
                    id={`cm-type-${kind}`}
                    checked={cm.types.includes(kind)}
                    onCheckedChange={() => toggleType(kind)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Select value={cm.heard} onValueChange={(v) => setCmFilter({ heard: v as CmHeard })}>
          <SelectTrigger size="sm" className="w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(HEARD_LABEL) as CmHeard[]).map((h) => (
              <SelectItem key={h} value={h}>
                {HEARD_LABEL[h]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCmFilter({ favOnly: !cm.favOnly })}
          title={cm.favOnly ? 'Showing favourites only' : 'Show favourites only'}
          aria-pressed={cm.favOnly}
        >
          <Star className={cn('size-4', cm.favOnly && 'fill-cs-warn text-cs-warn')} />
        </Button>

        <div className="flex-1" />

        <Select value={cm.sortField} onValueChange={(v) => setCmSort(v as CmSortField)}>
          <SelectTrigger size="sm" className="w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as CmSortField[]).map((f) => (
              <SelectItem key={f} value={f}>
                {SORT_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCmSort(cm.sortField)}
          title={`Sort ${cm.sortDir === 'asc' ? 'ascending' : 'descending'}`}
        >
          <ArrowDownUp
            className={cn('size-4 transition-transform', cm.sortDir === 'desc' && 'rotate-180')}
          />
        </Button>

        <div className="ml-1 flex items-center gap-0.5 rounded-md border border-cs-border p-0.5">
          <Button
            variant={cm.layout === 'table' ? 'secondary' : 'ghost'}
            size="icon-xs"
            onClick={() => setCmFilter({ layout: 'table' })}
            title="Table view"
          >
            <LayoutGrid className="size-3.5" />
          </Button>
          <Button
            variant={cm.layout === 'list' ? 'secondary' : 'ghost'}
            size="icon-xs"
            onClick={() => setCmFilter({ layout: 'list' })}
            title="List view"
          >
            <List className="size-3.5" />
          </Button>
        </div>
        <Button
          variant={cm.compact ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={() => setCmFilter({ compact: !cm.compact })}
          title={cm.compact ? 'Compact rows' : 'Comfortable rows'}
          aria-pressed={cm.compact}
        >
          <Rows3 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
