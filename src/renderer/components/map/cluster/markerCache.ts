import type maplibregl from 'maplibre-gl';
import type { Contact } from '../../../../shared/types';

/** Cached marker entry tracking the live MapLibre marker, its render signature, and contact kind. */
export interface CachedMarker {
  marker: maplibregl.Marker;
  signature: string;
  kind: Contact['kind'] | null;
}

/** Builds a stable signature string capturing the inputs that affect a marker's rendered visual. */
export function markerSignature(
  prefix: string,
  c: Contact,
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
