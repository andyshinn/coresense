import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useStore } from '../../lib/store';

interface Props {
  map: MapLibreMap | null;
}

const SIZE = 22;

// "YOU" badge for the local radio. Distinct from any user marker — double pulse
// rings around an amber dot with the letters "YOU" centered. No-ops when the
// local radio doesn't advertise a position.
export function MapLocalNode({ map }: Props) {
  const lat = useStore((s) => s.deviceIdentity.lat);
  const lon = useStore((s) => s.deviceIdentity.lon);

  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!map) return;
    const hasFix = typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0);
    if (!hasFix) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    if (!markerRef.current) {
      const el = document.createElement('div');
      el.className = 'cs-map-local';
      el.setAttribute('aria-label', 'You are here');
      el.innerHTML = `
        <svg width="${SIZE + 16}" height="${SIZE + 16}" viewBox="0 0 ${SIZE + 16} ${SIZE + 16}" aria-hidden="true">
          <circle cx="${(SIZE + 16) / 2}" cy="${(SIZE + 16) / 2}" r="${(SIZE + 12) / 2}" fill="none" stroke="#f59e0b" stroke-width="1" opacity="0.35" />
          <circle cx="${(SIZE + 16) / 2}" cy="${(SIZE + 16) / 2}" r="${(SIZE + 4) / 2}" fill="none" stroke="#f59e0b" stroke-width="1.2" opacity="0.7" />
          <circle cx="${(SIZE + 16) / 2}" cy="${(SIZE + 16) / 2}" r="${SIZE / 2 - 2}" fill="#f59e0b" stroke="#0c0a06" stroke-width="1.5" />
          <text x="${(SIZE + 16) / 2}" y="${(SIZE + 16) / 2 + 3}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="8" font-weight="700" fill="#0c0a06">YOU</text>
        </svg>
      `;
      markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lon, lat])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([lon, lat]);
    }
  }, [map, lat, lon]);

  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, []);

  return null;
}
