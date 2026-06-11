import { MAX_QUICK_ACTIONS, QUICK_ACTION_IDS, type QuickActionId } from './ids';

const VALID = new Set<string>(QUICK_ACTION_IDS);

/** Normalize persisted quick-action ids: keep only known ids, drop duplicates,
 *  preserve order, and cap at MAX_QUICK_ACTIONS. Defensive so older or
 *  hand-edited settings never crash the card. */
export function sanitizeQuickActionIds(ids: readonly string[]): QuickActionId[] {
  const out: QuickActionId[] = [];
  for (const id of ids) {
    if (!VALID.has(id)) continue;
    const known = id as QuickActionId;
    if (out.includes(known)) continue;
    out.push(known);
    if (out.length >= MAX_QUICK_ACTIONS) break;
  }
  return out;
}
