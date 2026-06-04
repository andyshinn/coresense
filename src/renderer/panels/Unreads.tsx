import { Check, ChevronDown, ChevronUp, Inbox } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChannelKind, ContactKind } from '../../shared/types';
import { MessageItem } from '../components/MessageItem';
import { RelativeTime } from '../components/RelativeTime';
import { type UnreadConversation, useUnreadConversations } from '../hooks/useUnreads';
import type { ApiClient } from '../lib/api';
import { CHANNEL_ICON, CONTACT_ICON } from '../lib/conversationIcons';
import { useStore } from '../lib/store';
import { cn, deriveSenderName } from '../lib/utils';

type Filter = 'all' | 'channels' | 'direct';

const CHANNEL_KIND_LABEL: Record<ChannelKind, string> = {
  public: 'public channel',
  hashtag: 'hashtag channel',
  private: 'private channel',
};

const CONTACT_KIND_LABEL: Record<ContactKind, string> = {
  chat: 'direct message',
  room: 'room server',
  repeater: 'repeater',
  sensor: 'sensor',
};

// The Unreads panel aggregates every conversation with unread messages into a
// single triage list. Marking is immediate and permanent — `markAllRead`
// advances the per-conversation last-read marker, so a marked card simply drops
// off the reactively-computed list. `client` is unused (marking is store-only)
// but kept for the panel-prop contract.
export function Unreads({ client: _client }: { client: ApiClient | null }) {
  const conversations = useUnreadConversations();
  const markAllRead = useStore((s) => s.markAllRead);
  const markAllReadGlobal = useStore((s) => s.markAllReadGlobal);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const [filter, setFilter] = useState<Filter>('all');

  const channelsAll = conversations.filter((c) => c.kind === 'channel');
  const directAll = conversations.filter((c) => c.kind === 'contact');
  const filtered =
    filter === 'channels' ? channelsAll : filter === 'direct' ? directAll : conversations;

  // Esc (while viewing Unreads) clears the topmost card shown on the page —
  // press repeatedly to triage from the top down. Shift+Esc (clear all) is a
  // global shortcut handled in App; bail here so the two don't collide. The
  // ref tracks the current top so the listener registers once. This effect
  // only runs while the Unreads panel is mounted, so the shortcut is naturally
  // scoped to "looking at unreads".
  const topmostKeyRef = useRef<string | null>(null);
  topmostKeyRef.current = filtered[0]?.key ?? null;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.shiftKey) return;
      // Defer to anything that owns Esc for dismissal (command palette, the
      // add-channel popover, the keyboard-shortcuts help overlay) so we don't
      // clear a card out from under it.
      const s = useStore.getState();
      if (s.paletteOpen || s.addChannelOpen || s.helpOpen) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      const key = topmostKeyRef.current;
      if (!key) return;
      e.preventDefault();
      markAllRead(key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [markAllRead]);

  const totalCount = conversations.reduce((s, c) => s + c.count, 0);
  const filteredCount = filtered.reduce((s, c) => s + c.count, 0);

  const handleMarkAll = () => {
    if (filter === 'all') {
      markAllReadGlobal();
      return;
    }
    for (const c of filtered) markAllRead(c.key);
  };

  const markAllLabel =
    filter === 'all'
      ? 'Mark all read'
      : filter === 'channels'
        ? 'Mark channels read'
        : 'Mark direct read';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-cs-border bg-cs-bg-2 px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-cs-text">Unreads</h1>
          <span className="rounded-full border border-cs-accent/40 bg-cs-accent-soft/20 px-2 py-px font-mono text-[10px] text-cs-text tabular-nums">
            {totalCount} new
          </span>
          <span className="font-mono text-[10px] text-cs-text-dim">
            across {conversations.length} conversation{conversations.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={filteredCount === 0}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-3 px-3 py-1.5 text-xs text-cs-text-muted transition-colors hover:bg-cs-bg-2 hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="size-3.5" aria-hidden="true" />
            {markAllLabel}
          </button>
        </div>
        <p className="mt-1 font-mono text-[10px] text-cs-text-dim">
          Triage everything you missed · newest first · Esc clears the top card · ⇧Esc clears all ·
          nothing is sent over the air
        </p>
        <div className="mt-3 flex items-center gap-1 text-xs">
          <FilterTab
            label="All"
            count={conversations.length}
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          <FilterTab
            label="Channels"
            count={channelsAll.length}
            active={filter === 'channels'}
            onClick={() => setFilter('channels')}
          />
          <FilterTab
            label="Direct & Rooms"
            count={directAll.length}
            active={filter === 'direct'}
            onClick={() => setFilter('direct')}
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <Inbox className="size-6 text-cs-text-dim" aria-hidden="true" />
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-cs-text-muted">
              Nothing here
            </h2>
            <p className="text-sm text-cs-text-dim">
              {conversations.length === 0
                ? 'You are all caught up.'
                : `No unread ${filter === 'channels' ? 'channel' : 'direct'} messages.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {filtered.map((c) => (
              <UnreadCard
                key={c.key}
                conversation={c}
                onMarkRead={() => markAllRead(c.key)}
                onOpen={() => setActiveKey(c.key)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-2 py-1 transition-colors',
        active
          ? 'border-cs-accent text-cs-text'
          : 'border-transparent text-cs-text-muted hover:text-cs-text',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-px font-mono text-[9px] tabular-nums',
          active ? 'bg-cs-accent-soft/30 text-cs-text' : 'bg-cs-bg-3 text-cs-text-dim',
        )}
      >
        {count}
      </span>
    </button>
  );
}

// Channels and rooms carry a per-message sender name (encoded as a `name:`
// prefix); 1:1 conversations don't — every received message is from the peer.
function previewSender(
  conversation: UnreadConversation,
  fromPublicKeyHex: string | undefined,
): string {
  if (conversation.kind === 'channel' || conversation.contactKind === 'room') {
    return deriveSenderName(fromPublicKeyHex) || 'unknown';
  }
  return conversation.name;
}

function UnreadCard({
  conversation,
  onMarkRead,
  onOpen,
}: {
  conversation: UnreadConversation;
  onMarkRead: () => void;
  onOpen: () => void;
}) {
  const Icon =
    conversation.kind === 'channel'
      ? CHANNEL_ICON[conversation.channelKind ?? 'hashtag']
      : CONTACT_ICON[conversation.contactKind ?? 'chat'];
  const kindLabel =
    conversation.kind === 'channel'
      ? CHANNEL_KIND_LABEL[conversation.channelKind ?? 'hashtag']
      : CONTACT_KIND_LABEL[conversation.contactKind ?? 'chat'];

  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  // Unreads has its own density, separate from the conversation list.
  const unreadsStyle = useStore((s) => s.appSettings.unreadsStyle);
  // Cap the previews per card so chatty conversations stay bounded; when the
  // cap is disabled every unread message renders in full. The cap can also be
  // lifted per-card in-session via the expand control — that state is
  // intentionally ephemeral, collapsing back on next mount.
  const previewCap = useStore((s) => s.appSettings.unreadsPreview);
  const [expanded, setExpanded] = useState(false);
  const capped = previewCap.enabled && !expanded;
  const preview = capped ? conversation.messages.slice(-previewCap.limit) : conversation.messages;
  const hiddenCount = conversation.messages.length - preview.length;
  const canExpand = previewCap.enabled && conversation.messages.length > previewCap.limit;

  return (
    <div className="rounded-md border border-cs-border bg-cs-bg-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-cs-border px-3 py-2">
        <button
          type="button"
          onClick={onOpen}
          title={`Open ${conversation.name}`}
          className="group flex items-center gap-2"
        >
          <Icon className="size-3.5 text-cs-accent" aria-hidden="true" />
          <span className="text-sm font-semibold text-cs-text group-hover:text-cs-accent group-hover:underline">
            {conversation.name}
          </span>
        </button>
        <span className="rounded-full border border-cs-accent/40 bg-cs-accent-soft/20 px-1.5 py-px font-mono text-[9px] text-cs-text tabular-nums">
          {conversation.count} new
        </span>
        <span className="font-mono text-[10px] text-cs-text-dim">
          {kindLabel} · last seen <RelativeTime ts={conversation.lastTs} />
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onMarkRead}
            className="flex items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-3 px-2.5 py-1 text-xs text-cs-text-muted transition-colors hover:bg-cs-bg-2 hover:text-cs-text"
          >
            <Check className="size-3" aria-hidden="true" />
            Mark read
          </button>
        </div>
      </div>
      <div className="py-1">
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-1.5 px-3 py-1 font-mono text-[10px] text-cs-text-dim transition-colors hover:text-cs-text"
          >
            {expanded ? (
              <ChevronUp className="size-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3" aria-hidden="true" />
            )}
            {expanded
              ? 'Show fewer'
              : `${hiddenCount} earlier unread message${hiddenCount === 1 ? '' : 's'}`}
          </button>
        )}
        {/* When messages are still hidden above, a gradient veil over the
            topmost preview row makes it read as truncated — a passive cue that
            pairs with the explicit expand control. */}
        <div className="relative">
          {hiddenCount > 0 && (
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-7 bg-linear-to-b from-cs-bg-2 to-transparent"
              aria-hidden="true"
            />
          )}
          {preview.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              isSelf={false}
              style={unreadsStyle}
              senderName={previewSender(conversation, m.fromPublicKeyHex)}
              timeFormat={timeFormat}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
