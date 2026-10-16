import type { Marker } from 'maplibre-gl';
import type { MarkerSubject } from '../markers/markerHtml';

/** Cached marker entry tracking the live MapLibre marker and its render signature. */
export interface CachedMarker {
  marker: Marker;
  signature: string;
}

/** Builds a stable signature string capturing the inputs that affect a marker's rendered visual. */
export function markerSignature(
  prefix: string,
  c: MarkerSubject,
  state: { selected: boolean; faded: boolean; stale: boolean; showLabel: boolean },
): string {
  return [
    prefix,
    c.kind,
    c.name,
    state.selected ? 'S' : '_',
    state.faded ? 'F' : '_',
    state.stale ? 'T' : '_',
    state.showLabel ? 'L' : '_',
  ].join(':');
}
