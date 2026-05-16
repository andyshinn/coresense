import { AlertCircle, Check, CheckCheck, Clock, Reply } from 'lucide-react';
import type { Contact, Message, MessageStyle } from '../../shared/types';
import { getNameColor } from '../lib/contactColor';
import { parseMentions } from '../lib/mentionParser';
import { cn } from '../lib/utils';
import { ContactAvatar } from './ContactAvatar';
import { MentionPill } from './MentionPill';
import { RssiChip } from './RssiChip';

interface Props {
  message: Message;
  isSelf: boolean;
  selected: boolean;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  style: MessageStyle;
  sender: Contact | null;
  onReply?: (name: string) => void;
}

const STATE_LABEL: Record<Message['state'], string> = {
  sending: 'sending…',
  sent: 'sent',
  ack: 'ack',
  failed: 'failed',
  received: '',
};

export function MessageRow({
  message,
  isSelf,
  selected,
  onSelect,
  onContextMenu,
  style,
  sender,
  onReply,
}: Props) {
  const senderName = sender?.name ?? deriveSenderName(message.fromPublicKeyHex);
  const showSenderHeader = style === 'rich' && !isSelf && senderName !== '';
  // Reply-by-mention only makes sense when there's an addressable name and
  // the message isn't from us. We allow it whether or not the avatar header
  // is rendered (compact style hides the avatar, but the action is still
  // useful) — placement differs by style below.
  const canReply = !isSelf && senderName !== '' && onReply != null;

  return (
    <div className="group px-3 py-0.5">
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
            <span>{fmtTime(message.ts)}</span>
            <StateChip state={message.state} />
            {message.meta?.rssi != null && (
              <RssiChip rssi={message.meta.rssi} hops={message.meta.hops} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SenderLabel({ name }: { name: string }) {
  const { fg } = getNameColor(name);
  return (
    <span className="text-xs font-medium leading-tight" style={{ color: fg }}>
      {name}
    </span>
  );
}

function MessageBody({ body }: { body: string }) {
  const parts = parseMentions(body);
  if (parts.length === 1 && parts[0].type === 'text') return <>{body}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional within an immutable body
          <span key={i}>{part.value}</span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional within an immutable body
          <MentionPill key={i} name={part.name} />
        ),
      )}
    </>
  );
}

function StateChip({ state }: { state: Message['state'] }) {
  if (state === 'received') return null;
  const Icon =
    state === 'sending'
      ? Clock
      : state === 'sent'
        ? Check
        : state === 'ack'
          ? CheckCheck
          : AlertCircle;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        state === 'failed' && 'text-cs-danger',
        state === 'ack' && 'text-cs-online',
      )}
    >
      <Icon size={10} aria-hidden="true" />
      <span>{STATE_LABEL[state]}</span>
    </span>
  );
}

// Channel messages carry no public key; the protocol layer encodes the
// originating node's display name as `fromPublicKeyHex = "name:<name>"`.
// Strip that prefix here so the rich-style header shows the bare name.
function deriveSenderName(fromPublicKeyHex: string | undefined): string {
  if (!fromPublicKeyHex) return '';
  if (fromPublicKeyHex === 'unknown') return '';
  if (fromPublicKeyHex.startsWith('name:')) return fromPublicKeyHex.slice(5);
  return `${fromPublicKeyHex.slice(0, 8)}…`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}
