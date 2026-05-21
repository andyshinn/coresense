import { ArrowRight, Check, Inbox } from 'lucide-react';
import { useState } from 'react';
import type { ChannelKind, ContactKind } from '../../shared/types';
import { RelativeTime } from '../components/RelativeTime';
import { type UnreadConversation, useUnreadConversations } from '../hooks/useUnreads';
import type { ApiClient } from '../lib/api';
import { CHANNEL_ICON, CONTACT_ICON } from '../lib/conversationIcons';
import { useStore } from '../lib/store';
import { fmtDateTime, fmtTime } from '../lib/time';
import { cn, deriveSenderName } from '../lib/utils';

type Filter = 'all' | 'channels' | 'direct';

// How many message previews to render per card before collapsing the rest
// behind an "+ N earlier" line — keeps very chatty conversations bounded.
const PREVIEW_LIMIT = 5;

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
          Triage everything you missed in one place · newest first · marking does not send anything
          over the air
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
  const preview = conversation.messages.slice(-PREVIEW_LIMIT);
  const hiddenCount = conversation.messages.length - preview.length;

  return (
    <div className="rounded-md border border-cs-border bg-cs-bg-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-cs-border px-3 py-2">
        <Icon className="size-3.5 text-cs-accent" aria-hidden="true" />
        <span className="text-sm font-semibold text-cs-text">{conversation.name}</span>
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
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1 rounded-md bg-cs-accent px-2.5 py-1 text-xs font-semibold text-cs-bg transition-colors hover:bg-cs-accent/90"
          >
            Open
            <ArrowRight className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="py-1">
        {hiddenCount > 0 && (
          <div className="px-3 py-1 font-mono text-[10px] text-cs-text-dim">
            + {hiddenCount} earlier unread message{hiddenCount === 1 ? '' : 's'}
          </div>
        )}
        {preview.map((m) => (
          <div key={m.id} className="grid grid-cols-[auto_1fr] gap-3 px-3 py-1">
            <span
              title={fmtDateTime(m.ts, timeFormat)}
              className="pt-0.5 font-mono text-[10px] text-cs-text-dim tabular-nums"
            >
              {fmtTime(m.ts, timeFormat)}
            </span>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-cs-text">
                {previewSender(conversation, m.fromPublicKeyHex)}
              </span>
              <p className="text-sm leading-snug text-cs-text wrap-break-word">{m.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
