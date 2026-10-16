import type { DiscoveredContact } from '../../../shared/contacts/discovered';
import type { Channel, Contact, Message, MessagePath, MessageState, Owner, PathLearnedEvent } from '../../../shared/types';
import { mergeMessages } from '../mergeMessages';
import type { CoreState, SliceCreator } from './coreState';

// Retained per-key history. The renderer accumulates rather than tracking the
// server's sliding window (see mergeMessages), so it needs its own ceiling —
// main's own history is unbounded, `trimPerKey` having no caller.
//
// The gap between the two constants is deliberate. Trimming back to exactly the
// cap would shed one row per arrival once full, which is precisely the
// same-length-every-index-shifted shape that used to force a full rebuild on
// every message — the bug this whole area exists to fix, just relocated from
// 200 to the cap. Dropping a block at a time amortises it to one rebuild per
// HISTORY_CAP - HISTORY_KEEP messages instead of one per message.
const HISTORY_CAP = 5000;
const HISTORY_KEEP = 4000;

/** Domain data mirrored from main (owner, channels, contacts, message history),
 *  plus the message-scoped view state that has to follow it. */
export interface ConversationsSlice {
  // Domain data (mirrored from main)
  owner: Owner | null;
  channels: Channel[];
  /** Channel keys the connected radio reports owning right now. Empty when
   *  disconnected. Drives the "grayed missing channel" rendering in LeftNav. */
  channelPresence: Set<string>;
  contacts: Contact[];
  discovered: DiscoveredContact[];

  // Keyed by `key` (channel or contact key). The renderer is a cache —
  // authoritative history lives in main once Phase 3 lands.
  messagesByKey: Record<string, Message[]>;

  /** Per-conversation composer drafts, keyed by channel/contact key. At the
   *  store ROOT rather than under `ui` on purpose: this changes on every
   *  keystroke, and while it lived in `ui` every character allocated a new `ui`
   *  object — which re-rendered anything subscribed to it. Persisted separately
   *  to drafts.json; see app/useDraftsPersistence.ts. */
  drafts: Record<string, string>;

  // ID of the message currently expanded in the right rail. Clears when the
  // active key changes (the selection has no meaning outside its conversation).
  selectedMessageId: string | null;
  /** Message id whose delete confirmation is open. The row renders the
   *  confirm popover anchored to itself, so only an id is needed. */
  pendingDeleteMessageId: string | null;
  // When set, the currently-active ChannelView/DMView should scroll the
  // matching message into view and briefly flash it, then clear this. Set by
  // a search-result click. Distinct from `selectedMessageId` (right-rail
  // expansion) because we don't want every right-rail open to trigger a flash.
  pendingJumpMid: string | null;

  // A path-learn event waiting for a user verdict (Keep mine / Accept new).
  // Only populated when previousManual=true; auto-learn over an empty or
  // already-learned slot is applied silently with a toast.
  pendingPathLearn: PathLearnedEvent | null;

  applyMessages: (key: string, messages: Message[]) => void;
  removeMessages: (key: string, ids: string[]) => void;
  applyMessageState: (id: string, state: MessageState) => void;
  /** Append a newly-heard relay path to an outgoing channel message (dedupe by
   *  MessagePath.id, bump timesHeard, advance state). Broadcast by the main
   *  process when a PUSH_CODE_LOG_RX_DATA observation is attributed to one of
   *  our recent channel sends. */
  appendMessagePath: (id: string, path: MessagePath, state: MessageState) => void;
  applyChannels: (channels: Channel[]) => void;
  applyChannelPresence: (keys: string[]) => void;
  applyContacts: (contacts: Contact[]) => void;
  applyDiscovered: (rows: DiscoveredContact[]) => void;
  applyOwner: (owner: Owner | null) => void;
  applyPathLearned: (event: PathLearnedEvent) => void;
  dismissPathLearned: () => void;
  setDraft: (key: string, text: string) => void;
  setSelectedMessage: (id: string | null) => void;
  setPendingDeleteMessageId: (id: string | null) => void;
  /** Set by a search-result click. ChannelView/DMView consume it (scroll +
   *  flash) and then call this with null to clear. */
  setPendingJump: (mid: string | null) => void;
}

/**
 * Apply `update` to message `id`, rebuilding only the list(s) that hold it.
 * Every other key keeps its array identity, and so does `messagesByKey` itself
 * when no list holds the id. mergeMessages works to keep identities stable so a
 * changed reference means changed contents; rebuilding every key here would
 * re-render every `messagesByKey[key]` subscriber, and refetch the open
 * channel's activity, on any DM's delivery-state change.
 */
