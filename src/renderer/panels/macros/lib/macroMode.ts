import { type MacroCatalog, tokenize } from './tokenize';

/** A macro's applicability, derived from the variables it uses. The stored
 *  model has no explicit mode; a template that references a reply-only variable
 *  can only resolve when replying ('reply'), everything else works anywhere
 *  ('both'). There is no derivable 'send-only' — a non-reply template is valid
 *  in both contexts. */
export type MacroMode = 'reply' | 'both';

export function deriveMacroMode(template: string, catalog: MacroCatalog): MacroMode {
  const { varRoots } = tokenize(template, 'reply', catalog);
  return varRoots.some((root) => catalog.replyOnlyNames.has(root)) ? 'reply' : 'both';
}
