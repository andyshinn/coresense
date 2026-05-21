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

// When an event is published with no live subscriber (e.g. "Center on map" is
// clicked while the Map panel is closed), stash it so the MapCanvas can replay
// it the moment it mounts and subscribes. A short TTL keeps a stale command
// from firing if the user later opens the map on their own.
const PENDING_TTL_MS = 5000;
let pending: { event: MapBusEvent; at: number } | null = null;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  if (pending) {
    const fresh = Date.now() - pending.at < PENDING_TTL_MS;
    const event = pending.event;
    pending = null;
    if (fresh) fn(event);
  }
  return () => {
    listeners.delete(fn);
  };
}

export function publish(event: MapBusEvent): void {
  if (listeners.size === 0) {
    pending = { event, at: Date.now() };
    return;
  }
  for (const fn of listeners) fn(event);
}
