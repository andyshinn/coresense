import {
  type ItemContent,
  scrollToBottomAlways,
  scrollToBottomIfAtBottom,
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  type VirtuosoMessageListMethods,
} from '@virtuoso.dev/message-list';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Contact, Message, MessageStyle, Owner } from '../../shared/types';
import { buildMessageMenuItems } from '../features/message-actions/menuItems';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { fmtDate } from '../lib/time';
import { deriveSenderName } from '../lib/utils';
import { VIRTUOSO_LICENSE_KEY } from '../lib/virtuosoLicense';
import { BlockSenderDialog, type BlockSenderDialogPrefill } from './BlockSenderDialog';
import { ContextMenu } from './ContextMenu';
import { MessageDivider } from './MessageDivider';
import { MessageRow } from './MessageRow';
import {
  buildItems,
  computeDividerInsertIdx,
  computeFirstUnreadIdx,
  computeMarkReadTs,
  freshUnreadDivider,
  type Item,
} from './messageListItems';
import { locationFor, planSync } from './messageListSync';

interface Props {
  conversationKey: string;
  messages: Message[];
  owner: Owner | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  style: MessageStyle;
  contacts: Contact[];
  lastReadMs: number;
  onMarkRead: (ts: number) => void;
  onResend?: (message: Message) => void;
  onReply?: (senderName: string) => void;
  onReact?: (name: string, emoji: string) => void;
  onMacro?: (name: string, text: string) => void;
  client: ApiClient | null;
  /** When set, scroll the row whose message.id matches into view and apply a
   *  brief highlight, then call onJumpConsumed so the parent clears state. */
  jumpToId?: string | null;
  onJumpConsumed?: () => void;
}

interface RowContext {
  ownerPk: string | undefined;
  contactByPk: Map<string, Contact>;
  style: MessageStyle;
  selectedId: string | null;
  flashId: string | null;
  onSelect: (id: string) => void;
  onReply?: (name: string) => void;
  onReact?: (name: string, emoji: string) => void;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  onMacro?: (name: string, text: string) => void;
  // Optional all the way down (unlike onBlock, which every caller supplies):
  // buildMessageMenuItems keys "Re-send" off `onResend != null`, so a
  // non-null wrapper forwarder would offer the item with nothing behind it.
  onResend?: (m: Message) => void;
  onContextMenu: (m: Message, e: React.MouseEvent) => void;
  /** True while the right-click menu is open, so rows drop their hover bar. */
  contextMenuOpen: boolean;
  client: ApiClient | null;
}

interface MessageMenuState {
  message: Message;
  x: number;
  y: number;
}

/** How long a search-jump landing keeps its highlight. Matches the
 *  `[data-flash="true"]` keyframe in index.css, plus a little slack. */
const FLASH_MS = 1600;

/**
 * Swap in updated messages without disturbing the viewport.
 *
 * The `'auto'` behaviour is what re-pins a bottom-anchored list when a row
 * GROWS as a result of the update — a received message picking up its first
 * path gains a whole trailing-meta cluster, which in compact style can wrap the
 * body onto another line. Calling `map` with no behaviour (as this did) leaves
 * the library's own displacement handling switched off, so the list quietly
 * drifts off the bottom.
 */
function applyUpdates(ref: VirtuosoMessageListMethods<Item, RowContext>, updated: Map<string, Message>): void {
  ref.data.map((item) => {
    if (item.kind !== 'msg') return item;
    const next = updated.get(item.m.id);
    return next ? { kind: 'msg', m: next } : item;
  }, 'auto');
}

const ItemRow: ItemContent<Item, RowContext> = ({ data, context }) => {
  if (data.kind === 'date') return <MessageDivider label={fmtDate(data.ts)} tone="date" />;
  if (data.kind === 'divider') return <MessageDivider label="New" tone="accent" />;
  const m = data.m;
  const isSelf = m.fromPublicKeyHex === undefined;
  // Resolve the display name here (the row context already holds contactByPk)
  // and pass it down — MessageRow/MessageItem are name-only, not Contact-aware.
  const senderName =
    (m.fromPublicKeyHex ? context.contactByPk.get(m.fromPublicKeyHex)?.name : undefined) ??
    deriveSenderName(m.fromPublicKeyHex);
  return (
    <MessageRow
      message={m}
      isSelf={isSelf}
      selected={context.selectedId === m.id}
      flash={context.flashId === m.id}
      onSelect={() => context.onSelect(m.id)}
      onContextMenu={(e) => context.onContextMenu(m, e)}
      style={context.style}
      senderName={senderName}
      onReply={context.onReply}
      onReact={context.onReact}
      onBlock={context.onBlock}
      contextMenuOpen={context.contextMenuOpen}
      onResend={context.onResend}
      client={context.client}
      onMacro={context.onMacro}
    />
  );
};

