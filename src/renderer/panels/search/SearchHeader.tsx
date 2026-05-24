import { Loader2, Search } from 'lucide-react';
import type { RefObject } from 'react';
import type { Contact, SearchSort } from '../../../shared/types';
import type { SearchFilters } from '../../lib/store';
import { DateInput, FilterChip, SortPill } from './atoms';

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onEscape: () => void;
  loading: boolean;
  filters: SearchFilters;
  setFilters: (next: Partial<SearchFilters>) => void;
  toggleKind: (k: 'channel' | 'dm') => void;
  conversationOptions: { key: string; label: string }[];
  contacts: Contact[];
  observedUnknownSenders: Map<string, string>;
  sort: SearchSort;
  changeSort: (next: SearchSort) => void;
}

export function SearchHeader({
  inputRef,
  searchQuery,
  setSearchQuery,
  onEscape,
  loading,
  filters,
  setFilters,
  toggleKind,
  conversationOptions,
  contacts,
  observedUnknownSenders,
  sort,
  changeSort,
}: Props) {
  return (
    <header className="shrink-0 border-b border-cs-border bg-cs-bg-2 px-4 py-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-cs-text-dim"
        />
        <input
          ref={inputRef}
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onEscape();
            }
          }}
          placeholder="Search messages, channels, and contacts…"
          className="h-9 w-full rounded-md border border-cs-border bg-cs-bg-3 pl-8 pr-9 text-sm text-cs-text outline-none placeholder:text-cs-text-dim focus:border-cs-accent"
        />
        {loading && (
          <Loader2
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-cs-text-muted"
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <FilterChip
          label="Channels"
          active={filters.kinds.includes('channel')}
          onClick={() => toggleKind('channel')}
        />
        <FilterChip
          label="DMs"
          active={filters.kinds.includes('dm')}
          onClick={() => toggleKind('dm')}
        />
        <select
          value={filters.key ?? ''}
          onChange={(e) => setFilters({ key: e.target.value || undefined })}
          aria-label="Restrict to conversation"
          className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 text-cs-text outline-none focus:border-cs-accent"
        >
          <option value="">Any conversation</option>
          {conversationOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={filters.fromPk ?? ''}
          onChange={(e) => setFilters({ fromPk: e.target.value || undefined })}
          aria-label="Restrict to sender"
          className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 text-cs-text outline-none focus:border-cs-accent"
        >
          <option value="">Anyone</option>
          <option value="self">Me</option>
          {contacts.length > 0 && (
            <optgroup label="Contacts">
              {contacts.map((c) => (
                <option key={c.publicKeyHex} value={c.publicKeyHex}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          {observedUnknownSenders.size > 0 && (
            <optgroup label="Channel speakers">
              {[...observedUnknownSenders.entries()].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <DateInput
          value={filters.tsFrom}
          onChange={(v) => setFilters({ tsFrom: v })}
          placeholder="From"
          endOfDay={false}
        />
        <DateInput
          value={filters.tsTo}
          onChange={(v) => setFilters({ tsTo: v })}
          placeholder="To"
          endOfDay
        />
        <div className="ml-auto flex items-center gap-1 rounded-md border border-cs-border bg-cs-bg-3 p-0.5">
          <SortPill
            label="Recency"
            active={sort === 'recency'}
            onClick={() => changeSort('recency')}
          />
          <SortPill
            label="Relevance"
            active={sort === 'relevance'}
            onClick={() => changeSort('relevance')}
          />
        </div>
      </div>
    </header>
  );
}
