import { AlertCircle, Check, Clock, Send } from 'lucide-react';
import type { Message, MessageStyle, TimeFormatPref } from '../../shared/types';
import { MessageQuickBar } from '../features/message-actions/MessageQuickBar';
import type { ApiClient } from '../lib/api';
import { firstPathStats, formatPathStats, type PathStats } from '../lib/messagePath';
import { fmtDateTime, fmtMessageTime } from '../lib/time';
import { cn } from '../lib/utils';
import { ColoredUsername } from './ColoredUsername';
import { ContactAvatar } from './ContactAvatar';
import { MessageBody } from './MessageBody';
import { PathHashBadge } from './PathHashBadge';
import { RssiChip } from './RssiChip';

export interface MessageItemProps {
  message: Message;
  isSelf: boolean;
  /** Density — the caller decides which setting feeds this (conversation vs Unreads). */
  style: MessageStyle;
  /** Caller-resolved display name; '' ⇒ no sender shown (self / unknown). */
  senderName: string;
  timeFormat: TimeFormatPref;
  // Interactivity — all optional. Absent (no onSelect) ⇒ static, non-button
  // container, used by the Unreads triage previews.
  selected?: boolean;
  /** Briefly applies a pulsing background to mark a search-jump landing. */
  flash?: boolean;
  onSelect?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onReply?: (name: string) => void;
  onReact?: (name: string, emoji: string) => void;
  /** Needed by the quick bar's macro affordances; absent ⇒ no macro cluster. */
  client?: ApiClient | null;
  onMacro?: (name: string, text: string) => void;
}

const STATE_LABEL: Record<Message['state'], string> = {
  sending: 'sending…',
  sent: '',
  heard: '',
  ack: 'ack',
  failed: 'failed',
  received: '',
};

/**
 * The single, density-driven message presentation shared by the channel/DM
 * conversation list (via MessageRow) and the Unreads triage previews. Rich
 * shows avatar + sender header + bubble + meta; compact is one inline line with
 * the sender in front. Both densities show hop count + path-hash mode (from the
 * first path seen) next to the timestamp. Interactivity is opt-in: callers that
 * pass `onSelect` get a clickable, selectable row; Unreads passes none and gets
 * a static container.
 */
export function MessageItem({
  message,
  isSelf,
  style,
  senderName,
  timeFormat,
  selected = false,
  flash,
  onSelect,
  onContextMenu,
  onReply,
  onReact,
  client,
  onMacro,
}: MessageItemProps) {
  const interactive = onSelect != null;
  const showSenderHeaderRich = style === 'rich' && !isSelf && senderName !== '';
  const showSenderInlineCompact = style === 'compact' && !isSelf && senderName !== '';
  const stats = firstPathStats(message);

  const boxClass = cn(
    'w-full rounded-md border px-2 py-1 text-left transition-colors',
    style === 'compact' ? 'flex items-baseline gap-2' : 'flex gap-2',
    interactive
      ? selected
        ? 'cursor-pointer border-cs-accent bg-cs-accent-soft/15'
        : // Highlight follows group-hover (not the box's own :hover) so it
          // persists while the cursor is over the overhanging quick-action bar,
          // which is a descendant of the .group wrapper but sits outside the box.
          'cursor-pointer border-transparent group-hover:border-cs-border group-hover:bg-cs-bg-2'
      : 'border-transparent',
  );

  const content =
    style === 'compact' ? (
      <>
        <span
          title={fmtDateTime(message.ts, timeFormat)}
          className="shrink-0 font-mono text-[10px] text-cs-text-dim tabular-nums"
        >
          {fmtMessageTime(message.ts, timeFormat)}
        </span>
        {showSenderInlineCompact && (
          <span className="shrink-0">
            <ColoredUsername name={senderName} />
          </span>
        )}
        <span className="min-w-0 flex-1 text-sm leading-snug text-cs-text whitespace-pre-wrap wrap-break-word">
          <MessageBody body={message.body} />
        </span>
        <TrailingMeta message={message} stats={stats} />
      </>
    ) : (
      <>
        {showSenderHeaderRich && (
          <div className="flex flex-col items-center gap-1">
            <ContactAvatar name={senderName} size="sm" className="mt-0.5" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          {showSenderHeaderRich && <ColoredUsername name={senderName} />}
          <div
            className={cn(
              'max-w-full rounded-md px-2.5 py-1 text-sm whitespace-pre-wrap wrap-break-word',
              isSelf ? 'bg-cs-accent-soft/40 text-cs-text' : 'bg-cs-bg-3 text-cs-text',
            )}
          >
            <MessageBody body={message.body} />
          </div>
          <div className="flex flex-row items-center gap-2 font-mono text-[10px] text-cs-text-dim">
            <span title={fmtDateTime(message.ts, timeFormat)}>{fmtMessageTime(message.ts, timeFormat)}</span>
            <StateChip message={message} />
            <PathStatsMeta stats={stats} />
            {message.meta?.rssi != null && <RssiChip rssi={message.meta.rssi} showHops={false} />}
          </div>
        </div>
      </>
    );

  return (
    <div
      data-testid={interactive ? 'message-row' : undefined}
      className="group relative px-3 py-0.5"
      data-flash={flash ? 'true' : undefined}
    >
      {interactive && onReact && (
        <MessageQuickBar
          message={message}
          isSelf={isSelf}
          senderName={senderName}
          client={client ?? null}
          onReact={onReact}
          onReply={(name) => onReply?.(name)}
          onMacro={onMacro}
        />
      )}
      {interactive ? (
        // biome-ignore lint/a11y/useSemanticElements: cannot be a <button> because MentionPill renders a nested button
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onContextMenu={onContextMenu}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect?.();
            }
          }}
          className={boxClass}
        >
          {content}
        </div>
      ) : (
        <div className={boxClass}>{content}</div>
      )}
    </div>
  );
}

