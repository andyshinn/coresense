import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, RotateCw, User } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
  /** Called when the user picks "Re-send" on a failed message. Owner panel
   *  (ChannelView / DMView / RepeaterAdmin) has the api client + key. */
  onResend?: (message: Message) => void;
  /** Called when the user clicks the reply-by-mention button under an
   *  incoming message's avatar. Owner panel inserts the mention into its
   *  composer and focuses it. */
  onReply?: (senderName: string) => void;
}

interface MessageMenuState {
  message: Message;
  x: number;
  y: number;
}

const ROW_ESTIMATE_PX: Record<MessageStyle, number> = { compact: 40, rich: 56 };
const DIVIDER_PX = 24;
// How close to the bottom (in px) still counts as "following the
// conversation" when a new message arrives. Wide enough to absorb one
// freshly-inserted row's height plus a bit of slack.
const FOLLOW_THRESHOLD_PX = 200;

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
}: Props) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const [menu, setMenu] = useState<MessageMenuState | null>(null);
  // Reset the menu when the conversation switches; otherwise the menu's
  // anchor would dangle over a different conversation's rows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only conversationKey resets the menu
  useEffect(() => {
    setMenu(null);
  }, [conversationKey]);
  const parentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  // Frozen at conversation-open so the divider stays put while new messages
  // arrive — bumping the marker live would make it jump out from under the
  // user. Reset on key change.
  const initialLastReadRef = useRef(lastReadMs);
  // Tracks whether we've performed the initial scroll for this conversation.
  const didInitialScrollRef = useRef(false);
  // Counter incremented whenever we issue a programmatic scroll. The onScroll
  // handler ignores events while this is > 0, then decrements on the next
  // frame — prevents our own scrollTop write from echoing back as "user
  // scrolled away from bottom" and flipping sticky off.
  const programmaticScrollsRef = useRef(0);

  const scrollToBottom = (markRead = true) => {
    const el = parentRef.current;
    if (!el || messages.length === 0) return;
    programmaticScrollsRef.current += 1;
    // Defer to next frame so the virtualizer has placed and measured any new
    // rows; otherwise scrollHeight reflects pre-measurement estimates and we
    // land short of the actual bottom.
    requestAnimationFrame(() => {
      const node = parentRef.current;
      if (node) node.scrollTop = node.scrollHeight;
      // A second rAF catches the case where measureElement fires a layout
      // adjustment between our write and the next paint.
      requestAnimationFrame(() => {
        const node2 = parentRef.current;
        if (node2) node2.scrollTop = node2.scrollHeight;
        programmaticScrollsRef.current = Math.max(0, programmaticScrollsRef.current - 1);
      });
    });
    if (markRead) onMarkRead(messages[messages.length - 1].ts);
  };

  const contactByPk = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.publicKeyHex, c);
    return m;
  }, [contacts]);

  const firstUnreadIndex = useMemo(() => {
    const cutoff = initialLastReadRef.current;
    if (!cutoff) return -1;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].ts > cutoff && messages[i].fromPublicKeyHex !== undefined) return i;
    }
    return -1;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE_PX[style],
    overscan: 6,
  });

  // Reset initial-scroll state when switching conversations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only resets on key change
  useEffect(() => {
    initialLastReadRef.current = lastReadMs;
    didInitialScrollRef.current = false;
    stickToBottomRef.current = true;
  }, [conversationKey]);

  // Initial placement once messages are loaded: scroll to first unread, or to
  // bottom if everything is already read. After this fires, subsequent
  // message arrivals fall through to the sticky-bottom branch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: conversationKey + messages.length are the triggers; virtualizer is stable
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (messages.length === 0) return;
    if (firstUnreadIndex >= 0) {
      // Pin the "New" divider to the top of the viewport (or as high as the
      // scrollable area allows). The first call uses estimated row sizes, so
      // the computed offset is off until measureElement fires real heights —
      // re-fire across two frames to land correctly after measurement, and
      // suppress the onScroll echo so sticky-to-bottom stays off.
      const idx = firstUnreadIndex;
      const pinTop = () => {
        programmaticScrollsRef.current += 1;
        virtualizer.scrollToIndex(idx, { align: 'start' });
        requestAnimationFrame(() => {
          programmaticScrollsRef.current = Math.max(0, programmaticScrollsRef.current - 1);
        });
      };
      pinTop();
      requestAnimationFrame(() => {
        pinTop();
        requestAnimationFrame(pinTop);
      });
      stickToBottomRef.current = false;
    } else {
      scrollToBottom();
      stickToBottomRef.current = true;
    }
    didInitialScrollRef.current = true;
  }, [conversationKey, messages.length, firstUnreadIndex]);

  // New messages while pinned to bottom — keep following, and bump the
  // read marker (the user is actively viewing). When scrolled up, do
  // nothing so the unread divider remains anchored.
  //
  // We re-measure distance-from-bottom here rather than trusting only
  // stickToBottomRef: the cached flag is updated only by user scroll
  // events, so layout shifts that move the viewport off-bottom without
  // firing onScroll (composer textarea growing, right-rail toggle, etc.)
  // would otherwise strand sticky=true with the user no longer at bottom,
  // or vice versa. FOLLOW_THRESHOLD_PX is generous enough that "close to
  // the bottom" still follows even after a newly-inserted row has expanded
  // scrollHeight by its own measured size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length is the trigger; scrollToBottom is stable
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    if (messages.length === 0) return;
    const el = parentRef.current;
    const nearBottom =
      !!el && el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
    if (stickToBottomRef.current || nearBottom) scrollToBottom();
  }, [messages.length]);

  const onScroll = () => {
    // Ignore the echo from our own programmatic scrollTop writes; otherwise
    // a mid-measurement read could see distanceFromBottom > threshold and
    // flip sticky off, silently breaking auto-follow.
    if (programmaticScrollsRef.current > 0) return;
    const el = parentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 64;
    stickToBottomRef.current = atBottom;
    if (atBottom && messages.length > 0) {
      onMarkRead(messages[messages.length - 1].ts);
    }
  };

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-cs-text-dim">
        <p>No messages yet. Send one to start the conversation.</p>
      </div>
    );
  }

  const ownerPk = owner?.publicKeyHex;
  return (
    <div ref={parentRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const m = messages[row.index];
          const isSelf = ownerPk
            ? m.fromPublicKeyHex === undefined
            : m.fromPublicKeyHex === undefined;
          const sender = m.fromPublicKeyHex ? (contactByPk.get(m.fromPublicKeyHex) ?? null) : null;
          const showDivider = row.index === firstUnreadIndex;
          return (
            <Fragment key={m.id}>
              <div
                data-index={row.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start}px)`,
                }}
              >
                {showDivider && <UnreadDivider />}
                <MessageRow
                  message={m}
                  isSelf={isSelf}
                  selected={selectedId === m.id}
                  onSelect={() => onSelect(m.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ message: m, x: e.clientX, y: e.clientY });
                  }}
                  style={style}
                  sender={sender}
                  onReply={onReply}
                />
              </div>
            </Fragment>
          );
        })}
      </div>
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

  // The fromPublicKeyHex can be undefined (self), 'unknown', 'name:NAME' (channel
  // sender without a known pubkey), a full 32B hex (DM), or a 12-char prefix
  // (synth placeholder). View contact only makes sense for the last two.
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
    <div
      className="flex items-center gap-2 px-3 text-[10px] font-medium uppercase tracking-wider text-cs-accent"
      style={{ height: `${DIVIDER_PX}px` }}
    >
      <span className="h-px flex-1 bg-cs-accent/40" />
      <span>New</span>
      <span className="h-px flex-1 bg-cs-accent/40" />
    </div>
  );
}
