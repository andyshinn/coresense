import type { Message, MessageStyle } from '../../shared/types';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import type { BlockSenderDialogPrefill } from './BlockSenderDialog';
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
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  /** True while the list's right-click menu is open — suppresses the quick bar. */
  contextMenuOpen?: boolean;
  onMacro?: (name: string, text: string) => void;
  /** Retry a failed send. Optional: its absence is what hides "Re-send". */
  onResend?: (m: Message) => void;
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
  onBlock,
  contextMenuOpen,
  onMacro,
  onResend,
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
      onBlock={onBlock}
      contextMenuOpen={contextMenuOpen}
      onMacro={onMacro}
      onResend={onResend}
    />
  );
}
