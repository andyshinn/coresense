import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import type { Contact } from '../../../shared/types';
import type { ResolvedNeighbour } from '../../lib/neighbours';
import { buildContactMarker, type MarkerState, syncMarkerVisual } from './markers/markerHtml';
import {
  buildNeighbourLinkFeatures,
  computeNeighbourBounds,
  type FocalPoint,
} from './neighbourLinks';

const LINK_SOURCE = 'neighbour-links-src';
const LINK_LAYER = 'neighbour-links';

interface FocalRepeater {
  lat: number;
  lon: number;
  name: string;
}

interface NeighbourMapLayerProps {
  map: MapLibreMap | null;
  focal: FocalRepeater;
  // All displayed neighbours (located + off-map). Only located ones are plotted.
  neighbours: ResolvedNeighbour[];
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

// Minimal Contact shape for the marker builder — it only reads name/kind/key.
function markerContact(n: ResolvedNeighbour): Contact {
  return {
    key: n.contactKey ?? `nb:${n.pubKeyPrefixHex}`,
    publicKeyHex: n.pubKeyPrefixHex,
    name: n.name,
    kind: 'repeater',
  } as Contact;
}

// Focal repeater marker — distinct double-ring + persistent label. Inline
// styles keep it self-contained (no extra CSS file).
function buildFocalElement(name: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.alignItems = 'center';
  el.style.gap = '4px';
  el.style.pointerEvents = 'none';
  el.innerHTML = `
    <svg width="50" height="50" viewBox="0 0 50 50" aria-hidden="true">
      <circle cx="25" cy="25" r="23" fill="none" stroke="#f59e0b" stroke-width="1" opacity="0.3" />
      <circle cx="25" cy="25" r="18" fill="none" stroke="#f59e0b" stroke-width="1.4" opacity="0.75" />
      <rect x="16" y="16" width="18" height="18" rx="3" fill="#84cc16" stroke="#0c0a06" stroke-width="1.5" />
    </svg>`;
  const label = document.createElement('span');
  label.textContent = name;
  label.style.background = 'rgba(12,10,6,0.92)';
  label.style.border = '1px solid #f59e0b';
  label.style.color = '#f5f1e6';
  label.style.font = '600 11px Inter, system-ui, sans-serif';
  label.style.padding = '3px 8px';
  label.style.borderRadius = '4px';
  label.style.whiteSpace = 'nowrap';
  label.style.boxShadow = '0 2px 8px rgba(0,0,0,.6)';
  el.appendChild(label);
  return el;
}

export function NeighbourMapLayer({
  map,
  focal,
  neighbours,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
}: NeighbourMapLayerProps) {
  const located = useMemo(
    () => neighbours.filter((n) => n.located && n.lat != null && n.lon != null),
    [neighbours],
  );
  const activeId = hoveredId ?? selectedId;
  const focalPoint: FocalPoint = { lat: focal.lat, lon: focal.lon };

  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const focalMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Read current selection inside the (create-once) marker click handler without
  // capturing a stale value.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const renderRef = useRef<() => void>(() => {});

  const stateFor = (id: string): MarkerState => ({
    selected: selectedId === id,
    faded: activeId != null && activeId !== id,
    stale: false,
    showLabel: false,
  });

  renderRef.current = () => {
    if (!map) return;

    const src = map.getSource(LINK_SOURCE) as GeoJSONSource | undefined;
    if (src) src.setData(buildNeighbourLinkFeatures(focalPoint, located, activeId));

    const markers = markersRef.current;
    const wanted = new Set<string>();
    for (const n of located) {
      const id = n.pubKeyPrefixHex;
      wanted.add(id);
      const lngLat: [number, number] = [n.lon as number, n.lat as number];
      const existing = markers.get(id);
      if (existing) {
        existing.setLngLat(lngLat);
        syncMarkerVisual(existing.getElement(), markerContact(n), stateFor(id), null);
      } else {
        const el = buildContactMarker(markerContact(n), stateFor(id));
        el.addEventListener('mouseenter', () => onHover(id));
        el.addEventListener('mouseleave', () => onHover(null));
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelect(selectedIdRef.current === id ? null : id);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(lngLat)
          .addTo(map);
        markers.set(id, marker);
      }
    }
    for (const [id, marker] of markers) {
      if (!wanted.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    if (!focalMarkerRef.current) {
      focalMarkerRef.current = new maplibregl.Marker({
        element: buildFocalElement(focal.name),
        anchor: 'center',
      })
        .setLngLat([focal.lon, focal.lat])
        .addTo(map);
    } else {
      focalMarkerRef.current.setLngLat([focal.lon, focal.lat]);
      // Keep the label current if the focal repeater's name was edited.
      const label = focalMarkerRef.current.getElement().querySelector('span');
      if (label && label.textContent !== focal.name) label.textContent = focal.name;
    }
  };

  // Install the link source + layer once the style is ready; retry on styledata
  // (also re-installs after setStyle theme flips, which wipe custom layers).
  useEffect(() => {
    if (!map) return;
    const install = () => {
      try {
        if (!map.getSource(LINK_SOURCE)) {
          map.addSource(LINK_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }
        if (!map.getLayer(LINK_LAYER)) {
          map.addLayer({
            id: LINK_LAYER,
            type: 'line',
            source: LINK_SOURCE,
            layout: { 'line-cap': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': ['get', 'width'],
              'line-opacity': ['get', 'opacity'],
              'line-dasharray': [2, 1.5],
            },
          });
        }
        renderRef.current();
      } catch {
        // Style not ready yet; the next styledata will re-attempt.
      }
    };
    install();
    map.on('styledata', install);
    return () => {
      map.off('styledata', install);
    };
  }, [map]);

  // Re-render markers + links when data or hover/selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderRef reads current values; these are triggers
  useEffect(() => {
    if (!map) return;
    renderRef.current();
  }, [map, located, selectedId, hoveredId, focal.lat, focal.lon, focal.name]);

  // Frame focal + located neighbours when the located SET (or focal) changes —
  // not on hover/select.
  const boundsKey = useMemo(
    () => `${located.map((n) => n.pubKeyPrefixHex).join(',')}|${focal.lat},${focal.lon}`,
    [located, focal.lat, focal.lon],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fit only when boundsKey changes
  useEffect(() => {
    if (!map) return;
    const bounds = computeNeighbourBounds(focalPoint, located);
    if (!bounds) return;
    const [[w, s], [e, n]] = bounds;
    if (w === e && s === n) {
      map.easeTo({ center: [w, s], zoom: Math.max(map.getZoom(), 12), duration: 300 });
    } else {
      map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 300 });
    }
  }, [map, boundsKey]);

  // Tear down markers + layer/source on unmount.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
      focalMarkerRef.current?.remove();
      focalMarkerRef.current = null;
      if (map) {
        if (map.getLayer(LINK_LAYER)) map.removeLayer(LINK_LAYER);
        if (map.getSource(LINK_SOURCE)) map.removeSource(LINK_SOURCE);
      }
    };
  }, [map]);

  if (neighbours.length === 0) return null;
  const offMap = neighbours.length - located.length;
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 5,
        padding: '6px 13px',
        borderRadius: 999,
        background: 'rgba(8,30,38,0.82)',
        border: '1px solid rgba(34,211,238,0.32)',
        color: '#9ddfeb',
        font: '12px Inter, system-ui, sans-serif',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 14px rgba(0,0,0,.4)',
        backdropFilter: 'blur(8px)',
      }}
    >
      Showing <b style={{ color: '#cdeef4' }}>{located.length}</b> of {neighbours.length} neighbours
      {offMap > 0 ? ` · ${offMap} off-map` : ''}
    </div>
  );
}
