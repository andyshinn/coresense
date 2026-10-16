import {
  type ActivityWindowKey,
  DEFAULT_UI_STATE,
  type LeftNavGroupId,
  type PeopleRailPrefs,
  type ThemePref,
  type UiState,
  type UsageMap,
} from '../../../shared/types';
import { recordUsage } from '../../features/message-actions/frecency';
import type { SliceCreator } from './coreState';
import { keepLast } from './util';

/** The persisted UiState (panes, pins, read markers, usage, theme) and the
 *  session-only chrome around it (palette, help, popovers). Navigation, which
 *  also writes `ui`, lives in the nav slice. */
export interface UiSlice {
  // UI state (left/right pane open, active key, pinned items, rail sections)
  ui: UiState;

  /** People rail search box. Deliberately at the store ROOT, not under `ui` —
   *  App.tsx persists `ui` and a search query should never survive a relaunch. */
  peopleQuery: string;

  // Cmd+K palette open state. Not persisted across reloads.
  paletteOpen: boolean;
  // Keyboard-shortcuts help overlay open state. Not persisted across reloads.
  helpOpen: boolean;
  // Add Channel popover open state. Not persisted across reloads.
  addChannelOpen: boolean;

  /** Merge the account-global subset of a remote UiState broadcast (unread
   *  markers, pinned, theme pref, recents). Window-local fields are ignored so
   *  another client's pane layout / active conversation can't clobber ours. */
  applyUiState: (state: UiState) => void;

  // UI mutators (also persisted to main via api.putUiState; see App.tsx)
  /** Pick a contact. `keepSite: true` preserves any currently-selected
   *  co-located site (used by the Map view's spiderfy when a member is
   *  highlighted but the site should stay expanded). Default behaviour clears
   *  the site so the two selections are mutually exclusive. */
  setSelectedContact: (key: string | null, options?: { keepSite?: boolean }) => void;
  setSelectedSite: (key: string | null) => void;
  toggleLeftNav: () => void;
  toggleRightRail: () => void;
  setRightWidth: (w: number) => void;
  setPeopleQuery: (q: string) => void;
  setPeopleRail: (channelKey: string, prefs: Partial<PeopleRailPrefs>) => void;
  setRailSection: (id: string, open: boolean) => void;
  setLeftNavGroup: (id: LeftNavGroupId, open: boolean) => void;
  recordEmojiUse: (emoji: string) => void;
  recordMacroUse: (macroId: string) => void;
  setChannelActivityWindow: (w: ActivityWindowKey) => void;
  setThemePref: (mode: ThemePref) => void;
  togglePin: (key: string) => void;
  markRead: (key: string, ts: number) => void;
  markAllRead: (key: string) => void;
  markAllReadGlobal: () => void;
  openPalette: () => void;
  closePalette: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  setAddChannelOpen: (open: boolean) => void;
}

const packetLogEqual = (a: UiState['packetLog'], b: UiState['packetLog']) =>
  a.liveBufferSize === b.liveBufferSize && a.storedHistorySize === b.storedHistorySize;

function arraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Per-key max merge of read markers. Returns the ORIGINAL `mine` reference when
 * the incoming map adds nothing, so callers can use identity to detect "no
 * change" and avoid allocating a new `ui` — which is what stops a synced client
 * from bouncing its own echo back forever.
 */
function mergeLastRead(mine: Record<string, number>, incoming: Record<string, number>): Record<string, number> {
  let out: Record<string, number> | null = null;
  for (const [key, ts] of Object.entries(incoming ?? {})) {
    if (ts > (mine[key] ?? 0)) {
      out ??= { ...mine };
      out[key] = ts;
    }
  }
  return out ?? mine;
}

// Usage-map values are per-id objects ({count, lastUsedMs}), not primitives, so
// `shallowEqualRecord`'s reference equality is always false once a broadcast
// round-trips through JSON (fresh object refs even when the values match).
// Compare one level deeper so an echo of unchanged counts is recognized as
// "same" and doesn't re-trigger the debounced PUT in App.tsx.
function usageMapEqual(a: UsageMap, b: UsageMap): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => b[k] != null && a[k].count === b[k].count && a[k].lastUsedMs === b[k].lastUsedMs);
}

