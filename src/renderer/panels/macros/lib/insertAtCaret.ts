export interface CaretInsert {
  value: string;
  caret: number;
}

/** Splice `insert` into `value`, replacing the [start, end) selection, and
 *  report where the caret should land (immediately after the inserted text).
 *  Pure core of the textarea caret-insert used to drop variables/filters from
 *  the reference panel into the editor. */
export function spliceAtCaret(value: string, start: number, end: number, insert: string): CaretInsert {
  const next = value.slice(0, start) + insert + value.slice(end);
  return { value: next, caret: start + insert.length };
}
