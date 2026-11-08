import { type Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { shapeMarkup } from './markers/MarkerShape';

interface Props {
  map: MapLibreMap | null;
  /** Where the pin sits; null removes it. */
  position: { lat: number; lon: number } | null;
  name: string;
  /** False pins it in place (the radio's GPS owns the position). */
  draggable: boolean;
  /** Fired once per drag, with where it was dropped. */
  onDragEnd: (lat: number, lon: number) => void;
}

const SIZE = 18;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The element: the User (chat) amber circle inside an accent halo, with the
 *  radio's name in a mono chip underneath. */
function buildElement(name: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'cs-map-drag';
  el.setAttribute('role', 'img');
  el.innerHTML = `
    <span class="cs-map-drag__halo">
      <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">
        ${shapeMarkup({ type: 'chat', size: SIZE })}
      </svg>
    </span>
    <span class="cs-map-drag__chip">${escapeHtml(name)}</span>
  `;
  return el;
}

/**
 * My Node's position pin: draggable, unlike the Map View's "YOU" badge
 * (MapLocalNode). Dropping it reports the new position; the parent decides
 * what to do with it (the Location card makes it the draft). Pointer only:
 * the lat/lon fields beside the map are the keyboard path.
 */
export function DraggableNodeMarker({ map, position, name, draggable, onDragEnd }: Props) {
  const markerRef = useRef<Marker | null>(null);
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const lat = position?.lat ?? null;
  const lon = position?.lon ?? null;

  useEffect(() => {
    if (!map) return;
    if (lat === null || lon === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    let marker = markerRef.current;
    if (!marker) {
      const created = new Marker({ element: buildElement(name), anchor: 'center' });
      created.on('dragend', () => {
        // A drag across the antimeridian on a wrapped world reports a
        // longitude past ±180; bring it back into range.
        const at = created.getLngLat().wrap();
        onDragEndRef.current(at.lat, at.lng);
      });
      marker = created.setLngLat([lon, lat]).addTo(map);
      markerRef.current = marker;
    } else {
      marker.setLngLat([lon, lat]);
    }
    // Name, label and draggability change in place rather than rebuilding
    // the marker (which would drop a drag in progress).
    marker.setDraggable(draggable);
    const el = marker.getElement();
    el.classList.toggle('cs-map-drag--fixed', !draggable);
    el.title = draggable ? 'Drag to move' : '';
    el.setAttribute('aria-label', `${name}: your radio's position.${draggable ? ' Drag to move.' : ''}`);
    const chip = el.querySelector('.cs-map-drag__chip');
    if (chip) chip.textContent = name;
  }, [map, lat, lon, name, draggable]);

  useEffect(
    () => () => {
      markerRef.current?.remove();
      markerRef.current = null;
    },
    [],
  );

  return null;
}
