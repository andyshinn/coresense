import { type Map as MapLibreMap, Marker } from 'maplibre-gl';
import { buildContactMarker, type MarkerState, type MarkerSubject, syncMarkerVisual } from '../markers/markerHtml';
import { type CachedMarker, markerSignature } from './markerCache';

export interface UpsertContactMarkerOpts {
  map: MapLibreMap;
  cache: Map<string, CachedMarker>;
  wanted: Set<string>;
  cacheKey: string;
  signaturePrefix: string;
  contact: MarkerSubject;
  position: [number, number];
  state: MarkerState;
  elementClass?: string;
  onClick: (e: MouseEvent) => void;
}

/** Upserts a contact-style marker into the cache, creating/syncing/positioning it on the map. */
export function upsertContactLikeMarker(opts: UpsertContactMarkerOpts): void {
  const { map, cache, wanted, cacheKey, signaturePrefix, contact, position, state, elementClass, onClick } = opts;
  const signature = markerSignature(signaturePrefix, contact, state);
  wanted.add(cacheKey);

  const existing = cache.get(cacheKey);
  if (existing) {
    existing.marker.setLngLat(position);
    // The signature includes the kind, so a kind change re-syncs too.
    if (existing.signature !== signature) {
      syncMarkerVisual(existing.marker.getElement(), contact, state);
      existing.signature = signature;
    }
    return;
  }
  const el = buildContactMarker(contact, state);
  if (elementClass) el.classList.add(elementClass);
  el.addEventListener('click', onClick);
  const marker = new Marker({ element: el, anchor: 'center' }).setLngLat(position).addTo(map);
  cache.set(cacheKey, { marker, signature });
}
