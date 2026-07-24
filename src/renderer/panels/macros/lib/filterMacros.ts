import type { MacroScope, MacroTemplate } from '../../../../shared/macros/types';

export type ScopeFilter = 'all' | MacroScope;

/** Filter the library by scope and a case-insensitive substring matched against
 *  the macro name or its template body. */
export function filterMacros(macros: MacroTemplate[], query: string, scope: ScopeFilter): MacroTemplate[] {
  const q = query.trim().toLowerCase();
  return macros.filter((m) => {
    if (scope !== 'all' && m.scope !== scope) return false;
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || m.template.toLowerCase().includes(q);
  });
}

export interface ScopeCounts {
  all: number;
  global: number;
  channel: number;
  contact: number;
}

/** Per-scope tallies for the segmented filter chips. */
export function scopeCounts(macros: MacroTemplate[]): ScopeCounts {
  const counts: ScopeCounts = { all: macros.length, global: 0, channel: 0, contact: 0 };
  for (const m of macros) counts[m.scope]++;
  return counts;
}
