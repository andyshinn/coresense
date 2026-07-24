export interface OpenVarTag {
  /** The partial variable name typed after `{{` (may be empty). */
  partial: string;
  /** Index of the `{{` that opened this tag — completion replaces from here. */
  start: number;
}

const OPEN_TAG = /\{\{\s*([a-zA-Z_][\w.]*)?$/;

/** Detect an unclosed `{{` immediately before the caret, for variable
 *  autocomplete. `text` is the content up to the caret. Returns null when there
 *  is no open tag (e.g. the tag is already closed with `}}`). */
export function detectOpenVarTag(text: string): OpenVarTag | null {
  const m = OPEN_TAG.exec(text);
  if (!m) return null;
  return { partial: m[1] ?? '', start: m.index };
}
