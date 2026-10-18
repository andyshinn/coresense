import type { ActiveKey } from '../../../shared/keys';
import type { CoreState, SliceCreator } from './coreState';
import type { SettingsPendingTarget, SettingsSectionMeta, SettingsTab, SettingsUiState } from './types';

// ---- Settings panel UI state (see SettingsUiState) -------------------------
const DEFAULT_SETTINGS_UI: SettingsUiState = {
  activeTab: 'app',
  sections: [],
  dirtyById: {},
  activeSectionId: null,
  pendingTarget: null,
  pendingScrollSectionId: null,
};

/** Navigation (the active view and back/forward history) together with the
 *  Settings panel's UI state. They share a slice because they are one piece of
 *  behaviour: leaving a dirty Settings panel parks the target in `settingsUi`
 *  instead of navigating, and resolving the prompt commits that move through
 *  the same history/recents logic as an unguarded one. This is the slice that
 *  writes `settingsUi`; its navigation also writes `ui` and the selections. */
export interface NavSlice {
  // Browser-style back/forward stacks. Session-only (deliberately NOT in
  // UiState/persisted) — a restart starts fresh, and entries pointing at
  // channels/contacts that no longer exist would be misleading. navCurrent
  // is implicit: it equals ui.activeKey.
  navPast: ActiveKey[];
  navFuture: ActiveKey[];

  // Settings panel UI (active tab, registered sections, dirty map, prompts)
  settingsUi: SettingsUiState;

  // `skipHistory` opts out of pushing the prior activeKey onto navPast — used
  // by goBack/goForward themselves and by the few "restore previous view"
  // sites (Esc in the search input) that are conceptually an undo, not a
  // navigation. Default behaviour pushes history.
  setActiveKey: (key: ActiveKey, opts?: { skipHistory?: boolean }) => void;
  goBack: () => void;
  goForward: () => void;

  // ---- Settings panel mutators ----
  /** Switch the active Settings tab. Guarded: prompts when a section is dirty. */
  setSettingsTab: (tab: SettingsTab) => void;
  /** Declared by SettingsPanel each tab change — the ordered jump-rail list. */
  registerSettingsSections: (sections: SettingsSectionMeta[]) => void;
  /** Each section reports its dirty flag here (drives rail + pill dots). */
  setSectionDirty: (id: string, dirty: boolean) => void;
  /** Scroll-spy result from the panel's IntersectionObserver. */
  setActiveSettingsSection: (id: string | null) => void;
  /** Jump-rail click — the panel watches this and smooth-scrolls. */
  requestScrollToSection: (id: string) => void;
  clearScrollRequest: () => void;
  /** Stash a blocked navigation/quit so the panel can show the prompt. */
  setPendingTarget: (target: SettingsPendingTarget) => void;
  clearPendingTarget: () => void;
  /** Run the blocked navigation/tab-switch after the user resolves the prompt. */
  commitPendingTarget: () => void;
  /** Reset settings UI state when the panel unmounts. */
  clearSettingsUi: () => void;
}

const RECENT_KEYS_MAX = 10;

// Shared navigation update — used by setActiveKey, commitPendingTarget, and
// goBack/goForward so a deferred or backward navigation commits with exactly
// the same recents/selection logic. `historyDelta` lets the caller adjust the
// nav stacks (push prior key for forward nav; swap stacks for back/forward).
function navStateUpdate(
  s: CoreState,
  key: ActiveKey,
  historyDelta?: { navPast?: ActiveKey[]; navFuture?: ActiveKey[] },
): Partial<CoreState> {
  const recentKeys = [key, ...s.ui.recentKeys.filter((k) => k !== key)].slice(0, RECENT_KEYS_MAX);
  const out: Partial<CoreState> = {
    ui: {
      ...s.ui,
      activeKey: key,
      // The Contact Manager keeps its bulk/list actions in the right rail, so
      // open it on arrival. Other destinations preserve the user's choice.
      rightOpen: key === 'tool:contacts' ? true : s.ui.rightOpen,
      selectedContactKey: null,
      selectedSiteKey: null,
      recentKeys,
    },
    selectedMessageId: null,
  };
  if (historyDelta?.navPast !== undefined) out.navPast = historyDelta.navPast;
  if (historyDelta?.navFuture !== undefined) out.navFuture = historyDelta.navFuture;
  return out;
}

// Cap the back/forward stacks. Browsers use ~50; same here. Older entries are
// dropped from the front of navPast when exceeded.
const NAV_HISTORY_MAX = 50;

function pushPast(past: ActiveKey[], key: ActiveKey): ActiveKey[] {
  // Dedupe consecutive duplicates so repeated clicks on the same item don't
  // bloat the stack.
  if (past.length > 0 && past[past.length - 1] === key) return past;
  const next = [...past, key];
  return next.length > NAV_HISTORY_MAX ? next.slice(-NAV_HISTORY_MAX) : next;
}

function anyDirty(dirtyById: Record<string, boolean>): boolean {
  return Object.values(dirtyById).some(Boolean);
}

