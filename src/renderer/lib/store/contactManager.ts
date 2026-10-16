import type { SliceCreator } from './coreState';
import type { CmSortDir, CmSortField, ContactManagerState } from './types';

// ---- Contact Manager view state -------------------------------------------
const CM_DEFAULTS: ContactManagerState = {
  search: '',
  stateTab: 'all',
  types: [],
  heard: 'any',
  favOnly: false,
  sortField: 'lastHeard',
  sortDir: 'asc',
  layout: 'table',
  compact: true,
  showKeys: true,
  selected: [],
  focusKey: null,
};

export interface ContactManagerSlice {
  // Contact Manager view state (filters, sort, selection, focus)
  contactManager: ContactManagerState;
  setCmFilter: (patch: Partial<ContactManagerState>) => void;
  toggleCmSelected: (key: string) => void;
  setCmSelected: (keys: string[]) => void;
  clearCmSelected: () => void;
  setCmFocus: (key: string | null) => void;
  setCmSort: (field: CmSortField) => void;
}

export const createContactManagerSlice: SliceCreator<ContactManagerSlice> = (set) => ({
  contactManager: CM_DEFAULTS,

  setCmFilter: (patch) => set((s) => ({ contactManager: { ...s.contactManager, ...patch } })),
  toggleCmSelected: (key) =>
    set((s) => {
      const has = s.contactManager.selected.includes(key);
      const selected = has ? s.contactManager.selected.filter((k) => k !== key) : [...s.contactManager.selected, key];
      return { contactManager: { ...s.contactManager, selected } };
    }),
  setCmSelected: (keys) => set((s) => ({ contactManager: { ...s.contactManager, selected: keys } })),
  clearCmSelected: () => set((s) => ({ contactManager: { ...s.contactManager, selected: [] } })),
  setCmFocus: (key) => set((s) => ({ contactManager: { ...s.contactManager, focusKey: key } })),
  setCmSort: (field) =>
    set((s) => {
      const { sortField, sortDir } = s.contactManager;
      const dir: CmSortDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
      return { contactManager: { ...s.contactManager, sortField: field, sortDir: dir } };
    }),
});
