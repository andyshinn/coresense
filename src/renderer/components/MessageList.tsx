import {
  type ItemContent,
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  type VirtuosoMessageListMethods,
} from '@virtuoso.dev/message-list';
import { Copy, RotateCw, ShieldOff, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Contact, Message, MessageStyle, Owner } from '../../shared/types';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { deriveSenderName } from '../lib/utils';
import { BlockSenderDialog, type BlockSenderDialogPrefill } from './BlockSenderDialog';
import { ContextMenu, type ContextMenuEntry, copyToClipboard, menuItem, menuSeparator } from './ContextMenu';
import { MessageRow } from './MessageRow';

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
  client: ApiClient | null;
  /** When set, scroll the row whose message.id matches into view and apply a
   *  brief highlight, then call onJumpConsumed so the parent clears state. */
  jumpToId?: string | null;
  onJumpConsumed?: () => void;
}

type DividerItem = { kind: 'divider'; id: '__unread__' };
type MessageItem = { kind: 'msg'; m: Message };
type Item = DividerItem | MessageItem;

interface RowContext {
  ownerPk: string | undefined;
  contactByPk: Map<string, Contact>;
  style: MessageStyle;
  selectedId: string | null;
  flashId: string | null;
  onSelect: (id: string) => void;
  onReply?: (name: string) => void;
  onContextMenu: (m: Message, e: React.MouseEvent) => void;
}

interface MessageMenuState {
  message: Message;
  x: number;
  y: number;
}

const LICENSE_KEY = (import.meta.env.VITE_VIRTUOSO_LICENSE_KEY as string | undefined) ?? '';

function computeFirstUnreadIdx(messages: Message[], cutoff: number): number {
  if (!cutoff) return -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].ts > cutoff && messages[i].fromPublicKeyHex !== undefined) return i;
  }
  return -1;
}

function buildItems(messages: Message[], firstUnreadIdx: number): Item[] {
  if (firstUnreadIdx < 0) return messages.map((m) => ({ kind: 'msg', m }));
  const items: Item[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === firstUnreadIdx) items.push({ kind: 'divider', id: '__unread__' });
    items.push({ kind: 'msg', m: messages[i] });
  }
  return items;
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
  if (data.kind === 'divider') return <UnreadDivider />;
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
  client,
  jumpToId,
  onJumpConsumed,
}: Props) {
  const setActiveKey = useStore((s) => s.setActiveKey);
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
      const appended = visibleMessages.slice(prev.length).map<Item>((m) => ({ kind: 'msg', m }));
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
      const prepended = visibleMessages
        .slice(0, visibleMessages.length - prev.length)
        .map<Item>((m) => ({ kind: 'msg', m }));
      ref.data.prepend(prepended);
      return;
    }

    // Same length + same id ordering — likely a state-only update.
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

  // Mark-read driven by what's actually on screen. Walk the rendered items,
  // take the max message ts, and report it if it advances the cursor. This
  // covers initial render (no scroll event), incremental scroll-through-unread,
  // and new arrivals while pinned to the bottom — all without depending on
  // at-bottom edge transitions.
  const handleRenderedDataChange = (range: Item[]) => {
    let maxTs = 0;
    for (const it of range) {
      if (it.kind === 'msg' && it.m.ts > maxTs) maxTs = it.m.ts;
    }
    if (maxTs > lastMarkedReadRef.current) {
      lastMarkedReadRef.current = maxTs;
      onMarkRead(maxTs);
    }
  };

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
    onContextMenu: handleContextMenu,
  };

  if (visibleMessages.length === 0 && !initialItemsRef.current?.length) {
    return <EmptyState />;
  }

  return (
    <div className="relative h-full">
      <VirtuosoMessageListLicense licenseKey={LICENSE_KEY}>
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
            data ? (data.kind === 'msg' ? data.m.id : '__unread__') : `__pending-${index}__`
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

function UnreadDivider() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-cs-accent">
      <span className="h-px flex-1 bg-cs-accent/40" />
      <span>New</span>
      <span className="h-px flex-1 bg-cs-accent/40" />
    </div>
  );
}
