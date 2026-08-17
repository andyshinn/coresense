import { useEffect } from 'react';
import { Button } from '../../components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '../../components/ui/popover';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';

interface Props {
  messageId: string;
  conversationKey: string;
  /** Message body, shown truncated so the user sees what they're deleting. */
  preview: string;
  client: ApiClient | null;
  /** Called after the server confirms the delete. The conversation views need
   *  nothing here (the messagesDeleted WS event updates the store), but the
   *  search panel holds its hits in local state and must splice its own. */
  onDeleted?: () => void;
}

const PREVIEW_MAX = 80;

/** Anchored delete confirmation, rendered by the message row itself. Living
 *  inside the row means Virtuoso recycling unmounts the confirm along with the
 *  row rather than orphaning a detached anchor — at the cost of dismissing the
 *  confirm when the message scrolls far out of view. */
export function DeleteConfirmPopover({ messageId, conversationKey, preview, client, onDeleted }: Props) {
  const open = useStore((s) => s.pendingDeleteMessageId === messageId);
  const setPendingDeleteMessageId = useStore((s) => s.setPendingDeleteMessageId);

  // Unmounting is not a radix dismissal — Virtuoso recycling the row (or the
  // search panel navigating away) tears the popover down without ever firing
  // onOpenChange, leaving the id staged so the confirm re-opens unbidden the
  // next time that row mounts. Clear on unmount, but only when *this* message
  // is the staged one: confirm/cancel already nulled the field by then, and a
  // different id belongs to whichever row staged it.
  useEffect(() => {
    return () => {
      const store = useStore.getState();
      if (store.pendingDeleteMessageId === messageId) store.setPendingDeleteMessageId(null);
    };
  }, [messageId]);

  if (!open) return null;

  const snippet = preview.length > PREVIEW_MAX ? `${preview.slice(0, PREVIEW_MAX)}…` : preview;

  const confirm = async () => {
    setPendingDeleteMessageId(null);
    if (!client) {
      notify.error('Couldn’t delete message: no connection to the local service.');
      return;
    }
    try {
      await api.deleteMessage(client, conversationKey, messageId);
      notify.success('Message deleted');
      onDeleted?.();
    } catch (err) {
      notify.error(`Couldn’t delete message: ${(err as Error).message}`, err);
    }
  };

  return (
    <Popover open onOpenChange={(next) => !next && setPendingDeleteMessageId(null)}>
      <PopoverAnchor />
      <PopoverContent
        align="end"
        side="top"
        className="w-72 p-3"
        data-testid="delete-confirm-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[12.5px] text-cs-text">Delete this message?</p>
        <p className="mt-1 line-clamp-2 text-[12px] italic text-cs-text-muted">“{snippet}”</p>
        <p className="mt-2 text-[11.5px] text-cs-text-muted">
          This deletes it from this device only, and can’t be undone. It stays on other devices that received it.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            data-testid="cancel-delete-message"
            onClick={() => setPendingDeleteMessageId(null)}
          >
            Cancel
          </Button>
          <Button variant="destructive" size="sm" data-testid="confirm-delete-message" onClick={confirm}>
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
