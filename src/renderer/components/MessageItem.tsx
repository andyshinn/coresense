import { AlertCircle, Check, Clock, Reply, Send } from 'lucide-react';
import type { Message, MessageStyle, TimeFormatPref } from '../../shared/types';
import { firstPathStats, formatPathStats } from '../lib/messagePath';
import { fmtDateTime, fmtTime } from '../lib/time';
import { cn } from '../lib/utils';
import { ContactAvatar } from './ContactAvatar';
import { MessageBody } from './MessageBody';
import { RssiChip } from './RssiChip';
import { SenderLabel } from './SenderLabel';

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
}: MessageItemProps) {
  const interactive = onSelect != null;
  const showSenderHeaderRich = style === 'rich' && !isSelf && senderName !== '';
  const showSenderInlineCompact = style === 'compact' && !isSelf && senderName !== '';
  // Reply-by-mention only makes sense when there's an addressable name, the
  // message isn't from us, and the caller wired a reply handler (Unreads doesn't).
  const canReply = !isSelf && senderName !== '' && onReply != null;
  const pathLabel = formatPathStats(firstPathStats(message));

  const boxClass = cn(
    'w-full rounded-md border px-2 py-1 text-left transition-colors',
    style === 'compact' ? 'flex items-baseline gap-2' : 'flex gap-2',
    interactive
      ? selected
        ? 'cursor-pointer border-cs-accent bg-cs-accent-soft/15'
        : 'cursor-pointer border-transparent hover:border-cs-border hover:bg-cs-bg-2'
      : 'border-transparent',
  );

  const content =
    style === 'compact' ? (
      <>
        <span
          title={fmtDateTime(message.ts, timeFormat)}
          className="shrink-0 font-mono text-[10px] text-cs-text-dim tabular-nums"
        >
          {fmtTime(message.ts, timeFormat)}
        </span>
        {showSenderInlineCompact && (
          <span className="shrink-0">
            <SenderLabel name={senderName} />
          </span>
        )}
        <span className="min-w-0 flex-1 text-sm leading-snug text-cs-text whitespace-pre-wrap wrap-break-word">
          <MessageBody body={message.body} />
        </span>
        <TrailingMeta message={message} pathLabel={pathLabel} />
      </>
    ) : (
      <>
        {showSenderHeaderRich && (
          <div className="flex flex-col items-center gap-1">
            <ContactAvatar name={senderName} size="sm" className="mt-0.5" />
            {canReply && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReply?.(senderName);
                }}
                aria-label={`Reply to ${senderName}`}
                title={`Reply to ${senderName}`}
                className="flex h-5 w-5 items-center justify-center rounded text-cs-text-dim opacity-0 transition-opacity hover:bg-cs-bg-3 hover:text-cs-text group-hover:opacity-100 focus:opacity-100"
              >
                <Reply size={11} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          {showSenderHeaderRich && <SenderLabel name={senderName} />}
          <div
            className={cn(
              'max-w-full rounded-md px-2.5 py-1 text-sm whitespace-pre-wrap wrap-break-word',
              isSelf ? 'bg-cs-accent-soft/40 text-cs-text' : 'bg-cs-bg-3 text-cs-text',
            )}
          >
            <MessageBody body={message.body} />
          </div>
          <div className="flex flex-row items-center gap-2 font-mono text-[10px] text-cs-text-dim">
            <span title={fmtDateTime(message.ts, timeFormat)}>{fmtTime(message.ts, timeFormat)}</span>
            <StateChip message={message} />
            {pathLabel && <span className="tabular-nums">{pathLabel}</span>}
            {message.meta?.rssi != null && <RssiChip rssi={message.meta.rssi} showHops={false} />}
          </div>
        </div>
      </>
    );

  return (
    <div
      data-testid={interactive ? 'message-row' : undefined}
      className="group px-3 py-0.5"
      data-flash={flash ? 'true' : undefined}
    >
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
function TrailingMeta({ message, pathLabel }: { message: Message; pathLabel: string }) {
  if (message.state === 'received' && !pathLabel) return null;
  return (
    <div className="flex shrink-0 flex-row items-center gap-2 font-mono text-[10px] text-cs-text-dim">
      <StateChip message={message} />
      {pathLabel && <span className="tabular-nums">{pathLabel}</span>}
    </div>
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