export const createUiSlice: SliceCreator<UiSlice> = (set) => ({
  ui: DEFAULT_UI_STATE,
  peopleQuery: '',
  paletteOpen: false,
  helpOpen: false,
  addChannelOpen: false,

  applyUiState: (incoming) =>
    set((s) => {
      // Idempotent: when the synced subset already matches, return {} so `ui`
      // keeps its object identity and the persistence subscriber
      // (app/useUiStatePersistence.ts, which filters on `s.ui !== prev.ui`)
      // doesn't re-fire — otherwise a client would loop forever on its own echo.
      // That early return is the loop terminator; the write coalescer is not.
      //
      // Coalesce the usage maps: a legacy or partial producer may PUT a UiState
      // that omits one, and Object.keys(undefined) in usageMapEqual (or a
      // downstream topIds) would otherwise throw and break the WS handler for
      // every connected client.
      const incomingEmojiUsage = incoming.emojiUsage ?? {};
      const incomingMacroUsage = incoming.macroUsage ?? {};
      // Retention is synced too, and not just for looks: main sizes the packets
      // table's prune from whatever UiState it last received, so a client
      // still holding an old packetLog would revert another client's change —
      // and delete stored history — on its next unrelated PUT. A legacy
      // producer may omit it; keep ours rather than adopting undefined.
      const incomingPacketLog = incoming.packetLog ?? s.ui.packetLog;
      // Read markers merge per key by max rather than being adopted wholesale.
      // Two markRead advances can land inside one loopback round trip, so a
      // stale echo would otherwise drag the cursor backwards, allocate a fresh
      // `ui`, and bounce a PUT straight back — a 2-cycle that never settles.
      // Max-merging makes adoption order-independent, so a stale echo collapses
      // to what we already hold and the equality check below stops the loop.
      // Nothing in the app marks a conversation unread again, so read markers
      // only ever advance and this is also the correct merge between windows.
      const mergedLastRead = mergeLastRead(s.ui.lastReadByKey, incoming.lastReadByKey);
      const same =
        mergedLastRead === s.ui.lastReadByKey &&
        arraysEqual(s.ui.pinned, incoming.pinned) &&
        arraysEqual(s.ui.recentKeys, incoming.recentKeys) &&
        usageMapEqual(s.ui.emojiUsage, incomingEmojiUsage) &&
        usageMapEqual(s.ui.macroUsage, incomingMacroUsage) &&
        s.ui.themePref === incoming.themePref &&
        packetLogEqual(s.ui.packetLog, incomingPacketLog);
      if (same) return {};
      return {
        ui: {
          ...s.ui,
          lastReadByKey: mergedLastRead,
          pinned: incoming.pinned,
          recentKeys: incoming.recentKeys,
          emojiUsage: incomingEmojiUsage,
          macroUsage: incomingMacroUsage,
          themePref: incoming.themePref,
          packetLog: incomingPacketLog,
        },
        // Adopted retention applies to the live buffer straight away.
        packets: keepLast(s.packets, incomingPacketLog.liveBufferSize),
      };
    }),

  setSelectedContact: (key, options) =>
    // Picking a contact clears any selected site so the Map rail routes
    // unambiguously to the node card. Auto-open the rail so the resulting
    // node card is immediately visible (a no-op when already open or when the
    // selection is being cleared). When `keepSite` is set, leave the site
    // selection alone — used by the spiderfied member click so the spread
    // stays open with the chosen member highlighted.
    set((s) => ({
      ui: {
        ...s.ui,
        selectedContactKey: key,
        selectedSiteKey: options?.keepSite ? s.ui.selectedSiteKey : null,
        rightOpen: key ? true : s.ui.rightOpen,
      },
    })),
  setSelectedSite: (key) =>
    set((s) => ({
      ui: {
        ...s.ui,
        selectedSiteKey: key,
        selectedContactKey: null,
        rightOpen: key ? true : s.ui.rightOpen,
      },
    })),
  toggleLeftNav: () => set((s) => ({ ui: { ...s.ui, leftOpen: !s.ui.leftOpen } })),
  toggleRightRail: () => set((s) => ({ ui: { ...s.ui, rightOpen: !s.ui.rightOpen } })),
  setRightWidth: (w) => set((s) => ({ ui: { ...s.ui, rightWidth: w } })),
  setPeopleQuery: (q) => set(() => ({ peopleQuery: q })),
  setPeopleRail: (channelKey, prefs) =>
    set((s) => {
      const existing: PeopleRailPrefs | undefined = s.ui.peopleRail[channelKey];
      const merged: PeopleRailPrefs = {
        sort: prefs.sort ?? existing?.sort ?? 'recent',
        filter: prefs.filter ?? existing?.filter ?? 'all',
      };
      return {
        ui: {
          ...s.ui,
          peopleRail: { ...s.ui.peopleRail, [channelKey]: merged },
        },
      };
    }),
  setRailSection: (id, open) =>
    set((s) => ({ ui: { ...s.ui, openRailSections: { ...s.ui.openRailSections, [id]: open } } })),
  setLeftNavGroup: (id, open) => set((s) => ({ ui: { ...s.ui, leftNavOpen: { ...s.ui.leftNavOpen, [id]: open } } })),
  recordEmojiUse: (emoji) => set((s) => ({ ui: { ...s.ui, emojiUsage: recordUsage(s.ui.emojiUsage, emoji, Date.now()) } })),
  recordMacroUse: (macroId) =>
    set((s) => ({ ui: { ...s.ui, macroUsage: recordUsage(s.ui.macroUsage, macroId, Date.now()) } })),
  setChannelActivityWindow: (w) => set((s) => ({ ui: { ...s.ui, channelActivityWindow: w } })),
  setThemePref: (mode) => set((s) => ({ ui: { ...s.ui, themePref: mode } })),
  togglePin: (key) =>
    set((s) => {
      const has = s.ui.pinned.includes(key);
      return {
        ui: {
          ...s.ui,
          pinned: has ? s.ui.pinned.filter((k) => k !== key) : [...s.ui.pinned, key],
        },
      };
    }),
  markRead: (key, ts) =>
    set((s) => {
      const prev = s.ui.lastReadByKey[key] ?? 0;
      if (ts <= prev) return {};
      return {
        ui: { ...s.ui, lastReadByKey: { ...s.ui.lastReadByKey, [key]: ts } },
      };
    }),
  markAllRead: (key) =>
    set((s) => ({
      ui: { ...s.ui, lastReadByKey: { ...s.ui.lastReadByKey, [key]: Date.now() } },
    })),
  markAllReadGlobal: () =>
    set((s) => {
      const now = Date.now();
      const next: Record<string, number> = { ...s.ui.lastReadByKey };
      for (const ch of s.channels) next[ch.key] = now;
      for (const c of s.contacts) next[c.key] = now;
      return { ui: { ...s.ui, lastReadByKey: next } };
    }),
  openPalette: () => set(() => ({ paletteOpen: true })),
  closePalette: () => set(() => ({ paletteOpen: false })),
  openHelp: () => set(() => ({ helpOpen: true })),
  closeHelp: () => set(() => ({ helpOpen: false })),
  setAddChannelOpen: (open) => set(() => ({ addChannelOpen: open })),
});
