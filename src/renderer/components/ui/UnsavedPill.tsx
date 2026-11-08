/** The house "Unsaved" badge: shown beside a Save button while an edit is
 *  pending (Settings sections, My Node's position). */
export function UnsavedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-cs-warn/40 bg-cs-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-cs-warn">
      <span className="size-1.5 rounded-full bg-cs-warn" aria-hidden />
      Unsaved
    </span>
  );
}
