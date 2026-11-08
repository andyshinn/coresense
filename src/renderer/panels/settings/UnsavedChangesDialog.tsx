import { LeaveGuardDialog } from '../../components/LeaveGuardDialog';
import { useStore } from '../../lib/store';
import { getSectionHandle } from './sectionHandles';

// Raised when the user tries to leave the Settings panel, switch tabs, or quit
// the app while a section has unsaved changes. "Save all" commits every dirty
// section, "Discard" reverts them, "Cancel" stays put.
export function UnsavedChangesDialog() {
  const dirtyById = useStore((s) => s.settingsUi.dirtyById);
  const sections = useStore((s) => s.settingsUi.sections);

  const dirtyIds = Object.entries(dirtyById)
    .filter(([, v]) => v)
    .map(([id]) => id);
  const dirtyTitles = dirtyIds.map((id) => sections.find((s) => s.id === id)?.title ?? id);

  const onSave = async () => {
    for (const id of dirtyIds) {
      await getSectionHandle(id)?.save();
    }
  };

  const onDiscard = () => {
    for (const id of dirtyIds) getSectionHandle(id)?.reset();
  };

  return (
    <LeaveGuardDialog
      title="Unsaved settings changes"
      description={(action) => (
        <>
          {dirtyTitles.length === 1
            ? `The "${dirtyTitles[0]}" section has unsaved changes. `
            : `${dirtyTitles.length} sections have unsaved changes. `}
          Save them before {action}?
        </>
      )}
      saveLabel="Save all"
      onSave={onSave}
      onDiscard={onDiscard}
    >
      {dirtyTitles.length > 1 && (
        <ul className="list-disc pl-5 text-[12px] text-cs-text-muted">
          {dirtyTitles.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </LeaveGuardDialog>
  );
}
