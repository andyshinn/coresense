import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import type { Contact } from '../../../../shared/types';
import { buildContactMarker, type MarkerState, syncMarkerVisual } from '../markers/markerHtml';
import { type CachedMarker, markerSignature } from './markerCache';

export interface UpsertContactMarkerOpts {
  map: MapLibreMap;
  cache: Map<string, CachedMarker>;
  wanted: Set<string>;
  cacheKey: string;
  signaturePrefix: string;
  contact: Contact;
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
    if (existing.signature !== signature || existing.kind !== contact.kind) {
      syncMarkerVisual(existing.marker.getElement(), contact, state, existing.kind);
      existing.signature = signature;
      existing.kind = contact.kind;
    }
    return;
  }
  const el = buildContactMarker(contact, state);
  if (elementClass) el.classList.add(elementClass);
  el.addEventListener('click', onClick);
  const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(position).addTo(map);
  cache.set(cacheKey, { marker, signature, kind: contact.kind });
}
