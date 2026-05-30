import { AlertCircle, Check, Clock, Reply, Send } from 'lucide-react';
import type { Contact, Message, MessageStyle } from '../../shared/types';
import { useStore } from '../lib/store';
import { fmtDateTime, fmtTime } from '../lib/time';
import { cn, deriveSenderName } from '../lib/utils';
import { ContactAvatar } from './ContactAvatar';
import { MessageBody } from './MessageBody';
import { RssiChip } from './RssiChip';
import { SenderLabel } from './SenderLabel';

interface Props {
  message: Message;
  isSelf: boolean;
  selected: boolean;
  /** Briefly applies a pulsing background to mark a search-jump landing. */
  flash?: boolean;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  style: MessageStyle;
  sender: Contact | null;
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

export function MessageRow({
  message,
  isSelf,
  selected,
  flash,
  onSelect,
  onContextMenu,
  style,
  sender,
  onReply,
}: Props) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const senderName = sender?.name ?? deriveSenderName(message.fromPublicKeyHex);
  const showSenderHeader = style === 'rich' && !isSelf && senderName !== '';
  // Reply-by-mention only makes sense when there's an addressable name and
  // the message isn't from us. We allow it whether or not the avatar header
  // is rendered (compact style hides the avatar, but the action is still
  // useful) — placement differs by style below.
  const canReply = !isSelf && senderName !== '' && onReply != null;

  return (
    <div
      data-testid="message-row"
      className="group px-3 py-0.5"
      data-flash={flash ? 'true' : undefined}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: cannot be a <button> because MentionPill renders a nested button */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'flex w-full cursor-pointer gap-2 rounded-md border px-2 py-1 text-left transition-colors',
          selected
            ? 'border-cs-accent bg-cs-accent-soft/15'
            : 'border-transparent hover:border-cs-border hover:bg-cs-bg-2',
        )}
      >
        {showSenderHeader && (
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
          {showSenderHeader && <SenderLabel name={senderName} />}
          <div
            className={cn(
              'max-w-full rounded-md px-2.5 py-1 text-sm whitespace-pre-wrap wrap-break-word',
              isSelf ? 'bg-cs-accent-soft/40 text-cs-text' : 'bg-cs-bg-3 text-cs-text',
            )}
          >
            <MessageBody body={message.body} />
          </div>
          <div className="flex flex-row items-center gap-2 font-mono text-[10px] text-cs-text-dim">
            <span title={fmtDateTime(message.ts, timeFormat)}>
              {fmtTime(message.ts, timeFormat)}
            </span>
            <StateChip message={message} />
            {message.meta?.rssi != null && (
              <RssiChip rssi={message.meta.rssi} hops={message.meta.hops} />
            )}
          </div>
        </div>
      </div>
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
