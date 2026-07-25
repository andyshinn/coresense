import { Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MacroTemplate } from '../../../shared/macros/types';
import type { Message } from '../../../shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import type { ApiClient } from '../../lib/api';
import { MAX_MESSAGE_LENGTH } from '../../lib/messageLimits';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Snippet } from '../../panels/macros/components/chips';
import { type PreviewState, useReplyPreviews } from '../../panels/macros/lib/useReplyPreviews';

/** One-click macro shortcut in the quick bar. */
export function MacroChip({ macro, onPick }: { macro: MacroTemplate; onPick: (macro: MacroTemplate) => void }) {
  return (
    <button
      type="button"
      title={macro.name}
      onClick={() => onPick(macro)}
      className="inline-flex max-w-[92px] items-center gap-1 rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1 text-[11px] font-medium text-cs-text-muted hover:text-cs-text"
    >
      <span className="shrink-0 text-cs-accent">
        <Zap size={11} aria-hidden="true" />
      </span>
      <span className="truncate">{macro.name}</span>
    </button>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already scope-filtered by the caller (see macroPicks.applicableMacros). */
  macros: MacroTemplate[];
  client: ApiClient | null;
  message: Message;
  /** `renderedText` is present when the row already previewed successfully, so
   *  the caller can insert it without a second round-trip. */
  onPick: (macro: MacroTemplate, renderedText?: string) => void;
  children: ReactNode;
}

/** The all-macros popover: every macro that applies to this conversation,
 *  previewed against the message being replied to. */
export function MacroPanel({ open, onOpenChange, macros, client, message, onPick, children }: Props) {
  const previews = useReplyPreviews(client, message.id, macros, open);
  // Distinguishes "you have no macros" from "none of yours apply here".
  const totalMacros = useStore((s) => s.macros.length);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[300px] border-cs-border-strong bg-cs-bg-2 p-1.5">
        <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Reply macros</span>
          <span className="ml-auto font-mono text-[9.5px] text-cs-text-dim">vs this message</span>
        </div>
        {macros.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-cs-text-dim">
            {totalMacros === 0 ? 'No macros yet — create one in the Macros tool.' : 'No macros for this conversation.'}
          </div>
        ) : (
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {macros.map((m) => (
              <MacroRow key={m.id} macro={m} preview={previews[m.id]} onPick={onPick} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One macro: name + character count, over a preview of what would be sent.
 *  Until the render resolves (or if it fails) the raw template stands in, so
 *  the row is never blank and stays clickable either way. */
function MacroRow({
  macro,
  preview,
  onPick,
}: {
  macro: MacroTemplate;
  preview: PreviewState | undefined;
  onPick: (macro: MacroTemplate, renderedText?: string) => void;
}) {
  const rendered = preview?.status === 'ok' ? preview : null;
  return (
    <button
      type="button"
      onClick={() => onPick(macro, rendered?.text)}
      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-cs-bg-3"
    >
      <span className="flex w-full items-center gap-2">
        <span className="shrink-0 text-cs-accent">
          <Zap size={14} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-cs-text">{macro.name}</span>
        {rendered && (
          <span
            className={cn(
              'shrink-0 font-mono text-[9.5px]',
              rendered.len > MAX_MESSAGE_LENGTH ? 'text-cs-danger' : 'text-cs-text-dim',
            )}
          >
            {rendered.len}c
          </span>
        )}
      </span>
      {rendered ? (
        <span className="block w-full truncate pl-[22px] text-[11px] text-cs-text-dim">{rendered.text}</span>
      ) : (
        <Snippet template={macro.template} className="block w-full truncate pl-[22px] text-[11px]" />
      )}
      {preview?.status === 'error' && (
        <span className="block w-full truncate pl-[22px] text-[10px] text-cs-danger">{preview.message}</span>
      )}
    </button>
  );
}
