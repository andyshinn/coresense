import { Braces, Globe, Hash, Plus, Search, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type ApiClient, api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { MacroTemplate } from '../../../shared/macros/types';
import type { Channel, Contact } from '../../../shared/types';
import { filterMacros, type ScopeFilter, scopeCounts } from './lib/filterMacros';
import { MacroRow } from './MacroRow';

/** Human label for a macro's scope binding, resolved against the live lists. */
function resolveScopeLabel(macro: MacroTemplate, channels: Channel[], contacts: Contact[]): string {
  if (macro.scope === 'global') return 'Global';
  if (macro.scope === 'channel') {
    const ch = channels.find((c) => c.key === macro.channelKey);
    if (ch) return `#${ch.name.replace(/^#/, '')}`;
    return macro.channelKey ? `#${macro.channelKey.replace(/^ch:/, '')}` : 'Channel';
  }
  const contact = contacts.find((c) => c.key === macro.contactKey);
  return contact?.name ?? 'Contact';
}

const SCOPE_FILTERS: { value: ScopeFilter; label: string; icon: typeof Globe | null }[] = [
  { value: 'all', label: 'All', icon: null },
  { value: 'global', label: 'Global', icon: Globe },
  { value: 'channel', label: 'Channel', icon: Hash },
  { value: 'contact', label: 'Contact', icon: User },
];

interface MacroLibraryProps {
  client: ApiClient | null;
  onNew: () => void;
  onEdit: (m: MacroTemplate) => void;
}

export function MacroLibrary({ client, onNew, onEdit }: MacroLibraryProps) {
  const macros = useStore((s) => s.macros);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');

  const counts = useMemo(() => scopeCounts(macros), [macros]);
  const shown = useMemo(() => filterMacros(macros, query, scope), [macros, query, scope]);

  const duplicate = async (m: MacroTemplate) => {
    if (!client) return;
    try {
      await api.addMacro(client, {
        name: `${m.name} copy`,
        template: m.template,
        scope: m.scope,
        channelKey: m.channelKey,
        contactKey: m.contactKey,
      });
      notify.success('Macro duplicated');
    } catch (err) {
      notify.error(`Couldn’t duplicate macro: ${(err as Error).message}`, err);
    }
  };

  const remove = async (m: MacroTemplate) => {
    if (!client) return;
    try {
      await api.deleteMacro(client, m.id);
      notify.success('Macro deleted');
    } catch (err) {
      notify.error(`Couldn’t delete macro: ${(err as Error).message}`, err);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-start gap-3 border-b border-cs-border bg-cs-bg-2 px-4 py-3">
        <Braces className="mt-0.5 size-5 shrink-0 text-cs-accent" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-cs-text">Macros</h1>
          <p className="max-w-135 text-[11px] text-cs-text-dim">
            Reusable message templates with live variables and filters. Use them when composing or replying over the radio.
          </p>
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={onNew} disabled={!client}>
            <Plus className="size-3.5" aria-hidden="true" />
            New macro
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-cs-border px-4 py-2">
        <div className="relative min-w-0 flex-1 sm:max-w-[320px]">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-cs-text-dim"
            aria-hidden="true"
          />
          <input
            data-testid="macro-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search macros…"
            aria-label="Search macros"
            className="h-8 w-full rounded-md border border-cs-border bg-cs-bg-2 pl-7 pr-2 text-xs text-cs-text outline-none placeholder:text-cs-text-dim focus:border-cs-accent"
          />
        </div>
        <div
          className="inline-flex items-center gap-0.5 rounded-lg border border-cs-border bg-cs-bg-2 p-0.5"
          role="tablist"
          aria-label="Filter by scope"
        >
          {SCOPE_FILTERS.map(({ value, label, icon: Icon }) => {
            const active = scope === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`scope-filter-${value}`}
                onClick={() => setScope(value)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  active ? 'bg-cs-bg-3 text-cs-text' : 'text-cs-text-muted hover:text-cs-text',
                )}
              >
                {Icon && <Icon className="size-3" aria-hidden="true" />}
                <span>{label}</span>
                <span className="font-mono text-[10px] text-cs-text-dim">{counts[value]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-cs-text-dim">
            {macros.length === 0 ? 'No macros yet — create your first one.' : 'No macros match these filters.'}
          </div>
        ) : (
          shown.map((m) => (
            <MacroRow
              key={m.id}
              macro={m}
              scopeLabel={resolveScopeLabel(m, channels, contacts)}
              onEdit={onEdit}
              onDuplicate={duplicate}
              onDelete={remove}
              mutationsDisabled={!client}
            />
          ))
        )}
      </div>
    </div>
  );
}
