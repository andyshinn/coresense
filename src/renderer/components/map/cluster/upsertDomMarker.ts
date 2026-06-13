import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import type { CachedMarker } from './markerCache';

export interface UpsertDomMarkerOpts {
  map: MapLibreMap;
  cache: Map<string, CachedMarker>;
  wanted: Set<string>;
  cacheKey: string;
  signature: string;
  position: [number, number];
  build: () => HTMLElement;
  onSignatureChange?: (el: HTMLElement) => void;
}

/** Upserts a raw DOM-element marker (no contact visual) with optional signature-driven element update. */
export function upsertDomMarker(opts: UpsertDomMarkerOpts): void {
  const { map, cache, wanted, cacheKey, signature, position, build, onSignatureChange } = opts;
  wanted.add(cacheKey);
  const existing = cache.get(cacheKey);
  if (existing) {
    existing.marker.setLngLat(position);
    if (existing.signature !== signature) {
      if (onSignatureChange) onSignatureChange(existing.marker.getElement());
      existing.signature = signature;
    }
    return;
  }
  const el = build();
  const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(position).addTo(map);
  cache.set(cacheKey, { marker, signature, kind: null });
}
