import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { type Contact, type ContactKind, hasValidFix } from '../../../shared/types';
import { useStore } from '../../lib/store';

interface Props {
  map: MapLibreMap | null;
}

const DAY_MS = 86_400_000;

// Inline lucide path data so we can render the icon as a static SVG string
// without mounting a React root per marker. Copied verbatim from lucide-static
// 0.x — these are stable, schema-versioned in lucide.
const ICON_PATHS: Record<ContactKind, string> = {
  chat: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  repeater:
    '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/>',
  sensor: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  room: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
};

// CSS-var colors keyed to Contact.kind. Wrapped in rgb() because the tokens
// are stored as space-separated triplets (see index.css).
const KIND_COLOR: Record<ContactKind, string> = {
  chat: 'rgb(var(--cs-accent))',
  repeater: 'rgb(var(--cs-online))',
  sensor: 'rgb(var(--cs-warn))',
  room: 'rgb(var(--cs-text-muted))',
};

function buildElement(
  contact: Contact,
  selected: boolean,
  faded: boolean,
  showLabel: boolean,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', `${contact.name} (${contact.kind})`);
  btn.dataset.contactKey = contact.key;
  btn.className = 'coresense-map-marker';
  if (selected) btn.classList.add('is-selected');
  if (faded) btn.classList.add('is-faded');
  if (!showLabel) btn.classList.add('no-label');
  btn.style.setProperty('--marker-color', KIND_COLOR[contact.kind]);
  // textContent on a separate element so contact names with HTML-significant
  // characters (e.g. <, &) don't break the markup or open injection paths.
  const html = `
    <span class="marker-pin">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${ICON_PATHS[contact.kind]}
      </svg>
    </span>
    <span class="marker-label"></span>
  `;
  btn.innerHTML = html;
  const label = btn.querySelector<HTMLSpanElement>('.marker-label');
  if (label) label.textContent = contact.name;
  return btn;
}

// Diffs markers against the current contact list — adds new, removes gone,
// updates only the per-marker state (selection ring, fade) on existing ones.
// Avoids tearing down DOM on every store update.
export function MapMarkers({ map }: Props) {
  const contacts = useStore((s) => s.contacts);
  const staleFadeDays = useStore((s) => s.mapSettings.staleFadeDays);
  const showLabels = useStore((s) => s.mapSettings.showMarkerLabels);
  const selectedContactKey = useStore((s) => s.ui.selectedContactKey);
  const setSelectedContact = useStore((s) => s.setSelectedContact);

  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  useEffect(() => {
    if (!map) return;
    const cache = markersRef.current;
    const now = Date.now();
    const fadeThresholdMs = staleFadeDays > 0 ? staleFadeDays * DAY_MS : Infinity;

    const wanted = new Set<string>();
    for (const c of contacts) {
      if (!hasValidFix(c)) continue;
      wanted.add(c.key);
      const isSelected = c.key === selectedContactKey;
      const isFaded = typeof c.lastSeenMs === 'number' && now - c.lastSeenMs > fadeThresholdMs;
      const existing = cache.get(c.key);
      if (existing) {
        // Keep the marker; just sync coords + per-render state.
        existing.setLngLat([c.gpsLon, c.gpsLat]);
        const el = existing.getElement();
        el.classList.toggle('is-selected', isSelected);
        el.classList.toggle('is-faded', isFaded);
        el.classList.toggle('no-label', !showLabels);
        const label = el.querySelector<HTMLSpanElement>('.marker-label');
        // Re-sync the label text in case the contact was renamed.
        if (label && label.textContent !== c.name) label.textContent = c.name;
      } else {
        const el = buildElement(c, isSelected, isFaded, showLabels);
        el.addEventListener('click', (e) => {
          // Don't let the click bubble to the map (which would deselect via
          // any global "click on empty space" handler we add later).
          e.stopPropagation();
          setSelectedContact(c.key);
        });
        // anchor: 'center' pins the pin's center to the geographic coord.
        // The label hangs below via absolute positioning (see index.css) so it
        // doesn't shift the marker's effective anchor regardless of name length.
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([c.gpsLon, c.gpsLat])
          .addTo(map);
        cache.set(c.key, marker);
      }
    }

    // Remove markers for contacts that lost their fix or were deleted.
    for (const [key, marker] of cache) {
      if (!wanted.has(key)) {
        marker.remove();
        cache.delete(key);
      }
    }
  }, [map, contacts, staleFadeDays, showLabels, selectedContactKey, setSelectedContact]);

  // Tear down on unmount — handles panel switch + dev HMR cleanly.
  useEffect(() => {
    const cache = markersRef.current;
    return () => {
      for (const marker of cache.values()) marker.remove();
      cache.clear();
    };
  }, []);

  return null;
}
