import type { StateCreator } from 'zustand';
import type { ConnectionSlice } from './connection';
import type { ContactManagerSlice } from './contactManager';
import type { ConversationsSlice } from './conversations';
import type { HydrateSlice } from './hydrate';
import type { LogsSlice } from './logs';
import type { MacroStudioSlice } from './macroStudio';
import type { NavSlice } from './nav';
import type { PacketsSlice } from './packets';
import type { RepeaterAdminSlice } from './repeaterAdmin';
import type { SearchSlice } from './search';
import type { SettingsSlice } from './settings';
import type { UiSlice } from './ui';

/** The whole renderer store: one flat object composed from per-concern slices
 *  (see index.ts). Callers never see the slices — `useStore` selectors read
 *  this shape exactly as they did when it was one interface. */
export type CoreState = ConnectionSlice &
  ConversationsSlice &
  ContactManagerSlice &
  SettingsSlice &
  RepeaterAdminSlice &
  MacroStudioSlice &
  PacketsSlice &
  LogsSlice &
  SearchSlice &
  UiSlice &
  NavSlice &
  HydrateSlice;

/** A slice creator. It receives the store's `set`/`get` for the WHOLE state,
 *  so an action may read or write outside its own slice; the ones that do say
 *  so where they are defined. */
export type SliceCreator<Slice> = StateCreator<CoreState, [], [], Slice>;