// Guard for setActiveKey, goBack and goForward: if the user is leaving the
// Settings panel with unsaved section changes, stash the target and let the
// panel raise the prompt instead of navigating. Null when the move may proceed.
function guardLeaveSettings(s: CoreState, target: ActiveKey): Partial<CoreState> | null {
  const leavingSettings = s.ui.activeKey.startsWith('tool:settings') && !target.startsWith('tool:settings');
  if (!leavingSettings || !anyDirty(s.settingsUi.dirtyById)) return null;
  return { settingsUi: { ...s.settingsUi, pendingTarget: { kind: 'nav', key: target } } };
}

export const createNavSlice: SliceCreator<NavSlice> = (set) => ({
  navPast: [],
  navFuture: [],
  settingsUi: DEFAULT_SETTINGS_UI,

  setActiveKey: (key, opts) =>
    set((s) => {
      // No-op when the user clicks the already-active entry. Avoids polluting
      // history with a dedupe-able entry, and short-circuits the unsaved-guard
      // check that would otherwise trigger on Settings → Settings.
      if (key === s.ui.activeKey) return {};
      // recentKeys + nav stacks stay untouched until a blocked move commits
      // via commitPendingTarget.
      const blocked = guardLeaveSettings(s, key);
      if (blocked) return blocked;
      // Forward navigation: push current onto past, clear future. Restore-from-
      // search-Esc and goBack/goForward itself opt out via skipHistory.
      if (opts?.skipHistory) return navStateUpdate(s, key);
      return navStateUpdate(s, key, {
        navPast: pushPast(s.navPast, s.ui.activeKey),
        navFuture: [],
      });
    }),
  goBack: () =>
    set((s) => {
      if (s.navPast.length === 0) return {};
      const target = s.navPast[s.navPast.length - 1];
      // Same Settings unsaved-guard as forward nav — back through a dirty
      // Settings panel still needs the prompt. The deferred commit replays
      // the goBack by routing through navStateUpdate with swapped stacks.
      const blocked = guardLeaveSettings(s, target);
      if (blocked) return blocked;
      return navStateUpdate(s, target, {
        navPast: s.navPast.slice(0, -1),
        navFuture: [...s.navFuture, s.ui.activeKey],
      });
    }),
  goForward: () =>
    set((s) => {
      if (s.navFuture.length === 0) return {};
      const target = s.navFuture[s.navFuture.length - 1];
      const blocked = guardLeaveSettings(s, target);
      if (blocked) return blocked;
      return navStateUpdate(s, target, {
        navPast: pushPast(s.navPast, s.ui.activeKey),
        navFuture: s.navFuture.slice(0, -1),
      });
    }),

  setSettingsTab: (tab) =>
    set((s) => {
      if (tab === s.settingsUi.activeTab) return {};
      // Switching tabs unmounts the current tab's sections (losing their
      // drafts), so prompt first when anything is dirty.
      if (anyDirty(s.settingsUi.dirtyById)) {
        return { settingsUi: { ...s.settingsUi, pendingTarget: { kind: 'tab', tab } } };
      }
      return { settingsUi: { ...s.settingsUi, activeTab: tab } };
    }),
  registerSettingsSections: (sections) => set((s) => ({ settingsUi: { ...s.settingsUi, sections } })),
  setSectionDirty: (id, dirty) =>
    set((s) => {
      if ((s.settingsUi.dirtyById[id] ?? false) === dirty) return {};
      return {
        settingsUi: { ...s.settingsUi, dirtyById: { ...s.settingsUi.dirtyById, [id]: dirty } },
      };
    }),
  setActiveSettingsSection: (id) =>
    set((s) => {
      if (s.settingsUi.activeSectionId === id) return {};
      return { settingsUi: { ...s.settingsUi, activeSectionId: id } };
    }),
  requestScrollToSection: (id) => set((s) => ({ settingsUi: { ...s.settingsUi, pendingScrollSectionId: id } })),
  clearScrollRequest: () => set((s) => ({ settingsUi: { ...s.settingsUi, pendingScrollSectionId: null } })),
  setPendingTarget: (target) => set((s) => ({ settingsUi: { ...s.settingsUi, pendingTarget: target } })),
  clearPendingTarget: () => set((s) => ({ settingsUi: { ...s.settingsUi, pendingTarget: null } })),
  commitPendingTarget: () =>
    set((s) => {
      const t = s.settingsUi.pendingTarget;
      if (!t) return {};
      if (t.kind === 'nav') {
        // Treat the deferred nav as a fresh forward navigation — push current
        // onto past, clear future. If the original gesture was Cmd+Left, the
        // user resolving the unsaved-changes dialog effectively committed to
        // a new nav rather than a strict pop; this matches what a browser does
        // when "Leave this page?" is confirmed.
        return {
          ...navStateUpdate(s, t.key, {
            navPast: pushPast(s.navPast, s.ui.activeKey),
            navFuture: [],
          }),
          settingsUi: { ...s.settingsUi, pendingTarget: null },
        };
      }
      if (t.kind === 'tab') {
        return { settingsUi: { ...s.settingsUi, pendingTarget: null, activeTab: t.tab } };
      }
      // 'quit' is resolved by the dialog (POST /api/app/quit); just clear it.
      return { settingsUi: { ...s.settingsUi, pendingTarget: null } };
    }),
  clearSettingsUi: () => set(() => ({ settingsUi: DEFAULT_SETTINGS_UI })),
});

export const selectAnySettingsDirty = (s: CoreState) => anyDirty(s.settingsUi.dirtyById);
