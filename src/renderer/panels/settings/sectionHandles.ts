// Per-section save/reset callbacks. Kept in a plain module map rather than the
// store so registering a section doesn't trigger a store-wide re-render — the
// UnsavedChangesDialog reads them imperatively when resolving "Save all".
interface SettingsSectionHandle {
  save: () => Promise<void>;
  reset: () => void;
}
const sectionHandles = new Map<string, SettingsSectionHandle>();

export function registerSectionHandle(id: string, handle: SettingsSectionHandle): void {
  sectionHandles.set(id, handle);
}
export function unregisterSectionHandle(id: string): void {
  sectionHandles.delete(id);
}
export function getSectionHandle(id: string): SettingsSectionHandle | undefined {
  return sectionHandles.get(id);
}
