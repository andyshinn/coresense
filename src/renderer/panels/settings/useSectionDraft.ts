import { useCallback, useEffect, useRef, useState } from 'react';
import { notify } from '../../lib/notify';
import { registerSectionHandle, unregisterSectionHandle, useStore } from '../../lib/store';

// Local edit buffer for a settings section. Holds a `draft` that the user edits
// freely; `dirty` is true while it diverges from the saved store value. Server
// pushes (WS rebroadcasts) are adopted only when the user hasn't diverged
// locally — otherwise an in-progress edit would be clobbered. This generalizes
// the reconciliation proven in the old RadioTab / AppSettings panels.
export function useSectionDraft<T>(saved: T, eq: (a: T, b: T) => boolean) {
  const [draft, setDraft] = useState<T>(saved);
  const lastSavedRef = useRef<T>(saved);

  useEffect(() => {
    if (saved === lastSavedRef.current) return;
    setDraft((prev) => {
      const adopt = eq(prev, lastSavedRef.current);
      lastSavedRef.current = saved;
      return adopt ? saved : prev;
    });
  }, [saved, eq]);

  const dirty = !eq(draft, saved);
  const reset = () => setDraft(saved);
  return { draft, setDraft, dirty, reset };
}

interface SectionOptions<T> {
  /** Stable section id — must match the SettingsSectionMeta registered by the panel. */
  id: string;
  /** Saved value from the store (a slice or a whole settings object). */
  saved: T;
  /** Equality over the fields this section owns — keep it stable (module scope). */
  eq: (a: T, b: T) => boolean;
  /** Persists the draft. Should resolve on success and reject on failure. */
  onSave: (draft: T) => Promise<void>;
}

// Wires a section's draft into the shared settings UI: reports its dirty flag
// to the store (rail/pill dots + the navigation guard) and registers save/reset
// handles the UnsavedChangesDialog invokes for "Save all" / "Discard".
export function useSettingsSection<T>({ id, saved, eq, onSave }: SectionOptions<T>) {
  const { draft, setDraft, dirty, reset } = useSectionDraft(saved, eq);
  const [saving, setSaving] = useState(false);
  const setSectionDirty = useStore((s) => s.setSectionDirty);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const resetRef = useRef(reset);
  resetRef.current = reset;

  // The one save body both callers share. Rethrows: "Save all" in the dialog
  // needs the failure so it can abort the navigation/quit and surface a single
  // error. Reads the draft and onSave through refs, so the handle registered
  // once below always saves the latest values.
  const run = useCallback(async () => {
    setSaving(true);
    try {
      await onSaveRef.current(draftRef.current);
    } finally {
      setSaving(false);
    }
  }, []);

  // For the section's own Save button: surface failures as a toast and swallow.
  const save = () => run().catch((err) => notify.failure('Save', err));

  // Merges a patch into one object-valued field of the draft, e.g.
  // setGroup('proxy', { port }) — saves spelling out the nested spread per row.
  const setGroup = <K extends keyof T>(key: K, patch: Partial<T[K]>) =>
    setDraft((s) => ({ ...s, [key]: { ...s[key], ...patch } }));

  useEffect(() => {
    setSectionDirty(id, dirty);
  }, [id, dirty, setSectionDirty]);

  useEffect(() => {
    registerSectionHandle(id, {
      // For "Save all" in the dialog: run() rethrows, see above.
      save: run,
      reset: () => resetRef.current(),
    });
    return () => {
      unregisterSectionHandle(id);
      setSectionDirty(id, false);
    };
  }, [id, run, setSectionDirty]);

  // The props every section passes to <SettingsSection>; callers add canSave.
  const sectionProps = { id, dirty, saving, onSave: save };

  return { draft, setDraft, setGroup, dirty, saving, save, reset, sectionProps };
}
