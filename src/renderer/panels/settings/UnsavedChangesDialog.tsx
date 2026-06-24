import { AlertDialog, Box, Button, Flex, Text } from '@radix-ui/themes';
import { useState } from 'react';
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
    <AlertDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) clearPendingTarget();
      }}
    >
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Unsaved settings changes</AlertDialog.Title>
        <AlertDialog.Description size="2">
          {dirtyTitles.length === 1
            ? `The "${dirtyTitles[0]}" section has unsaved changes. `
            : `${dirtyTitles.length} sections have unsaved changes. `}
          Save them before {action}?
        </AlertDialog.Description>
        {dirtyTitles.length > 1 && (
          <Box mt="2">
            <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
              {dirtyTitles.map((t) => (
                <li key={t}>
                  <Text size="1" color="gray">
                    {t}
                  </Text>
                </li>
              ))}
            </ul>
          </Box>
        )}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={busy} onClick={clearPendingTarget}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
          </AlertDialog.Action>
          <AlertDialog.Action>
            <Button disabled={busy} onClick={onSaveAll}>
              {busy ? 'Saving…' : 'Save all'}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
