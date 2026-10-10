import { Search, X } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useStore } from '../../lib/store';

/** Search box at the top of the left nav. Typing jumps to tool:search; Esc (or
 *  the clear button) clears the query and navigates back.
 *
 *  Owns its own `searchQuery` subscription so a keystroke re-renders only this
 *  input, not the whole channel and contact tree (the renderer has no memo
 *  boundaries). Stays mounted while hidden so the pre-search key survives the
 *  setting being toggled. */
export function LeftNavSearch() {
  const showLeftNavSearch = useStore((s) => s.appSettings.showLeftNavSearch);
  const activeKey = useStore((s) => s.ui.activeKey);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const clearSearch = useStore((s) => s.clearSearch);
  const searchRef = useRef<HTMLInputElement>(null);
  // The activeKey before the user opened the search panel. On Esc we restore
  // it — so typing then escaping doesn't leave the user staring at an empty
  // search result page.
  const preSearchKeyRef = useRef<string | null>(null);

  const onSearchChange = useCallback(
    (next: string) => {
      setSearchQuery(next);
      if (next.length > 0) {
        // Remember where the user was so Esc can restore it. If they're
        // already on tool:search, leave the saved key alone.
        if (activeKey !== 'tool:search') preSearchKeyRef.current = activeKey;
        setActiveKey('tool:search');
      }
    },
    [setSearchQuery, setActiveKey, activeKey],
  );

  const onSearchEscape = useCallback(() => {
    clearSearch();
    // Restoring from search is conceptually a back-navigation: the user is
    // returning to the conversation they were in before the search input grabbed
    // focus. goBack() pops navPast (where typing in the search input pushed the
    // prior activeKey) and leaves tool:search on navFuture so Cmd+Right returns
    // to it — matches browser semantics.
    if (preSearchKeyRef.current && activeKey === 'tool:search') {
      useStore.getState().goBack();
    }
    preSearchKeyRef.current = null;
    searchRef.current?.blur();
  }, [clearSearch, activeKey]);

  if (!showLeftNavSearch) return null;

  return (
    <div className="px-2 pt-2 group-data-[collapsible=icon]:hidden">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-cs-text-dim"
        />
        <input
          ref={searchRef}
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onSearchEscape();
            }
          }}
          placeholder="Search messages…"
          aria-label="Search messages, channels, and contacts"
          className="h-7 w-full rounded-md border border-cs-border bg-cs-bg-3 pl-7 pr-7 text-xs text-cs-text outline-none placeholder:text-cs-text-dim focus:border-cs-accent"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={onSearchEscape}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}