/** Trailing meta for the compact one-line layout: state + path stats (the
 *  timestamp leads the line, so it isn't repeated here). Renders nothing when
 *  there's neither a non-received state nor path data. */
function TrailingMeta({ message, stats }: { message: Message; stats: PathStats }) {
  const hasPath = stats.hops != null || stats.hashMode != null;
  if (message.state === 'received' && !hasPath) return null;
  return (
    <div className="flex shrink-0 flex-row items-center gap-2 font-mono text-[10px] text-cs-text-dim">
      <StateChip message={message} />
      <PathStatsMeta stats={stats} />
    </div>
  );
}

/** Hop count as text plus the path-hash mode as a badge. Renders nothing when
 *  neither hops nor mode is known. */
function PathStatsMeta({ stats }: { stats: PathStats }) {
  const hopsLabel = formatPathStats(stats);
  if (!hopsLabel && stats.hashMode == null) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {hopsLabel && <span className="tabular-nums">{hopsLabel}</span>}
      {stats.hashMode != null && <PathHashBadge bytes={stats.hashMode} />}
    </span>
  );
}

function StateChip({ message }: { message: Message }) {
  const state = message.state;
  if (state === 'received') return null;
  // Once we've heard ≥1 relay, the green ✓×N counter replaces the envelope.
  const heardCount = state === 'heard' ? (message.meta?.paths?.length ?? 0) : 0;
  const showHeardCounter = heardCount > 0;
  const Icon = showHeardCounter
    ? null
    : state === 'sending'
      ? Clock
      : state === 'sent' || state === 'heard'
        ? Send
        : state === 'ack'
          ? Check
          : AlertCircle;
  const label = STATE_LABEL[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        state === 'failed' && 'text-cs-danger',
        state === 'ack' && 'text-cs-online',
      )}
    >
      {Icon && <Icon size={10} aria-hidden="true" />}
      {label && <span>{label}</span>}
      {showHeardCounter && (
        <span
          className="inline-flex items-center gap-0.5 text-cs-online"
          title={`Heard by ${heardCount} repeater${heardCount === 1 ? '' : 's'}`}
        >
          <Check size={10} aria-hidden="true" />×{heardCount}
        </span>
      )}
    </span>
  );
}
