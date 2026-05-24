import {
  type ItemContent,
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  type VirtuosoMessageListMethods,
} from '@virtuoso.dev/message-list';
import { Copy, RotateCw, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Contact, Message, MessageStyle, Owner } from '../../shared/types';
import { useStore } from '../lib/store';
import {
  ContextMenu,
  type ContextMenuEntry,
  copyToClipboard,
  menuItem,
  menuSeparator,
} from './ContextMenu';
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
  if (dividerIdx >= 0) return { index: dividerIdx, align: 'start' as const };
  return { index: 'LAST' as const, align: 'end' as const };
}

const ItemRow: ItemContent<Item, RowContext> = ({ data, context }) => {
  if (data.kind === 'divider') return <UnreadDivider />;
  const m = data.m;
  const isSelf = m.fromPublicKeyHex === undefined;
  const sender = m.fromPublicKeyHex ? (context.contactByPk.get(m.fromPublicKeyHex) ?? null) : null;
  return (
    <MessageRow
      message={m}
      isSelf={isSelf}
      selected={context.selectedId === m.id}
      flash={context.flashId === m.id}
      onSelect={() => context.onSelect(m.id)}
      onContextMenu={(e) => context.onContextMenu(m, e)}
      style={context.style}
      sender={sender}
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
  jumpToId,
  onJumpConsumed,
}: Props) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const listRef = useRef<VirtuosoMessageListMethods<Item, RowContext>>(null);
  const [menu, setMenu] = useState<MessageMenuState | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  // Frozen at conversation-open so the divider stays anchored while new
  // messages arrive — bumping the marker live would yank it from under the
  // user. Reset on key change.
  const initialLastReadRef = useRef(lastReadMs);
  // Track prior props for diffing in the data-sync effect.
  const prevKeyRef = useRef(conversationKey);
  const prevMessagesRef = useRef(messages);
  // Highest message ts we've already reported as read — guards against
  // re-firing onMarkRead for the same cursor as Virtuoso fires
  // onRenderedDataChange on every visible-range tick.
  const lastMarkedReadRef = useRef(0);

  // Reset transient state when switching conversations.
  useEffect(() => {
    if (prevKeyRef.current !== conversationKey) {
      setMenu(null);
      setFlashId(null);
    }
  }, [conversationKey]);

  const contactByPk = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.publicKeyHex, c);
    return m;
  }, [contacts]);

  // Seed the list on first mount. Subsequent renders ignore initialData /
  // initialLocation — updates go through the imperative ref.
  const initialItemsRef = useRef<Item[] | null>(null);
  const initialLocationRef = useRef<ReturnType<typeof initialLocationFor> | null>(null);
  if (!initialItemsRef.current) {
    const firstUnreadIdx = computeFirstUnreadIdx(messages, initialLastReadRef.current);
    initialItemsRef.current = buildItems(messages, firstUnreadIdx);
    initialLocationRef.current = initialLocationFor(initialItemsRef.current);
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
      const firstUnreadIdx = computeFirstUnreadIdx(messages, lastReadMs);
      const newItems = buildItems(messages, firstUnreadIdx);
      // Don't pass purgeItemSizes: true — it forces a re-measure pass where
      // Virtuoso's render window can transiently include slots whose data is
      // still undefined, crashing computeItemKey. Replace re-measures
      // naturally as items mount.
      ref.data.replace(newItems, {
        initialLocation: initialLocationFor(newItems),
      });
      prevKeyRef.current = conversationKey;
      prevMessagesRef.current = messages;
      return;
    }

    const prev = prevMessagesRef.current;
    if (prev === messages) return;
    prevMessagesRef.current = messages;

    // Tail growth (most common: new arrivals or sent messages).
    if (
      messages.length > prev.length &&
      prev.length > 0 &&
      messages[prev.length - 1]?.id === prev[prev.length - 1]?.id
    ) {
      const appended = messages.slice(prev.length).map<Item>((m) => ({ kind: 'msg', m }));
      ref.data.append(appended, ({ atBottom }) => (atBottom ? 'smooth' : false));
      return;
    }

    // First batch into an empty conversation (no prior messages).
    if (prev.length === 0 && messages.length > 0) {
      const firstUnreadIdx = computeFirstUnreadIdx(messages, initialLastReadRef.current);
      const newItems = buildItems(messages, firstUnreadIdx);
      ref.data.replace(newItems, { initialLocation: initialLocationFor(newItems) });
      return;
    }

    // Head growth (load-older pagination).
    if (
      messages.length > prev.length &&
      prev.length > 0 &&
      messages[messages.length - prev.length]?.id === prev[0]?.id
    ) {
      const prepended = messages
        .slice(0, messages.length - prev.length)
        .map<Item>((m) => ({ kind: 'msg', m }));
      ref.data.prepend(prepended);
      return;
    }

    // Same length + same id ordering — likely a state-only update.
    if (messages.length === prev.length && messages.every((m, i) => m.id === prev[i].id)) {
      const byId = new Map(messages.map((m) => [m.id, m]));
      ref.data.map((item) => {
        if (item.kind !== 'msg') return item;
        const updated = byId.get(item.m.id);
        return updated && updated !== item.m ? { kind: 'msg', m: updated } : item;
      });
      return;
    }

    // Fallback: shape diverged, replace wholesale without changing scroll.
    const firstUnreadIdx = computeFirstUnreadIdx(messages, initialLastReadRef.current);
    ref.data.replace(buildItems(messages, firstUnreadIdx));
  }, [conversationKey, messages, lastReadMs]);

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

  if (messages.length === 0 && !initialItemsRef.current?.length) {
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
          shortSizeAlign="bottom"
        />
      </VirtuosoMessageListLicense>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMessageMenuItems({
            message: menu.message,
            onResend,
            onViewContact: (key) => setActiveKey(key),
          })}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface BuildMenuOpts {
  message: Message;
  onResend?: (m: Message) => void;
  onViewContact: (key: string) => void;
}

function buildMessageMenuItems({
  message,
  onResend,
  onViewContact,
}: BuildMenuOpts): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [
    menuItem('Copy text', () => copyToClipboard(message.body), { icon: Copy }),
  ];

  const pk = message.fromPublicKeyHex;
  if (pk && pk !== 'unknown' && !pk.startsWith('name:')) {
    items.push(menuItem('View contact', () => onViewContact(`c:${pk}`), { icon: User }));
  }

  if (message.state === 'failed' && onResend) {
    items.push(menuSeparator);
    items.push(menuItem('Re-send', () => onResend(message), { icon: RotateCw }));
  }

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
