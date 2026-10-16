import { Copy, Info, MoreHorizontal, Plus, Reply } from 'lucide-react';
import { useState } from 'react';
import type { MacroTemplate } from '../../../shared/macros/types';
import type { Message } from '../../../shared/types';
import type { BlockSenderDialogPrefill } from '../../components/BlockSenderDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { useApiClient } from '../../lib/apiClientContext';
import { copyToClipboard } from '../../lib/clipboard';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { expandMacroReply } from '../macros/inchat';
import { applicableMacros, topMacros } from '../macros/macroPicks';
import { EmojiPickerPopover } from './EmojiPickerPopover';
import { MacroChip, MacroPanel } from './MacroPanel';
import { MessageInfoPopover } from './MessageInfoPopover';
import { OverflowMenu } from './OverflowMenu';
import { ReactionRow } from './ReactionRow';

type PopKey = 'emoji' | 'macro' | 'info' | 'more' | null;

// Icon-only triggers (h-6 inline with the emoji row, h-8 elsewhere) and the
// bordered text pill. The popover triggers stay plain buttons rather than
// IconBtn: PopoverTrigger asChild needs a ref-forwarding child, and IconBtn
// would add a tooltip.
const ICON_BTN_SM =
  'flex h-6 w-6 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text';
const ICON_BTN =
  'flex h-8 w-8 items-center justify-center rounded-md text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text';
const PILL_BTN =
  'flex h-7 items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-2 px-2.5 text-[12px] text-cs-text-muted hover:text-cs-text';

interface Props {
  message: Message;
  isSelf: boolean;
  senderName: string;
  onReact: (name: string, emoji: string) => void;
  onReply: (name: string) => void;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  /** Insert rendered macro text into the composer as `@[name] <text> `. */
  onMacro?: (name: string, text: string) => void;
  /** Retry a failed send. Absent ⇒ the overflow menu omits "Re-send". */
  onResend?: (m: Message) => void;
}

/** Discord-style hover action pill anchored to the top-right of a message row. */
export function MessageQuickBar({ message, isSelf, senderName, onReact, onReply, onBlock, onMacro, onResend }: Props) {
  const client = useApiClient();
  const [open, setOpen] = useState<PopKey>(null);
  const recordEmojiUse = useStore((s) => s.recordEmojiUse);
  const macros = useStore((s) => s.macros);
  const macroUsage = useStore((s) => s.ui.macroUsage);
  const recordMacroUse = useStore((s) => s.recordMacroUse);
  const [macroBusy, setMacroBusy] = useState(false);
  // Recomputed per render like ReactionRow's emoji row — both lists are tiny.
  const conversationMacros = applicableMacros(macros, message.key);
  const chipMacros = topMacros(conversationMacros, macroUsage, Date.now(), 2);
  const popoverProps = (key: Exclude<PopKey, null>) => ({
    open: open === key,
    onOpenChange: (o: boolean) => setOpen(o ? key : null),
  });

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
  // Named pickMacro, not useMacro: a `use*` name would be treated as a hook.
  const pickMacro = async (macro: MacroTemplate, cachedText?: string) => {
    // Same guard as pick/reply: an unresolved sender would insert `@[] `.
    if (!hasSender || macroBusy) return;
    setMacroBusy(true);
    let text: string | null;
    try {
      text = cachedText ?? (await expandMacroReply(client, macro, message));
    } finally {
      setMacroBusy(false);
    }
    if (text == null || !onMacro) return; // render failed (toasted) or nothing to insert into
    recordMacroUse(macro.id);
    onMacro(senderName, text);
    setOpen(null);
  };
  const copyText = () => copyToClipboard(message.body, () => notify.success('Copied message text'));

  return (
    <div
      data-testid="message-quick-bar"
      data-open={open != null}
      // Hidden by default: opacity-0 AND pointer-events-none so the invisible
      // pill can't capture clicks or trap keyboard focus on every message row.
      // Revealed on row hover, on focus-within (keyboard reaches it), or while a
      // popover is pinned open — each restoring pointer events.
      className="absolute right-3 -top-3.5 z-20 flex items-center opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto data-[open=true]:opacity-100 data-[open=true]:pointer-events-auto"
    >
      <div
        className="flex items-center gap-1 rounded-lg border border-cs-border-strong bg-cs-bg-3 px-1.5 py-1"
        style={{ boxShadow: '0 10px 26px rgba(0,0,0,0.5)' }}
      >
        {!isSelf ? (
          <>
            <ReactionRow onPick={pick} />
            <EmojiPickerPopover {...popoverProps('emoji')} onPick={pick}>
              <button type="button" aria-label="More emoji" className={ICON_BTN_SM}>
                <Plus size={14} aria-hidden="true" />
              </button>
            </EmojiPickerPopover>
            <span className="mx-1 h-6 w-px bg-cs-border" />
            <button type="button" aria-label="Reply" onClick={reply} className={PILL_BTN}>
              <Reply size={14} aria-hidden="true" />
            </button>
            {client != null && (
              <div className="flex items-center gap-1 pl-1">
                {chipMacros.map((m) => (
                  <MacroChip key={m.id} macro={m} onPick={(macro) => void pickMacro(macro)} />
                ))}
                <MacroPanel
                  {...popoverProps('macro')}
                  macros={conversationMacros}
                  message={message}
                  onPick={(macro, text) => void pickMacro(macro, text)}
                >
                  <button type="button" aria-label="All macros" className={ICON_BTN_SM}>
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </button>
                </MacroPanel>
              </div>
            )}
            <span className="mx-1 h-6 w-px bg-cs-border" />
            <IconBtn label="Copy text" onClick={copyText}>
              <Copy size={16} aria-hidden="true" />
            </IconBtn>
          </>
        ) : (
          <>
            <button type="button" aria-label="Copy" onClick={copyText} className={PILL_BTN}>
              <Copy size={14} aria-hidden="true" /> Copy
            </button>
            <MessageInfoPopover message={message} senderName={senderName} {...popoverProps('info')}>
              <button type="button" aria-label="Info" className={ICON_BTN}>
                <Info size={16} aria-hidden="true" />
              </button>
            </MessageInfoPopover>
          </>
        )}
        <OverflowMenu
          message={message}
          isSelf={isSelf}
          senderName={senderName}
          onBlock={onBlock}
          onResend={onResend}
          {...popoverProps('more')}
        >
          <button type="button" aria-label="More" className={ICON_BTN}>
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </OverflowMenu>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} onClick={onClick} className={ICON_BTN}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
