/** Rail width (px) below which sections drop their secondary controls and
 *  switch to a compact layout. Measured against the rail's OUTER width
 *  (`ui.rightWidth`), which is what the design references measured, and read
 *  straight from the store — the rail's own px width already lives there, so
 *  no ResizeObserver or container query is needed. Rail bounds are 240 / 320
 *  default / 640. */
export const RAIL_COLLAPSE_WIDTH = 304;
