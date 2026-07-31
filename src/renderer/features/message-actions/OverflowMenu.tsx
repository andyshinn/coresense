import type { ReactNode } from 'react';
import type { Message } from '../../../shared/types';
import type { BlockSenderDialogPrefill } from '../../components/BlockSenderDialog';
import type { ContextMenuItem } from '../../components/ContextMenu';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { useStore } from '../../lib/store';
import { buildMessageMenuItems } from './menuItems';

interface Props {
  message: Message;
  isSelf: boolean;
  senderName: string | undefined;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  onResend?: (m: Message) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** The action bar's "…" dropdown. Renders the same ContextMenuEntry[] the
 *  right-click menu does — two renderers, one item list. */
export function OverflowMenu({ message, isSelf, senderName, onBlock, onResend, open, onOpenChange, children }: Props) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const setPendingDeleteMessageId = useStore((s) => s.setPendingDeleteMessageId);

  const close = () => onOpenChange(false);
  const items = buildMessageMenuItems({
    message,
    isSelf,
    senderName,
    onViewContact: (key) => setActiveKey(key),
    onBlock,
    onDelete: (m) => setPendingDeleteMessageId(m.id),
    onResend,
  });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[216px] border-cs-border-strong bg-cs-bg-2 p-1">
        {items.map((entry, i) =>
          entry.kind === 'separator' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: separators carry no identity
            <div key={`sep-${i}`} className="my-1 h-px bg-cs-border" />
          ) : (
            <MenuButton
              key={entry.label}
              entry={entry}
              onRun={() => {
                entry.onClick();
                close();
              }}
            />
          ),
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuButton({ entry, onRun }: { entry: ContextMenuItem; onRun: () => void }) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      disabled={entry.disabled}
      onClick={onRun}
      data-testid={entry.testid}
      className={[
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
        entry.disabled ? 'cursor-default opacity-45' : 'hover:bg-cs-bg-3',
        entry.danger ? 'text-cs-danger hover:bg-cs-danger/10' : 'text-cs-text',
      ].join(' ')}
    >
      <span className={entry.danger ? 'text-cs-danger' : 'text-cs-text-muted'}>{Icon ? <Icon size={15} /> : null}</span>
      <span className="flex-1">{entry.label}</span>
    </button>
  );
}
