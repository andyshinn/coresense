import type { Message, MessageStyle } from '../../shared/types';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { MessageItem } from './MessageItem';

interface Props {
  message: Message;
  isSelf: boolean;
  selected: boolean;
  /** Briefly applies a pulsing background to mark a search-jump landing. */
  flash?: boolean;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  style: MessageStyle;
  /** Caller-resolved sender display name ('' for self / unknown). */
  senderName: string;
  client: ApiClient | null;
  onReply?: (name: string) => void;
  onReact?: (name: string, emoji: string) => void;
  onMacro?: (name: string, text: string) => void;
}

/**
 * Conversation-list row: a thin, interactive adapter over the shared
 * {@link MessageItem}. It only adds the one piece of store state the
 * presentational component needs (the clock format); everything else is
 * forwarded from the MessageList row context.
 */
export function MessageRow({
  message,
  isSelf,
  selected,
  flash,
  onSelect,
  onContextMenu,
  style,
  senderName,
  client,
  onReply,
  onReact,
  onMacro,
}: Props) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  return (
    <MessageItem
      message={message}
      isSelf={isSelf}
      style={style}
      senderName={senderName}
      timeFormat={timeFormat}
      selected={selected}
      flash={flash}
      client={client}
      onSelect={onSelect}
      onContextMenu={onContextMenu}
      onReply={onReply}
      onReact={onReact}
      onMacro={onMacro}
    />
  );
}
