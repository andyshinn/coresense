// Tiny event emitter so non-map components (e.g. RightRail's "Center on map"
// button) can drive the live MapLibre instance without prop-drilling through
// the whole shell or stuffing imperative state into the global store.
//
// Subscribers are MapCanvas (typically a single listener). Publishers can be
// anywhere in the renderer.

export type MapBusEvent = {
  kind: 'flyTo';
  lng: number;
  lat: number;
  zoom?: number;
};

type Listener = (e: MapBusEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function publish(event: MapBusEvent): void {
  for (const fn of listeners) fn(event);
}
