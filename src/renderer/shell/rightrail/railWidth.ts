/** Rail width (px) below which sections drop their secondary controls and
 *  switch to a compact layout. Measured against the rail's OUTER width
 *  (`ui.rightWidth`), which is what the design references measured, and read
 *  straight from the store — the rail's own px width already lives there, so
 *  no ResizeObserver or container query is needed. Rail bounds are 240 / 320
 *  default / 640. */
export const RAIL_COLLAPSE_WIDTH = 304;

/** The breakpoint as a BOOLEAN, which is the form sections must select from the
 *  store.
 *
 *  A rail drag writes `ui.rightWidth` on every animation frame. A component that
 *  subscribes to the raw px value therefore re-renders on every frame — and it
 *  does so *regardless* of any `React.memo` below it, because a store
 *  subscription is not a prop and no memo comparator can bail it out. Selecting
 *  `railIsWide(s.ui.rightWidth)` instead lets zustand's Object.is check swallow
 *  every frame that does not actually cross 304px, which is all but one of them
 *  in a typical drag. See issue #35. */
export function railIsWide(width: number): boolean {
  return width >= RAIL_COLLAPSE_WIDTH;
}