const EmptyState = () => (
  <div className="flex h-full items-center justify-center px-6 text-center text-xs text-cs-text-dim">
    <p>No messages yet. Send one to start the conversation.</p>
  </div>
);

export function MessageList({
  conversationKey,
  messages,
  owner,
  selectedId,
  onSelect,
  style,
  contacts,
  lastReadMs,
  onMarkRead,
  onResend,
  onReply,
  onReact,
  onMacro,
  client,
  jumpToId,
  onJumpConsumed,
}: Props) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const windowFocused = useStore((s) => s.windowFocused);
  const listRef = useRef<VirtuosoMessageListMethods<Item, RowContext>>(null);
  const [menu, setMenu] = useState<MessageMenuState | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [blockPrefill, setBlockPrefill] = useState<BlockSenderDialogPrefill | null>(null);

  // Frozen at conversation-open so the divider stays anchored while new
  // messages arrive — bumping the marker live would yank it from under the
  // user. Reset on key change.
  const initialLastReadRef = useRef(lastReadMs);
  // Track prior props for diffing in the data-sync effect. Tracks the
  // *visible* (post-block-filter) messages so that append/prepend/replace
  // diffs stay aligned with what's actually rendered.
  const prevKeyRef = useRef(conversationKey);
  const prevMessagesRef = useRef<Message[]>([]);
  // Highest message ts we've already reported as read — guards against
  // re-firing onMarkRead for the same cursor as Virtuoso fires
  // onRenderedDataChange on every visible-range tick.
  const lastMarkedReadRef = useRef(0);
  // Where the read cursor stood when the window lost focus. Everything past it
  // arrived while the user was away, and is what the 'New' marker points at on
  // return. Null while focused, or once the marker has been placed.
  const blurCursorRef = useRef<number | null>(null);
  const prevFocusedRef = useRef(windowFocused);

  // Reset transient state when switching conversations.
  useEffect(() => {
    if (prevKeyRef.current !== conversationKey) {
      setMenu(null);
      setFlashId(null);
      setBlockPrefill(null);
      useStore.getState().setPendingDeleteMessageId(null);
    }
  }, [conversationKey]);

  const contactByPk = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.publicKeyHex, c);
    return m;
  }, [contacts]);

  // Drop messages annotated as blocked by main before they hit the rendered
  // list. Unread bookkeeping (lastMarkedReadRef / onMarkRead) still reads the
  // original `messages` so the last-read cursor stays aligned with what main
  // considers read — silently advancing past blocked rows is fine because they
  // are no longer visible anywhere.
  const visibleMessages = useMemo(() => messages.filter((m) => m.meta?.blocked !== true), [messages]);

  // Consuming the jump has to happen from inside the sync effect, which must
  // not re-run just because a parent re-rendered. Both parents pass an inline
  // arrow for onJumpConsumed, so its identity changes every render; mirror both
  // into refs and keep them out of the dependency arrays.
  const jumpToIdRef = useRef(jumpToId);
  jumpToIdRef.current = jumpToId;
  const onJumpConsumedRef = useRef(onJumpConsumed);
  onJumpConsumedRef.current = onJumpConsumed;
  // True from the moment a jump scroll is issued until it has had time to
  // settle. Guards the append policy: `scrollToBottomIfAtBottom` also fires
  // while a scroll is in progress, which would yank a jump-in-flight list to
  // the bottom if a message happened to land mid-animation.
  const jumpInFlightRef = useRef(false);

  // Seed the list on first mount. Subsequent renders ignore initialData /
  // initialLocation — updates go through the imperative ref.
  const initialItemsRef = useRef<Item[] | null>(null);
  const initialLocationRef = useRef<ReturnType<typeof locationFor> | null>(null);
  // A jump already delivered by the mount-time initialLocation prop. Without
  // this the sync effect would follow it with a redundant scrollToItem against
  // a list whose rows are not measured yet.
  const seededJumpRef = useRef<string | null>(null);
  if (!initialItemsRef.current) {
    const firstUnreadIdx = computeFirstUnreadIdx(visibleMessages, initialLastReadRef.current);
    initialItemsRef.current = buildItems(visibleMessages, firstUnreadIdx);
    initialLocationRef.current = locationFor(initialItemsRef.current, jumpToId);
    prevMessagesRef.current = visibleMessages;
    if (jumpToId && initialItemsRef.current.some((i) => i.kind === 'msg' && i.m.id === jumpToId)) {
      seededJumpRef.current = jumpToId;
    }
  }

  /** Ids already delivered. The parent clears `jumpToId` in response, but not
   *  before the effect can run again — StrictMode replays it on mount, and the
   *  ref mirror means the stale id is still visible on that second pass. */
  const consumedJumpRef = useRef<string | null>(null);

  /** Land the jump: flash the row and tell the parent to drop it. The
   *  in-flight flag is owned by the flash effect, not set here, so that every
   *  way the flash can end also clears it. */
  const consumeJump = useCallback((id: string) => {
    if (consumedJumpRef.current === id) return;
    consumedJumpRef.current = id;
    setFlashId(id);
    onJumpConsumedRef.current?.();
  }, []);

  // Sync messages → list via the imperative API, and land any pending jump.
  //
  // Both live here because they are the same decision. A `data.replace` that
  // carries an `initialLocation` publishes that scroll two animation frames
  // later, into the very signal `scrollToItem` writes to — so a jump issued
  // from a separate effect is silently overwritten by the replace that just
  // ran. Rather than race it, the jump BECOMES the replace's location (see
  // locationFor). Only when there is no data operation to ride does the jump
  // fall back to an imperative scroll, which is safe there because the list is
  // already measured.
  //
  // `jumpToId` is in the dep array purely as a re-run trigger: the body reads
  // jumpToIdRef, so a parent re-render alone cannot replay a consumed jump, but
  // a NEW jump arriving with no data change still has to wake the effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: jumpToId is a re-run trigger, read via ref — see above
  useEffect(() => {
    const ref = listRef.current;
    if (!ref) {
      // No list mounted — an empty conversation renders EmptyState instead. The
      // bookkeeping still has to advance, or the NEXT mount is diagnosed
      // against whatever the previous conversation left behind and concludes
      // there is nothing to do, leaving the remounted list permanently blank.
      prevKeyRef.current = conversationKey;
      prevMessagesRef.current = [];
      return;
    }

    const conversationChanged = prevKeyRef.current !== conversationKey;
    if (conversationChanged) {
      initialLastReadRef.current = lastReadMs;
      lastMarkedReadRef.current = lastReadMs;
      // A cursor captured while a DIFFERENT conversation was open would plant
      // this one's divider at that conversation's boundary. The rebuild below
      // already places the divider from lastReadMs, which is correct here.
      blurCursorRef.current = null;
      consumedJumpRef.current = null;
    }
    const plan = planSync(prevMessagesRef.current, visibleMessages, {
      conversationChanged,
      unreadCutoff: initialLastReadRef.current,
    });
    prevKeyRef.current = conversationKey;
    prevMessagesRef.current = visibleMessages;

    const jump = jumpToIdRef.current;
    const alreadyDelivered = jump != null && consumedJumpRef.current === jump;
    // A replace is the only op that can carry the landing spot itself; the rest
    // preserve the viewport, so a jump riding one of those still needs a scroll
    // afterwards. `seededJumpRef` covers the mount case, where the jump already
    // went in as the initialLocation prop.
    let jumpHandled = jump != null && seededJumpRef.current === jump;
    seededJumpRef.current = null;

    switch (plan.op) {
      case 'replace': {
        const location = locationFor(plan.items, jump);
        // Don't pass purgeItemSizes: true — it forces a re-measure pass where
        // Virtuoso's render window can transiently include slots whose data is
        // still undefined, crashing computeItemKey. Replace re-measures
        // naturally as items mount.
        ref.data.replace(plan.items, { initialLocation: location });
        // Delivered iff the target is actually in this batch — NOT iff the
        // location points at it, because locationFor deliberately yields to the
        // divider when the jump target is the first unread message, and that is
        // still a successful landing.
        if (jump && plan.items.some((i) => i.kind === 'msg' && i.m.id === jump)) jumpHandled = true;
        break;
      }
      case 'append': {
        if (plan.updated) applyUpdates(ref, plan.updated);
        ref.data.append(
          plan.items,
          // Our own send must become visible even if we had scrolled up;
          // someone else's must not yank us away from what we were reading.
          plan.isOwnSend
            ? scrollToBottomAlways
            : (params) => (jumpInFlightRef.current ? false : scrollToBottomIfAtBottom(params)),
        );
        break;
      }
      case 'prepend':
        // This is the shape a jump backfill takes: older history spliced in
        // front of what was already loaded. Prepend preserves the viewport, so
        // the scroll below is what actually delivers the jump.
        ref.data.prepend(plan.items);
        break;
      case 'update':
        applyUpdates(ref, plan.updated);
        break;
      case 'none':
        break;
    }

    if (!jump || alreadyDelivered) return;
    if (jumpHandled) {
      consumeJump(jump);
      return;
    }
    // The target may simply not be loaded yet (older than the fetched window).
    // Leaving the jump pending is deliberate — useJumpBackfill is fetching the
    // history around it, and the resulting prepend comes back through here.
    const idx = ref.data.findIndex((i) => i.kind === 'msg' && i.m.id === jump);
    if (idx < 0) return;
    ref.scrollToItem({ index: idx, align: 'start-no-overflow', behavior: 'smooth' });
    consumeJump(jump);
  }, [conversationKey, visibleMessages, lastReadMs, jumpToId, consumeJump]);

  // The landing highlight, on its own timer. It used to hang off the jump
  // effect, whose cleanup fired the moment consuming the jump flipped `jumpToId`
  // to null — cancelling the timeout and leaving the row flashing indefinitely.
  //
  // This also owns `jumpInFlightRef` for its whole lifetime. Setting the flag
  // where the jump is issued and clearing it only in the timer body leaked it:
  // switching conversation mid-flash clears flashId, which cancels the timer,
  // so the flag stayed true and suppressed bottom-pinning for every arrival
  // afterwards. Tying it to the effect means every way the flash can end —
  // timer, conversation switch, a second jump, unmount — releases it.
  useEffect(() => {
    if (!flashId) return;
    jumpInFlightRef.current = true;
    const t = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => {
      clearTimeout(t);
      jumpInFlightRef.current = false;
    };
  }, [flashId]);

  // Latest rendered range, captured so a window-focus regain can re-run
  // mark-read against what's currently on screen — Virtuoso won't re-fire
  // onRenderedDataChange just because the OS window regained focus.
  const lastRangeRef = useRef<Item[]>([]);

  // Mark-read driven by what's actually on screen, but only while the app
  // window is focused. Walking the rendered items and taking the max message ts
  // covers initial render (no scroll event), incremental scroll-through-unread,
  // and new arrivals while pinned to the bottom. Gating on focus is the fix for
  // the flash-then-vanish bug: a message arriving in the active conversation
  // while the window is backgrounded must stay unread so its notification isn't
  // cleared out from under the user (auto-mark-read → uiState → clear-on-read).
  const maybeMarkRead = useCallback(() => {
    const ts = computeMarkReadTs(lastRangeRef.current, lastMarkedReadRef.current, windowFocused);
    if (ts !== null) {
      lastMarkedReadRef.current = ts;
      onMarkRead(ts);
    }
  }, [onMarkRead, windowFocused]);

  const handleRenderedDataChange = (range: Item[]) => {
    lastRangeRef.current = range;
    maybeMarkRead();
  };

  // Focus transitions around the active conversation.
  //
  // Leaving: remember the read cursor. Messages that land while we are away
  // stay unread (computeMarkReadTs is focus-gated) but nothing recorded WHERE
  // the boundary was, so on return the whole burst was marked read in one tick
  // and vanished without ever being marked.
  //
  // Returning: plant the divider at that boundary BEFORE marking read, so the
  // user gets the marker they came back for. It is a surgical delete+insert
  // rather than a rebuild — a replace here would re-measure every row and lurch
  // the viewport. The list is then marked read, which is correct: the user is
  // now looking at it, and the divider stays put as the visual record.
  //
  // The replant carries a FRESH id so React mounts a new node instead of moving
  // the old one; without that the marker keeps the height of whatever message
  // used to sit at its new index, leaving a gap beneath it. See
  // freshUnreadDivider.
  //
  // This effect re-runs on nearly every render (maybeMarkRead closes over an
  // inline onMarkRead), so all the edge work is guarded by prevFocusedRef.
  useEffect(() => {
    const wasFocused = prevFocusedRef.current;
    prevFocusedRef.current = windowFocused;

    if (wasFocused && !windowFocused) {
      blurCursorRef.current = lastMarkedReadRef.current;
      return;
    }

    if (!wasFocused && windowFocused) {
      const cursor = blurCursorRef.current;
      blurCursorRef.current = null;
      const ref = listRef.current;
      if (cursor !== null && ref) {
        const idx = computeDividerInsertIdx(ref.data.get(), cursor);
        if (idx >= 0) {
          ref.data.batch(() => {
            ref.data.findAndDelete((i) => i.kind === 'divider');
            ref.data.insert([freshUnreadDivider()], idx);
          });
        }
      }
    }

    if (windowFocused) maybeMarkRead();
  }, [windowFocused, maybeMarkRead]);

  const handleContextMenu = (m: Message, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ message: m, x: e.clientX, y: e.clientY });
  };

  const context: RowContext = {
    ownerPk: owner?.publicKeyHex,
    contactByPk,
    style,
    selectedId,
    flashId,
    onSelect,
    onReply,
    onReact,
    onBlock: setBlockPrefill,
    onMacro,
    onResend,
    onContextMenu: handleContextMenu,
    contextMenuOpen: menu != null,
    client,
  };

  if (visibleMessages.length === 0 && !initialItemsRef.current?.length) {
    return <EmptyState />;
  }

  return (
    <div className="relative h-full">
      <VirtuosoMessageListLicense licenseKey={VIRTUOSO_LICENSE_KEY}>
        <VirtuosoMessageList<Item, RowContext>
          ref={listRef}
          style={{ height: '100%' }}
          context={context}
          initialData={initialItemsRef.current ?? undefined}
          initialLocation={initialLocationRef.current ?? undefined}
          computeItemKey={({ data, index }) =>
            // Defensive: Virtuoso has been observed to call this with `data`
            // undefined for a transient render window slot during replace.
            // Falling back to index keeps React from crashing the whole pane.
            data ? (data.kind === 'msg' ? data.m.id : data.id) : `__pending-${index}__`
          }
          ItemContent={ItemRow}
          EmptyPlaceholder={EmptyState}
          onRenderedDataChange={handleRenderedDataChange}
          // When the conversation is shorter than the viewport, keep messages
          // pinned to the bottom but animate the shift as a new message lands
          // instead of snapping it into place.
          shortSizeAlign="bottom-smooth"
        />
      </VirtuosoMessageListLicense>
      {menu &&
        (() => {
          const sender = menu.message.fromPublicKeyHex ? contactByPk.get(menu.message.fromPublicKeyHex) : undefined;
          const senderName = sender?.name ?? deriveSenderName(menu.message.fromPublicKeyHex);
          return (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={buildMessageMenuItems({
                message: menu.message,
                isSelf: menu.message.fromPublicKeyHex === undefined,
                onResend,
                onViewContact: (key) => setActiveKey(key),
                onBlock: setBlockPrefill,
                onDelete: (m) => {
                  setMenu(null);
                  useStore.getState().setPendingDeleteMessageId(m.id);
                },
                senderName,
              })}
              onClose={() => setMenu(null)}
            />
          );
        })()}
      {blockPrefill && (
        <BlockSenderDialog client={client} open prefill={blockPrefill} onClose={() => setBlockPrefill(null)} />
      )}
    </div>
  );
}
