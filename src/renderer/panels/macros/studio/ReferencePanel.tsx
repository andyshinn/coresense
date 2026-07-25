import { Braces, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import { buildSampleContext, MACRO_FILTERS, MACRO_VARIABLES, resolvePath, structureOf } from '../../../../shared/macros';
import type { MacroVariable } from '../../../../shared/macros/types';
import { replyContext, sendContext } from '../lib/sampleContext';
import { ContextTree } from './ContextTree';
import { FilterHoverCard } from './FilterHoverCard';
import type { PreviewMode } from './useStudio';
import { VariableHoverCard } from './VariableHoverCard';

/** Ready-to-edit insert text per filter — realistic argument stubs the author
 *  can tweak. Custom filters come from the manifest; these standard ones are a
 *  curated subset relevant to macros (paths/arrays). */
const FILTER_INSERT: Record<string, string> = {
  distance: ' | distance: peer_pos',
  bearing: ' | bearing: peer_pos',
  unit: " | unit: 'km'",
  first: ' | first',
  last: ' | last',
  where: ' | where: "kind", "hop"',
  map: ' | map: "short_id"',
  join: ' | join: " → "',
  sort: ' | sort: "final_snr"',
  size: ' | size',
  json: ' | json: 2',
  inspect: ' | inspect',
};

interface FilterDoc {
  name: string;
  signature: string;
  description: string;
}

const STANDARD_FILTERS: FilterDoc[] = [
  { name: 'first', signature: '{{ array | first }}', description: 'First item of an array' },
  { name: 'last', signature: '{{ array | last }}', description: 'Last item of an array' },
  {
    name: 'where',
    signature: '{{ array | where: "key", "value" }}',
    description: 'Keep items whose property equals a value (e.g. relay hops)',
  },
  { name: 'map', signature: '{{ array | map: "key" }}', description: 'Pull one property from each item' },
  { name: 'join', signature: '{{ array | join: " → " }}', description: 'Join an array into a string' },
  { name: 'sort', signature: '{{ array | sort: "key" }}', description: 'Sort an array (by key for objects)' },
  { name: 'size', signature: '{{ array | size }}', description: 'Number of items / characters' },
  {
    name: 'json',
    signature: '{{ value | json: 2 }}',
    description: 'Dump a value as JSON — use it to discover an object’s fields',
  },
  {
    name: 'inspect',
    signature: '{{ value | inspect }}',
    description: 'Like json, but prints [Circular] instead of failing on cycles',
  },
];

const TYPE_TAG: Record<MacroVariable['type'], string> = {
  string: 'str',
  number: 'num',
  position: 'pos',
  array: 'arr',
  boolean: 'bool',
};

type Tab = 'vars' | 'filters' | 'context';

interface ReferencePanelProps {
  mode: PreviewMode;
  onInsertVar: (name: string) => void;
  onInsertFilter: (segment: string) => void;
}

function GroupHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-3 pb-1 pt-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">{label}</span>
      <span className="font-mono text-[10px] text-cs-text-dim">{count}</span>
    </div>
  );
}

/** The trigger lives INSIDE, wrapping the button: InsertRow spreads no props, so
 *  an asChild trigger placed around it would silently drop the pointer/focus
 *  handlers and the card would never open. */
function InsertRow({
  label,
  onInsert,
  hoverCard,
  children,
}: {
  label: string;
  onInsert: () => void;
  hoverCard?: React.ReactNode;
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onInsert}
      className="group flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-cs-bg-3"
    >
      <div className="min-w-0 flex-1">{children}</div>
      <Plus
        className="mt-0.5 size-3 shrink-0 text-cs-text-dim opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
  if (!hoverCard) return button;
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>{button}</HoverCardTrigger>
      <HoverCardContent side="left" align="start" sideOffset={8} collisionPadding={8} className="w-auto max-w-80 p-3">
        {hoverCard}
      </HoverCardContent>
    </HoverCard>
  );
}

