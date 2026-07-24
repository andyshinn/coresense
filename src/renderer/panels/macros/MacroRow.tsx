import { Copy, type LucideIcon, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fmtRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { MacroTemplate } from '../../../shared/macros/types';
import { ModeChip, ScopeTag, Snippet } from './components/chips';

interface RowActionProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function RowAction({ icon: Icon, label, onClick, danger, disabled }: RowActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex size-7 items-center justify-center rounded text-cs-text-dim transition-colors hover:bg-cs-bg-3 hover:text-cs-text disabled:pointer-events-none disabled:opacity-40',
        danger && 'hover:text-cs-danger',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/** Trash action gated by a shadcn confirmation popover. */
function DeleteConfirm({
  macro,
  onDelete,
  disabled,
}: {
  macro: MacroTemplate;
  onDelete: (m: MacroTemplate) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Delete ${macro.name}`}
          title={`Delete ${macro.name}`}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          className="flex size-7 items-center justify-center rounded text-cs-text-dim transition-colors hover:bg-cs-bg-3 hover:text-cs-danger disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-60 p-3"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="text-[12.5px] text-cs-text">
          Delete <span className="font-medium">{macro.name}</span>? This can’t be undone.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-testid="confirm-delete"
            onClick={() => {
              setOpen(false);
              onDelete(macro);
            }}
          >
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface MacroRowProps {
  macro: MacroTemplate;
  scopeLabel: string;
  onEdit: (m: MacroTemplate) => void;
  onDuplicate: (m: MacroTemplate) => void;
  onDelete: (m: MacroTemplate) => void;
  mutationsDisabled?: boolean;
}

export function MacroRow({ macro, scopeLabel, onEdit, onDuplicate, onDelete, mutationsDisabled }: MacroRowProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: cannot be a <button> because it contains nested action buttons
    <div
      data-testid={`macro-row-${macro.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onEdit(macro)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(macro);
        }
      }}
      className="group flex cursor-pointer items-center gap-3 border-b border-cs-border px-4 py-3 outline-none hover:bg-cs-bg-2 focus-visible:bg-cs-bg-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-cs-text">{macro.name}</span>
          <ModeChip template={macro.template} />
        </div>
        <Snippet template={macro.template} className="mt-0.5 block truncate text-[12px]" />
      </div>
      <div className="hidden w-[150px] shrink-0 flex-col items-start gap-0.5 md:flex">
        <ScopeTag scope={macro.scope} label={scopeLabel} />
        <span className="font-mono text-[10px] text-cs-text-dim">updated {fmtRelative(macro.updatedAt)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <RowAction icon={Pencil} label={`Edit ${macro.name}`} onClick={() => onEdit(macro)} />
        <RowAction
          icon={Copy}
          label={`Duplicate ${macro.name}`}
          onClick={() => onDuplicate(macro)}
          disabled={mutationsDisabled}
        />
        <DeleteConfirm macro={macro} onDelete={onDelete} disabled={mutationsDisabled} />
      </div>
    </div>
  );
}
