import { type ReactNode, useState } from 'react';
import { flushAndConfirmQuit } from '../app/quit';
import { useApiClient } from '../lib/apiClientContext';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

interface Props {
  title: string;
  /** The body, given what was blocked: leaving the surface or quitting. */
  description: (action: 'leaving' | 'quitting') => ReactNode;
  /** Shown under the description (Settings lists its dirty sections). */
  children?: ReactNode;
  saveLabel: string;
  /** Saves every unsaved edit. Rejects to keep the dialog open. */
  onSave: () => Promise<void>;
  /** Throws away every unsaved edit. */
  onDiscard: () => void;
}

/**
 * The prompt a surface with unsaved edits raises when a move away from it was
 * blocked (the store's leave guard parked it in `settingsUi.pendingTarget`) or
 * the app is quitting. The surface supplies the wording and its own save and
 * discard; this carries out the blocked move afterwards. "Cancel" stays put.
 * Each guarded surface mounts its own, and only the one on screen can be dirty.
 */
export function LeaveGuardDialog({ title, description, children, saveLabel, onSave, onDiscard }: Props) {
  const client = useApiClient();
  const pendingTarget = useStore((s) => s.settingsUi.pendingTarget);
  const clearPendingTarget = useStore((s) => s.clearPendingTarget);
  const commitPendingTarget = useStore((s) => s.commitPendingTarget);
  const [busy, setBusy] = useState(false);

  // After the user resolves the prompt, carry out what they were trying to do.
  const finish = () => {
    if (pendingTarget?.kind === 'quit') {
      clearPendingTarget();
      if (client) void flushAndConfirmQuit(client);
    } else {
      commitPendingTarget();
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave();
      finish();
    } catch (err) {
      // Leave the dialog open so the user can retry or cancel.
      notify.failure('Save', err);
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    onDiscard();
    finish();
  };

  return (
    <Dialog
      open={pendingTarget != null}
      onOpenChange={(o) => {
        if (!o && !busy) clearPendingTarget();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description(pendingTarget?.kind === 'quit' ? 'quitting' : 'leaving')}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => clearPendingTarget()}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={discard}>
            Discard
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