export function ReferencePanel({ mode, onInsertVar, onInsertFilter }: ReferencePanelProps) {
  const [tab, setTab] = useState<Tab>('vars');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const vars = useMemo(
    () => MACRO_VARIABLES.filter((v) => !q || v.name.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)),
    [q],
  );
  const always = vars.filter((v) => v.available === 'always');
  const reply = vars.filter((v) => v.available === 'reply');

  const customFilters = useMemo(
    () => MACRO_FILTERS.filter((f) => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)),
    [q],
  );
  const standardFilters = useMemo(
    () => STANDARD_FILTERS.filter((f) => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)),
    [q],
  );

  const structureRoot = useMemo(() => structureOf(buildSampleContext()), []);

  // Unlike the lint, the tab follows the preview toggle — its job is to show
  // what the author will actually get in each mode.
  const contextRoot = useMemo(() => structureOf(mode === 'reply' ? replyContext() : sendContext()), [mode]);

  const renderVar = (v: MacroVariable) => {
    const unavailable = mode === 'send' && v.available === 'reply';
    const resolved = resolvePath(structureRoot, [v.name]);
    return (
      <InsertRow
        key={v.name}
        label={`Insert ${v.name}`}
        onInsert={() => onInsertVar(v.name)}
        hoverCard={<VariableHoverCard variable={v} structure={resolved.ok ? resolved.node : null} />}
      >
        <div className={cn('flex items-center gap-2', unavailable && 'opacity-55')}>
          <span className={cn('font-mono text-[12px]', unavailable ? 'text-cs-warn' : 'text-cs-accent')}>{v.name}</span>
          <span className="rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-text-dim">{TYPE_TAG[v.type]}</span>
        </div>
        <div className="truncate text-[11px] text-cs-text-muted">{unavailable ? 'reply only' : v.description}</div>
      </InsertRow>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-cs-bg-2">
      <div className="shrink-0 border-b border-cs-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Braces className="size-4 shrink-0 text-cs-accent" aria-hidden="true" />
          <div className="ml-auto inline-flex rounded-md border border-cs-border bg-cs-bg p-0.5" role="tablist">
            {(['vars', 'filters', 'context'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  tab === t ? 'bg-cs-bg-3 text-cs-text' : 'text-cs-text-muted hover:text-cs-text',
                )}
              >
                {t === 'vars' ? 'Variables' : t === 'filters' ? 'Filters' : 'Context'}
              </button>
            ))}
          </div>
        </div>
        {tab !== 'context' && (
          <div className="relative mt-2">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-cs-text-dim"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'vars' ? 'Search variables…' : 'Search filters…'}
              aria-label="Search reference"
              className="h-7 w-full rounded-md border border-cs-border bg-cs-bg pl-7 pr-2 text-[11px] text-cs-text outline-none placeholder:text-cs-text-dim focus:border-cs-accent"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {tab === 'context' ? (
          <ContextTree node={contextRoot} onInsertPath={onInsertFilter} />
        ) : tab === 'vars' ? (
          <>
            {mode === 'send' && (
              <div className="mx-3 mt-3 rounded-md border border-cs-border bg-cs-warn/5 px-2 py-1.5 text-[11px] text-cs-text-muted">
                Reply-only variables are unavailable when composing a new message.
              </div>
            )}
            {always.length > 0 && <GroupHead label="Always available" count={always.length} />}
            {always.map(renderVar)}
            {reply.length > 0 && <GroupHead label="Reply only" count={reply.length} />}
            {reply.map(renderVar)}
          </>
        ) : (
          <>
            {customFilters.length > 0 && <GroupHead label="MeshCore filters" count={customFilters.length} />}
            {customFilters.map((f) => (
              <InsertRow
                key={f.name}
                label={`Insert ${f.name} filter`}
                onInsert={() => onInsertFilter(FILTER_INSERT[f.name] ?? ` | ${f.name}`)}
                hoverCard={
                  <FilterHoverCard name={f.name} description={f.description} signature={f.signature} example={f.example} />
                }
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-[#7fd1c4]">{f.name}</span>
                  <span className="rounded border border-[#7fd1c4]/40 px-1 text-[9px] text-[#7fd1c4]">MeshCore</span>
                </div>
                <div className="truncate text-[11px] text-cs-text-muted">{f.description}</div>
              </InsertRow>
            ))}
            {standardFilters.length > 0 && <GroupHead label="Standard" count={standardFilters.length} />}
            {standardFilters.map((f) => (
              <InsertRow
                key={f.name}
                label={`Insert ${f.name} filter`}
                onInsert={() => onInsertFilter(FILTER_INSERT[f.name] ?? ` | ${f.name}`)}
                hoverCard={<FilterHoverCard name={f.name} description={f.description} signature={f.signature} />}
              >
                <span className="font-mono text-[12px] text-[#9ed36a]">{f.name}</span>
                <div className="truncate text-[11px] text-cs-text-muted">{f.description}</div>
              </InsertRow>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
