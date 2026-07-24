import {
  type ItemContent,
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  type VirtuosoMessageListMethods,
} from '@virtuoso.dev/message-list';
import { Copy, RotateCw, ShieldOff, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Contact, Message, MessageStyle, Owner } from '../../shared/types';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { fmtDate } from '../lib/time';
import { deriveSenderName } from '../lib/utils';
import { VIRTUOSO_LICENSE_KEY } from '../lib/virtuosoLicense';
import { BlockSenderDialog, type BlockSenderDialogPrefill } from './BlockSenderDialog';
import { ContextMenu, type ContextMenuEntry, copyToClipboard, menuItem, menuSeparator } from './ContextMenu';
import { MessageDivider } from './MessageDivider';
import { MessageRow } from './MessageRow';
import {
  buildAppended,
  buildItems,
  buildPrepended,
  computeFirstUnreadIdx,
  computeMarkReadTs,
  type Item,
} from './messageListItems';

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
  onMacro?: (name: string, text: string) => void;
  onContextMenu: (m: Message, e: React.MouseEvent) => void;
  client: ApiClient | null;
}

interface MessageMenuState {
  message: Message;
  x: number;
  y: number;
}

function initialLocationFor(items: Item[]) {
  const dividerIdx = items.findIndex((i) => i.kind === 'divider');
  // `start-no-overflow` pins the divider to the top of the viewport but only
  // as far as the scrollable range allows — when there aren't enough messages
  // below it to fill the view, it stops at the natural bottom instead of
  // overscrolling and leaving an empty gap under the last message.
  if (dividerIdx >= 0) return { index: dividerIdx, align: 'start-no-overflow' as const };
  return { index: 'LAST' as const, align: 'end' as const };
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

  // Reset transient state when switching conversations.
  useEffect(() => {
    if (prevKeyRef.current !== conversationKey) {
      setMenu(null);
      setFlashId(null);
      setBlockPrefill(null);
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

  // Seed the list on first mount. Subsequent renders ignore initialData /
  // initialLocation — updates go through the imperative ref.
  const initialItemsRef = useRef<Item[] | null>(null);
  const initialLocationRef = useRef<ReturnType<typeof initialLocationFor> | null>(null);
  if (!initialItemsRef.current) {
    const firstUnreadIdx = computeFirstUnreadIdx(visibleMessages, initialLastReadRef.current);
    initialItemsRef.current = buildItems(visibleMessages, firstUnreadIdx);
    initialLocationRef.current = initialLocationFor(initialItemsRef.current);
    prevMessagesRef.current = visibleMessages;
  }

  // Sync messages → list via imperative API. Picks the cheapest op that
  // matches the diff: append for tail growth, prepend for head growth,
  // map for in-place state updates, replace as the fallback.
  useEffect(() => {
    const ref = listRef.current;
    if (!ref) return;

    // Conversation switch — full reset.
    if (prevKeyRef.current !== conversationKey) {
      initialLastReadRef.current = lastReadMs;
      lastMarkedReadRef.current = lastReadMs;
      const firstUnreadIdx = computeFirstUnreadIdx(visibleMessages, lastReadMs);
      const newItems = buildItems(visibleMessages, firstUnreadIdx);
      // Don't pass purgeItemSizes: true — it forces a re-measure pass where
      // Virtuoso's render window can transiently include slots whose data is
      // still undefined, crashing computeItemKey. Replace re-measures
      // naturally as items mount.
      ref.data.replace(newItems, {
        initialLocation: initialLocationFor(newItems),
      });
      prevKeyRef.current = conversationKey;
      prevMessagesRef.current = visibleMessages;
      return;
    }

    const prev = prevMessagesRef.current;
    if (prev === visibleMessages) return;
    prevMessagesRef.current = visibleMessages;

    // Tail growth (most common: new arrivals or sent messages).
    if (
      visibleMessages.length > prev.length &&
      prev.length > 0 &&
      visibleMessages[prev.length - 1]?.id === prev[prev.length - 1]?.id
    ) {
      const appended = buildAppended(visibleMessages.slice(prev.length), prev[prev.length - 1]);
      ref.data.append(appended, ({ atBottom }) => (atBottom ? 'smooth' : false));
      return;
    }

    // First batch into an empty conversation (no prior messages).
    if (prev.length === 0 && visibleMessages.length > 0) {
      const firstUnreadIdx = computeFirstUnreadIdx(visibleMessages, initialLastReadRef.current);
      const newItems = buildItems(visibleMessages, firstUnreadIdx);
      ref.data.replace(newItems, { initialLocation: initialLocationFor(newItems) });
      return;
    }

    // Head growth (load-older pagination).
    if (
      visibleMessages.length > prev.length &&
      prev.length > 0 &&
      visibleMessages[visibleMessages.length - prev.length]?.id === prev[0]?.id
    ) {
      const olderMsgs = visibleMessages.slice(0, visibleMessages.length - prev.length);
      const prepended = buildPrepended(olderMsgs, prev[0]);
      ref.data.prepend(prepended);
      return;
    }

    // Same length + same id ordering — likely a state-only update.
    // Date/divider items are passed through untouched: this path only runs when
    // ids are unchanged and in the same order, and the update paths that reach
    // here (message state / path merges) never move a message's ts across a
    // calendar-day boundary. Any change that reorders messages fails the id
    // check above and falls to the replace fallback, which rebuilds separators.
    if (visibleMessages.length === prev.length && visibleMessages.every((m, i) => m.id === prev[i].id)) {
      const byId = new Map(visibleMessages.map((m) => [m.id, m]));
      ref.data.map((item) => {
        if (item.kind !== 'msg') return item;
        const updated = byId.get(item.m.id);
        return updated && updated !== item.m ? { kind: 'msg', m: updated } : item;
      });
      return;
    }

    // Fallback: shape diverged, replace wholesale without changing scroll.
    const firstUnreadIdx = computeFirstUnreadIdx(visibleMessages, initialLastReadRef.current);
    ref.data.replace(buildItems(visibleMessages, firstUnreadIdx));
  }, [conversationKey, visibleMessages, lastReadMs]);

  // Jump-to-message (search results). The items array shifts by 1 when the
  // unread divider is present, so resolve via the list's own findIndex.
  useEffect(() => {
    if (!jumpToId) return;
    const ref = listRef.current;
    if (!ref) return;
    const idx = ref.data.findIndex((i) => i.kind === 'msg' && i.m.id === jumpToId);
    if (idx < 0) return;
    ref.scrollToItem({ index: idx, align: 'center', behavior: 'smooth' });
    setFlashId(jumpToId);
    const t = setTimeout(() => setFlashId(null), 1600);
    onJumpConsumed?.();
    return () => clearTimeout(t);
  }, [jumpToId, onJumpConsumed]);

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

  // Regaining focus is the user actually looking at the conversation: mark read
  // whatever is on screen now, clearing notifications that were intentionally
  // left standing while the window was backgrounded.
  useEffect(() => {
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
    onMacro,
    onContextMenu: handleContextMenu,
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
                onResend,
                onViewContact: (key) => setActiveKey(key),
                onBlock: setBlockPrefill,
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

interface BuildMenuOpts {
  message: Message;
  onResend?: (m: Message) => void;
  onViewContact: (key: string) => void;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  senderName: string | undefined;
}

function buildMessageMenuItems({
  message,
  onResend,
  onViewContact,
  onBlock,
  senderName,
}: BuildMenuOpts): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [menuItem('Copy text', () => copyToClipboard(message.body), { icon: Copy })];

  const pk = message.fromPublicKeyHex;
  if (pk && pk !== 'unknown' && !pk.startsWith('name:')) {
    items.push(menuItem('View contact', () => onViewContact(`c:${pk}`), { icon: User }));
  }

  if (message.state === 'failed' && onResend) {
    items.push(menuSeparator);
    items.push(menuItem('Re-send', () => onResend(message), { icon: RotateCw }));
  }

  items.push(menuSeparator);
  const originHop = message.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
  const rawPk = message.fromPublicKeyHex;
  const hasRealPubkey = rawPk != null && rawPk !== 'unknown' && !rawPk.startsWith('name:');
  // Origin hop pk would carry an advert-resolved pubkey, but the current
  // path-build pipeline never populates it for channel messages — it's always
  // null. Treat it as the authoritative source if a future change wires it.
  const pubkey = hasRealPubkey ? rawPk : (originHop?.pk ?? undefined);
  // Prefix is the first 4 hex chars of the real pubkey. originHop.shortId
  // is a 2-char name-derived display label (NOT hex), so we don't use it as
  // a pubkey prefix — that would silently create rules like pattern='sr'
  // that match by name lookalike, which is misleading.
  const prefix = hasRealPubkey ? rawPk.slice(0, 4) : (originHop?.pk?.slice(0, 4) ?? undefined);
  items.push(
    menuItem(
      'Block sender…',
      () => {
        onBlock({
          pubkey,
          pubkeyPrefix: prefix,
          name: senderName || undefined,
        });
      },
      { icon: ShieldOff },
    ),
  );

  return items;
}