function updateMessageById(s: CoreState, id: string, update: (m: Message) => Message): Partial<CoreState> {
  // Searching every key is fine for normal volumes; if this becomes a hot
  // path we can switch to an id→key index.
  let next: Record<string, Message[]> | null = null;
  for (const [k, list] of Object.entries(s.messagesByKey)) {
    if (!list.some((m) => m.id === id)) continue;
    next ??= { ...s.messagesByKey };
    next[k] = list.map((m) => (m.id === id ? update(m) : m));
  }
  return next ? { messagesByKey: next } : {};
}

export function groupMessagesByKey(messages: Message[]): Record<string, Message[]> {
  const out: Record<string, Message[]> = {};
  for (const m of messages) {
    const list = out[m.key] ?? [];
    list.push(m);
    out[m.key] = list;
  }
  return out;
}

export const createConversationsSlice: SliceCreator<ConversationsSlice> = (set) => ({
  owner: null,
  channels: [],
  channelPresence: new Set<string>(),
  contacts: [],
  discovered: [],
  messagesByKey: {},
  drafts: {},
  selectedMessageId: null,
  pendingDeleteMessageId: null,
  pendingJumpMid: null,
  pendingPathLearn: null,

  // Main sends the TRAILING history window, re-derived per broadcast. Merge it
  // into what we hold rather than assigning it: past the window size a straight
  // assignment slides the array (m1..m200 → m2..m201), which reads as "every
  // index changed" and forces the message list into a full replace on every
  // single arrival. See mergeMessages.
  applyMessages: (key, messages) =>
    set((s) => {
      const merged = mergeMessages(s.messagesByKey[key] ?? [], messages);
      if (merged === s.messagesByKey[key]) return {};
      const capped = merged.length > HISTORY_CAP ? merged.slice(-HISTORY_KEEP) : merged;
      return { messagesByKey: { ...s.messagesByKey, [key]: capped } };
    }),

  applyMessageState: (id, state) => set((s) => updateMessageById(s, id, (m) => ({ ...m, state }))),

  appendMessagePath: (id, path, state) =>
    set((s) =>
      updateMessageById(s, id, (m) => {
        const existingPaths = m.meta?.paths ?? [];
        if (existingPaths.some((p) => p.id === path.id)) return { ...m, state };
        return {
          ...m,
          state,
          meta: {
            ...m.meta,
            paths: [...existingPaths, path],
            timesHeard: (m.meta?.timesHeard ?? 0) + 1,
          },
        };
      }),
    ),

  removeMessages: (key, ids) =>
    set((s) => {
      const list = s.messagesByKey[key];
      const drop = new Set(ids);
      const patch: Partial<CoreState> = {};
      if (list) patch.messagesByKey = { ...s.messagesByKey, [key]: list.filter((m) => !drop.has(m.id)) };
      // Both of these would otherwise dangle: the right rail resolves
      // selectedMessageId with a .find(), and a pendingJumpMid pointing at a
      // row that no longer exists never resolves — ChannelView/DMView keep
      // handing it to useJumpBackfill, which goes on fetching history around
      // an id the list can never land on.
      if (s.selectedMessageId && drop.has(s.selectedMessageId)) patch.selectedMessageId = null;
      if (s.pendingJumpMid && drop.has(s.pendingJumpMid)) patch.pendingJumpMid = null;
      return patch;
    }),

  applyChannels: (channels) => set(() => ({ channels })),
  applyChannelPresence: (keys) => set(() => ({ channelPresence: new Set(keys) })),
  applyContacts: (contacts) => set(() => ({ contacts })),
  applyDiscovered: (rows) => set(() => ({ discovered: rows })),
  applyOwner: (owner) => set(() => ({ owner })),

  applyPathLearned: (event) =>
    set(() => ({
      // Only block on a manual-path overwrite. Auto-learn over an empty slot or
      // an already-auto-learned path is silently absorbed — the App-level toast
      // surfaces it.
      pendingPathLearn: event.previousManual ? event : null,
    })),
  dismissPathLearned: () => set(() => ({ pendingPathLearn: null })),

  setDraft: (key, text) =>
    set((s) => {
      const next = { ...s.drafts };
      if (text) next[key] = text;
      else delete next[key];
      return { drafts: next };
    }),
  setSelectedMessage: (id) => set(() => ({ selectedMessageId: id })),
  setPendingDeleteMessageId: (id) => set(() => ({ pendingDeleteMessageId: id })),
  setPendingJump: (mid) => set(() => ({ pendingJumpMid: mid })),
});

export const selectActiveMessages = (s: CoreState) => s.messagesByKey[s.ui.activeKey] ?? [];
