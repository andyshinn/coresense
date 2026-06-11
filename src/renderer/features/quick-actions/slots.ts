import { MAX_QUICK_ACTIONS, QUICK_ACTION_IDS, type QuickActionId } from './ids';

/** Catalog ids not yet assigned to a slot, in catalog order. */
export function availableToAdd(slots: readonly QuickActionId[]): QuickActionId[] {
  return QUICK_ACTION_IDS.filter((id) => !slots.includes(id));
}

/** Append an id unless it's a duplicate or the cap is reached. */
export function addSlot(slots: readonly QuickActionId[], id: QuickActionId): QuickActionId[] {
  if (slots.includes(id) || slots.length >= MAX_QUICK_ACTIONS) return [...slots];
  return [...slots, id];
}

/** Remove the slot at `index`. */
export function removeSlot(slots: readonly QuickActionId[], index: number): QuickActionId[] {
  return slots.filter((_, i) => i !== index);
}

/** Replace the id at `index`. (Caller only offers unassigned ids, so no dedupe.) */
export function setSlot(
  slots: readonly QuickActionId[],
  index: number,
  id: QuickActionId,
): QuickActionId[] {
  return slots.map((cur, i) => (i === index ? id : cur));
}

/** Move the slot at `from` to `to`; out-of-range moves return the list unchanged. */
export function moveSlot(
  slots: readonly QuickActionId[],
  from: number,
  to: number,
): QuickActionId[] {
  if (from < 0 || from >= slots.length || to < 0 || to >= slots.length) return [...slots];
  const next = [...slots];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
