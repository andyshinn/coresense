// Feature state shapes held by the store. Kept apart from the slices so panels
// can import their own types without reading past the store's actions, and so
// the store itself never has to import a panel module. The store's index
// re-exports them, so `from '../lib/store'` imports work.
import type { ActiveKey } from '../../../shared/keys';
import type { ContactKind, RawPacket, RepeaterNeighboursPage, SearchCategory } from '../../../shared/types';
import type { NeighbourSortKey } from '../neighbours';

export type LivePacket = RawPacket & { id: string };

/** Where the Packet Log was scrolled when it last unmounted: the bottom-most visible
 *  packet and how far its bottom edge sat from the viewport's. Null when it was at the
 *  bottom. Session memory only, never persisted. Packet ids are renumbered on reload anyway. */
export interface PacketLogView {
  anchorId: string;
  anchorBottomOffset: number;
}

export interface SearchFilters {
  categories: SearchCategory[];
  key?: string;
  /** Sender hex public key or the literal 'self' for owner-sent. */
  fromPk?: string;
  tsFrom?: number;
  tsTo?: number;
}

// ---- Contact Manager view state -------------------------------------------
export type CmStateTab = 'all' | 'on-radio' | 'discovered' | 'blocked';
export type CmHeard = 'any' | 'hour' | 'day' | 'week';
export type CmSortField = 'lastHeard' | 'firstHeard' | 'name' | 'type' | 'hops' | 'key';
export type CmSortDir = 'asc' | 'desc';
export type CmLayout = 'table' | 'list';

/** Tabs in the RepeaterAdmin panel. Lives here (not the panel) so the store
 *  can carry a pending deep-link target without importing a panel module. */
export type RepeaterAdminTab = 'login' | 'path' | 'status' | 'acl' | 'neighbours' | 'owner' | 'cli';

export interface ContactManagerState {
  search: string;
  stateTab: CmStateTab;
  types: ContactKind[];
  heard: CmHeard;
  favOnly: boolean;
  sortField: CmSortField;
  sortDir: CmSortDir;
  layout: CmLayout;
  compact: boolean;
  showKeys: boolean;
  selected: string[];
  focusKey: string | null;
}

// Repeater Neighbours view state — shared between the map (main pane) and the
// neighbour list (right rail) so hover/selection couple across the two. `forKey`
// tags the data to the focal repeater so a fetched page never shows under a
// different repeater.
export interface NeighboursViewState {
  forKey: string | null;
  page: RepeaterNeighboursPage | null;
  sortKey: NeighbourSortKey;
  count: number;
  busy: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  /** Show name labels on every neighbour marker (not just the focal). */
  showNames: boolean;
}

// ---- Macro studio ----------------------------------------------------------
/** A live handle the open Macro studio publishes to the store so the Reference
 *  panel — rendered in the right rail, a sibling of the center pane — can insert
 *  variables/filters into the studio's editor. Only the stable insert callbacks
 *  belong here. The preview mode changes while the studio is open, so it is
 *  published separately (`macroStudioPreviewMode`); bundling it in here meant
 *  every Reply/New send toggle re-published the bridge and re-opened the rail. */
export interface MacroStudioBridge {
  insertVar: (name: string) => void;
  insertText: (text: string) => void;
}

// ---- Settings panel UI state ----------------------------------------------
// The redesigned Settings panel and the RightRail jump-list are sibling
// components under AppShell, so their shared state (which sections exist,
// which are dirty, the active section, the unsaved-changes prompt) lives in the store.
export type SettingsTab = 'app' | 'quickActions' | 'radio' | 'blocked' | 'extra';

export interface SettingsSectionMeta {
  id: string;
  title: string;
  tab: SettingsTab;
}

// Where the user was trying to go when a dirty section blocked them.
export type SettingsPendingTarget = { kind: 'nav'; key: ActiveKey } | { kind: 'tab'; tab: SettingsTab } | { kind: 'quit' };

export interface SettingsUiState {
  activeTab: SettingsTab;
  /** Ordered section metadata for the active tab — drives the jump rail. */
  sections: SettingsSectionMeta[];
  dirtyById: Record<string, boolean>;
  /** Section currently scroll-spied into view; highlights in the jump rail. */
  activeSectionId: string | null;
  /** Set when navigation/quit was blocked by unsaved changes. */
  pendingTarget: SettingsPendingTarget | null;
  /** Jump-rail click target the panel should smooth-scroll to, then clear. */
  pendingScrollSectionId: string | null;
}
