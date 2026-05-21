import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { getSectionHandle, useStore } from '../../lib/store';

// Raised when the user tries to leave the Settings panel, switch tabs, or quit
// the app while a section has unsaved changes. "Save all" commits every dirty
// section, "Discard" reverts them, "Cancel" stays put.
export function UnsavedChangesDialog({ client }: { client: ApiClient | null }) {
  const pendingTarget = useStore((s) => s.settingsUi.pendingTarget);
  const dirtyById = useStore((s) => s.settingsUi.dirtyById);
  const sections = useStore((s) => s.settingsUi.sections);
  const clearPendingTarget = useStore((s) => s.clearPendingTarget);
  const commitPendingTarget = useStore((s) => s.commitPendingTarget);
  const [busy, setBusy] = useState(false);

  const open = pendingTarget != null;
  const dirtyIds = Object.entries(dirtyById)
    .filter(([, v]) => v)
    .map(([id]) => id);
  const dirtyTitles = dirtyIds.map((id) => sections.find((s) => s.id === id)?.title ?? id);

  // After the user resolves the prompt, carry out what they were trying to do.
  const finish = () => {
    if (pendingTarget?.kind === 'quit') {
      clearPendingTarget();
      if (client) void api.confirmQuit(client);
    } else {
      commitPendingTarget();
    }
  };

  const onSaveAll = async () => {
    setBusy(true);
    try {
      for (const id of dirtyIds) {
        await getSectionHandle(id)?.save();
      }
      finish();
    } catch (err) {
      // Leave the dialog open so the user can retry or cancel.
      notify.error(`Save failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = () => {
    for (const id of dirtyIds) getSectionHandle(id)?.reset();
    finish();
  };

  const action = pendingTarget?.kind === 'quit' ? 'quitting' : 'leaving';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) clearPendingTarget();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unsaved settings changes</DialogTitle>
          <DialogDescription>
            {dirtyTitles.length === 1
              ? `The "${dirtyTitles[0]}" section has unsaved changes. `
              : `${dirtyTitles.length} sections have unsaved changes. `}
            Save them before {action}?
          </DialogDescription>
        </DialogHeader>
        {dirtyTitles.length > 1 && (
          <ul className="list-disc pl-5 text-[12px] text-cs-text-muted">
            {dirtyTitles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => clearPendingTarget()}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={onDiscard}>
            Discard
          </Button>
          <Button size="sm" disabled={busy} onClick={onSaveAll}>
            {busy ? 'Saving…' : 'Save all'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
