import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const CANCEL_CLASS = 'rounded-md border border-cs-border bg-cs-bg-2 px-3 py-1.5 text-xs hover:bg-cs-bg-3';
const DANGER_CLASS =
  'rounded-md border border-cs-danger bg-cs-danger/10 px-3 py-1.5 text-xs text-cs-danger hover:bg-cs-danger/20';

/** Yes/no confirmation for a destructive or irreversible action: title,
 *  description, Cancel, and a confirm button. Dismissing the dialog (Esc,
 *  overlay click) counts as Cancel. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: ReactNode;
  tone?: 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button" onClick={onCancel} className={CANCEL_CLASS}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={tone === 'danger' ? DANGER_CLASS : CANCEL_CLASS}>
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
