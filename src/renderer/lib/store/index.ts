import { create } from 'zustand';
import { setRendererLogSink } from '../logger';
import { createConnectionSlice } from './connection';
import { createContactManagerSlice } from './contactManager';
import { createConversationsSlice } from './conversations';
import type { CoreState } from './coreState';
import { createHydrateSlice } from './hydrate';
import { createLogsSlice } from './logs';
import { createMacroStudioSlice } from './macroStudio';
import { createNavSlice } from './nav';
import { createPacketsSlice } from './packets';
import { createRepeaterAdminSlice } from './repeaterAdmin';
import { createSearchSlice } from './search';
import { createSettingsSlice } from './settings';
import { createUiSlice } from './ui';

// The renderer's single zustand store. Each concern is a slice in its own
// module (connection, conversations, settings, packets, ui, nav, …), composed
// here into ONE store with one flat state, so `useStore` selectors, the state
// shape and `getState()`/`setState()` callers are unaffected by the split.
// Slices are an organising unit, not an isolation boundary: every slice gets
// the whole store's `set`, and the few actions that write across concerns say
// so where they are defined.

export { selectIsConnected } from './connection';
export { selectActiveMessages } from './conversations';
export type { CoreState } from './coreState';
export { selectAnySettingsDirty } from './nav';
export { mergeHydratedPackets, migratePacketLogFilter } from './packets';
export type {
  CmHeard,
  CmLayout,
  CmSortDir,
  CmSortField,
  CmStateTab,
  ContactManagerState,
  LivePacket,
  NeighboursViewState,
  PacketLogView,
  RepeaterAdminTab,
  SearchFilters,
  SettingsPendingTarget,
  SettingsSectionMeta,
  SettingsTab,
} from './types';

export const useStore = create<CoreState>()((...a) => ({
  ...createConnectionSlice(...a),
  ...createConversationsSlice(...a),
  ...createContactManagerSlice(...a),
  ...createSettingsSlice(...a),
  ...createRepeaterAdminSlice(...a),
  ...createMacroStudioSlice(...a),
  ...createPacketsSlice(...a),
  ...createLogsSlice(...a),
  ...createSearchSlice(...a),
  ...createUiSlice(...a),
  ...createNavSlice(...a),
  ...createHydrateSlice(...a),
}));

// Tee renderer-side tslog output into the store so the Logs panel shows it
// (in-process — no IPC). Registered here, after the store exists, to keep
// logger.ts free of a back-import on the store. See logger.ts for the rationale.
// Deferred a microtask so a log emitted during React's render phase can't
// trigger a synchronous store update ("cannot update while rendering").
setRendererLogSink((entry) => {
  queueMicrotask(() => useStore.getState().appendRendererLog(entry));
});
