import type { RepeaterNeighboursPage, RepeaterStatusSnapshot } from '../../../shared/types';
import type { NeighbourSortKey } from '../neighbours';
import type { SliceCreator } from './coreState';
import type { NeighboursViewState, RepeaterAdminTab } from './types';

// Repeater Neighbours view state — see NeighboursViewState.
const NB_DEFAULTS: NeighboursViewState = {
  forKey: null,
  page: null,
  sortKey: 'snr-desc',
  count: 16,
  busy: false,
  selectedId: null,
  hoveredId: null,
  showNames: true,
};

/** The repeater detail panel: the latest admin responses, its tabs, and the
 *  Neighbours view shared between the main pane and the rail. */
export interface RepeaterAdminSlice {
  // Latest repeater admin snapshots keyed by contact key. Only the last
  // response is retained — the RightRail / RepeaterAdmin show it; we don't
  // need a full history for v1.
  repeaterStatusByKey: Record<string, RepeaterStatusSnapshot>;

  // Renderer-only deep-link intent: the detail panel's Telemetry/Permissions/
  // Remote-Mgmt buttons set this, then navigate to the repeater contact;
  // RepeaterAdmin consumes + clears it on mount. Not persisted.
  repeaterAdminTab: RepeaterAdminTab | null;
  setRepeaterAdminTab: (tab: RepeaterAdminTab | null) => void;

  // The repeater detail panel's currently-open tab, published so the right rail
  // can show the Neighbours list section when that tab is active. Persistent
  // (unlike the transient deep-link `repeaterAdminTab` above); cleared when the
  // panel unmounts.
  repeaterAdminActiveTab: RepeaterAdminTab | null;
  setRepeaterAdminActiveTab: (tab: RepeaterAdminTab | null) => void;

  // Bumped by RepeaterAdmin on every login/logout. Admin sessions live in its
  // local state and main pushes none over WS, so this is how the rail's
  // Telemetry section knows to re-read its "logged in?" hint. Not persisted.
  repeaterAdminSessionRev: number;
  bumpRepeaterAdminSessionRev: () => void;

  // Repeater Neighbours view (map + rail list) — see NeighboursViewState.
  neighbours: NeighboursViewState;
  setNeighboursFor: (key: string) => void;
  setNeighboursPage: (page: RepeaterNeighboursPage | null, forKey: string) => void;
  setNeighboursSort: (sortKey: NeighbourSortKey) => void;
  setNeighboursCount: (count: number) => void;
  setNeighboursBusy: (busy: boolean) => void;
  setNeighbourSelected: (id: string | null) => void;
  setNeighbourHovered: (id: string | null) => void;
  setNeighboursShowNames: (showNames: boolean) => void;

  applyRepeaterStatus: (snap: RepeaterStatusSnapshot) => void;
}

export const createRepeaterAdminSlice: SliceCreator<RepeaterAdminSlice> = (set) => ({
  repeaterStatusByKey: {},
  repeaterAdminTab: null,
  repeaterAdminActiveTab: null,
  repeaterAdminSessionRev: 0,
  neighbours: NB_DEFAULTS,

  setRepeaterAdminTab: (tab) => set(() => ({ repeaterAdminTab: tab })),
  bumpRepeaterAdminSessionRev: () => set((s) => ({ repeaterAdminSessionRev: s.repeaterAdminSessionRev + 1 })),
  setRepeaterAdminActiveTab: (tab) =>
    set((s) => ({
      repeaterAdminActiveTab: tab,
      // Entering the Neighbours tab surfaces its controls/list in the rail, so
      // make sure the rail is open (open-only — never auto-collapses).
      ui: tab === 'neighbours' ? { ...s.ui, rightOpen: true } : s.ui,
    })),
  setNeighboursFor: (key) =>
    set((s) =>
      s.neighbours.forKey === key
        ? {}
        : {
            neighbours: {
              ...s.neighbours,
              forKey: key,
              page: null,
              selectedId: null,
              hoveredId: null,
              busy: false,
            },
          },
    ),
  setNeighboursPage: (page, forKey) =>
    set((s) => (s.neighbours.forKey === forKey ? { neighbours: { ...s.neighbours, page } } : {})),
  setNeighboursSort: (sortKey) => set((s) => ({ neighbours: { ...s.neighbours, sortKey } })),
  setNeighboursCount: (count) => set((s) => ({ neighbours: { ...s.neighbours, count } })),
  setNeighboursBusy: (busy) => set((s) => ({ neighbours: { ...s.neighbours, busy } })),
  setNeighbourSelected: (id) => set((s) => ({ neighbours: { ...s.neighbours, selectedId: id } })),
  setNeighbourHovered: (id) => set((s) => ({ neighbours: { ...s.neighbours, hoveredId: id } })),
  setNeighboursShowNames: (showNames) => set((s) => ({ neighbours: { ...s.neighbours, showNames } })),
  applyRepeaterStatus: (snap) =>
    set((s) => ({
      repeaterStatusByKey: { ...s.repeaterStatusByKey, [snap.contactKey]: snap },
    })),
});
