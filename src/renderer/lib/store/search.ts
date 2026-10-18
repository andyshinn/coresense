import type { SearchSort } from '../../../shared/types';
import type { SliceCreator } from './coreState';
import type { SearchFilters } from './types';

const DEFAULT_SEARCH_FILTERS: SearchFilters = { categories: ['channel', 'dm', 'contact'] };

/** The search panel's query, filters and sort. */
export interface SearchSlice {
  // Sidebar quick-filter / search panel state. Single source of truth — both
  // the LeftNav input and the SearchResults panel input bind to this so they
  // stay in sync as the user moves between them.
  searchQuery: string;
  searchFilters: SearchFilters;
  searchSort: SearchSort;
  // Incremented when Cmd/Ctrl+F fires globally. The SearchResults panel
  // watches it to refocus its input even when the panel is already mounted.
  searchFocusNonce: number;

  setSearchQuery: (query: string) => void;
  setSearchFilters: (patch: Partial<SearchFilters>) => void;
  setSearchSort: (sort: SearchSort) => void;
  clearSearch: () => void;
  /** Bump the focus nonce so the SearchResults panel input grabs focus. */
  requestSearchFocus: () => void;
}

export const createSearchSlice: SliceCreator<SearchSlice> = (set) => ({
  searchQuery: '',
  searchFilters: DEFAULT_SEARCH_FILTERS,
  searchSort: 'recency',
  searchFocusNonce: 0,

  setSearchQuery: (query) => set(() => ({ searchQuery: query })),
  setSearchFilters: (patch) => set((s) => ({ searchFilters: { ...s.searchFilters, ...patch } })),
  setSearchSort: (sort) => set(() => ({ searchSort: sort })),
  clearSearch: () =>
    set(() => ({
      searchQuery: '',
      searchFilters: DEFAULT_SEARCH_FILTERS,
    })),
  requestSearchFocus: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
});
