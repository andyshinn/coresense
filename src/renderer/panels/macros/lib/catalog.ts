import { getManifest } from '../../../../shared/macros';
import type { MacroManifest } from '../../../../shared/macros/types';
import type { MacroCatalog } from './tokenize';

/** Build the tokenizer's catalog from the server manifest so syntax colouring
 *  and mode derivation track the real variable/filter set. */
export function buildCatalog(manifest: MacroManifest): MacroCatalog {
  return {
    variableNames: new Set(manifest.variables.map((v) => v.name)),
    replyOnlyNames: new Set(manifest.variables.filter((v) => v.available === 'reply').map((v) => v.name)),
    customFilterNames: new Set(manifest.filters.map((f) => f.name)),
  };
}

/** Shared catalog built from the static manifest — the variable/filter set is
 *  identical to the server's, so syntax highlighting and mode derivation don't
 *  need a network round-trip. */
export const MACRO_CATALOG: MacroCatalog = buildCatalog(getManifest());
