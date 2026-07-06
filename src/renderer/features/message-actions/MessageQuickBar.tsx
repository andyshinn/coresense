import { Copy, Info, MoreHorizontal, Plus, Reply, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Message } from '../../../shared/types';
import { copyToClipboard } from '../../components/ContextMenu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { EmojiPickerPopover } from './EmojiPickerPopover';
import { MacroChip, MacroPanel } from './MacroPanel';
import { MessageInfoPopover } from './MessageInfoPopover';
import { OverflowMenu } from './OverflowMenu';
import { SEED_MACROS } from './quickBarData';
import { ReactionRow } from './ReactionRow';

type PopKey = 'emoji' | 'macro' | 'info' | 'more' | null;

interface Props {
  message: Message;
  isSelf: boolean;
  senderName: string;
  onReact: (name: string, emoji: string) => void;
  onReply: (name: string) => void;
}

/** Discord-style hover action pill anchored to the top-right of a message row. */
export function MessageQuickBar({ message, isSelf, senderName, onReact, onReply }: Props) {
  const [open, setOpen] = useState<PopKey>(null);
  const recordEmojiUse = useStore((s) => s.recordEmojiUse);
  const P = (key: Exclude<PopKey, null>) => ({ open: open === key, onOpenChange: (o: boolean) => setOpen(o ? key : null) });

  // An unresolved sender (e.g. a channel message whose origin name wasn't
  // decoded) yields senderName === ''. Reacting/replying would otherwise
  // insert an empty `@[] ` mention into the composer, so no-op instead.
  const hasSender = senderName !== '';
  const pick = (emoji: string) => {
    if (!hasSender) return;
    recordEmojiUse(emoji);
    onReact(senderName, emoji);
  };
  const reply = () => {
    if (!hasSender) return;
    onReply(senderName);
  };
  const copyText = () => copyToClipboard(message.body, () => notify.success('Copied message text'));

  return (
    <div
      data-open={open != null}
      className="absolute right-3 -top-3.5 z-20 flex items-center opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:opacity-100"
    >
      <div
        className="flex items-center gap-1 rounded-lg border border-cs-border-strong bg-cs-bg-3 px-1.5 py-1"
        style={{ boxShadow: '0 10px 26px rgba(0,0,0,0.5)' }}
      >
        {!isSelf ? (
          <>
            <ReactionRow onPick={pick} />
            <EmojiPickerPopover {...P('emoji')} onPick={pick}>
              <button
                type="button"
                aria-label="More emoji"
                className="flex h-6 w-6 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </EmojiPickerPopover>
            <span className="mx-1 h-6 w-px bg-cs-border" />
            <button
              type="button"
              aria-label="Reply"
              onClick={reply}
              className="flex h-7 items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-2 px-2.5 text-[12px] text-cs-text-muted hover:text-cs-text"
            >
              <Reply size={14} aria-hidden="true" /> Reply
            </button>
            <div className="flex items-center gap-1 pl-1">
              {SEED_MACROS.slice(0, 2).map((m) => (
                <MacroChip key={m.label} label={m.label} />
              ))}
              <MacroPanel {...P('macro')}>
                <button
                  type="button"
                  aria-label="All macros"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
                >
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
              </MacroPanel>
            </div>
            <span className="mx-1 h-6 w-px bg-cs-border" />
            <IconBtn label="Copy text" onClick={copyText}>
              <Copy size={16} aria-hidden="true" />
            </IconBtn>
            <OverflowMenu message={message} {...P('more')}>
              <button
                type="button"
                aria-label="More"
                className="flex h-8 w-8 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            </OverflowMenu>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label="Copy"
              onClick={copyText}
              className="flex h-7 items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-2 px-2.5 text-[12px] text-cs-text-muted hover:text-cs-text"
            >
              <Copy size={14} aria-hidden="true" /> Copy
            </button>
            <MessageInfoPopover message={message} senderName={senderName} {...P('info')}>
              <button
                type="button"
                aria-label="Info"
                className="flex h-8 w-8 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
              >
                <Info size={16} aria-hidden="true" />
              </button>
            </MessageInfoPopover>
            <IconBtn label="Delete" soon className="text-cs-danger hover:bg-cs-danger/10 hover:text-cs-danger">
              <Trash2 size={16} aria-hidden="true" />
            </IconBtn>
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  soon,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  soon?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={soon}
          onClick={onClick}
          className={[
            'flex h-8 w-8 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text',
            soon ? 'opacity-45' : '',
            className ?? '',
          ].join(' ')}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
