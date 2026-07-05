import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { hasValidFix, type MapSettings, type TileManifest } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { log } from '../../lib/logger';
import { subscribe as subscribeMapBus } from '../../lib/map/bus';
import { ensurePmtilesProtocol } from '../../lib/map/pmtiles-protocol';
import { buildStyle, maxZoomForSettings } from '../../lib/map/style-builder';
import { useStore } from '../../lib/store';
import { resolveTheme } from '../../lib/theme';
import { MapClusters } from './MapClusters';
import { MapInfo } from './MapInfo';
import { MapLocalNode } from './MapLocalNode';

const mapLog = log.getSubLogger({ name: 'map' });

const VIEWPORT_PERSIST_DEBOUNCE_MS = 500;

// Default overlay stack — the standard Map View layers. Module-scope so the
// component doesn't allocate a fresh function on every render.
const defaultOverlays = (map: MapLibreMap | null) => (
  <>
    <MapClusters map={map} />
    <MapLocalNode map={map} />
    <MapInfo map={map} />
  </>
);

interface MapCanvasProps {
  client: ApiClient;
  manifest: TileManifest;
  settings: MapSettings;
  // Optional overlay renderer — defaults to the standard clusters/local/info
  // stack. A focused view (e.g. repeater neighbours) passes its own layer.
  renderOverlays?: (map: MapLibreMap | null) => ReactNode;
  // When false, the moveend/zoom persistence effect is skipped (transient
  // sub-maps must not overwrite the Map View's saved viewport).
  persistViewport?: boolean;
  // Initial camera. Defaults to pickInitialView (persisted viewport / freshest
  // contact / extract centre).
  initialView?: InitialView;
}

export function MapCanvas({
  client,
  manifest,
  settings,
  renderOverlays,
  persistViewport = true,
  initialView,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Mirror the ref into state so child components (MapInfo) can subscribe to
  // the instance — ref mutations don't trigger re-renders on their own.
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  // Map flavor follows the resolved app theme (light/dark), not the persisted
  // mapSettings.styleTheme — that field stays in the type as a future override.
  const themePref = useStore((s) => s.ui.themePref);
  const systemDark = useStore((s) => s.systemDark);
  // `settings.lightBasemap` is an explicit user override that wins over the
  // theme-derived flavor — useful when reading the map outdoors with a dark
  // app theme.
  const theme: 'light' | 'dark' = settings.lightBasemap ? 'light' : resolveTheme(themePref, systemDark);

  // Mount-once on purpose. Style/source/layer updates in later phases will
  // happen via map.setStyle / map.addSource on the existing instance rather
  // than re-creating the canvas — including deps would re-instantiate the
  // map on every settings change and discard the user's viewport.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once is intentional
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    if (!manifest.basemap) return;

    ensurePmtilesProtocol(client);

    const initial = initialView ?? pickInitialView(manifest, settings);
    const map = new maplibregl.Map({
      container,
      style: buildStyle({ baseUrl: client.baseUrl, manifest, settings, theme }),
      center: initial.center,
      zoom: initial.zoom,
      bearing: initial.bearing,
      pitch: initial.pitch,
      maxZoom: maxZoomForSettings(manifest, settings),
      // Attach the API-key Bearer header to every request hitting our own
      // server. PMTiles uses its own protocol with its own Headers; this
      // catches the online tile proxy and any future locally-served URL.
      transformRequest: (url) => {
        if (url.startsWith(client.baseUrl)) {
          return { url, headers: { Authorization: `Bearer ${client.apiKey}` } };
        }
        return { url };
      },
    });
    mapRef.current = map;
    setMapInstance(map);

    // Forward MapLibre's internal errors (tile fetch failures, style parse
    // errors, source errors) into tslog. MapLibre only logs to console.error
    // when no `error` handler is attached, so without this they never reach
    // our log pipeline. The ErrorEvent type only exposes `.error`, but the
    // runtime event carries extra context (sourceId, tile, status) attached
    // via the second arg to its constructor — read those off loosely.
    map.on('error', (e) => {
      const extra = e as unknown as {
        sourceId?: string;
        tile?: { tileID?: { canonical?: { z: number; x: number; y: number } } };
        status?: number;
        url?: string;
      };
      const ctx: Record<string, unknown> = {};
      if (extra.sourceId) ctx.sourceId = extra.sourceId;
      if (extra.status != null) ctx.status = extra.status;
      if (extra.url) ctx.url = extra.url;
      const c = extra.tile?.tileID?.canonical;
      if (c) ctx.tile = { z: c.z, x: c.x, y: c.y };
      mapLog.error(e.error?.message ?? 'map error', ctx, e.error);
    });

    // MapLibre's built-in pan/zoom/pitch/compass cluster. `visualizePitch`
    // rotates the compass to show the current pitch — useful once 3D is on.
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

    return () => {
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, []);

  // Online fallback adds a second source + duplicated layers; can't be done
  // surgically, so we rebuild the style. setStyle preserves the viewport.
  const firstStyleRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild only on fallback/theme flips, not on every settings tick
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstStyleRef.current) {
      firstStyleRef.current = false;
      return;
    }
    const apply = () => {
      map.setStyle(buildStyle({ baseUrl: client.baseUrl, manifest, settings, theme }));
    };
    // Wait for the previous style to finish loading; calling setStyle mid-load
    // forces MapLibre to discard its diff path and rebuild from scratch (the
    // "Style is not done loading" warning).
    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
  }, [settings.hasProtomapsApiKey, theme, manifest, client.baseUrl]);

  // Keep the map's max-zoom in sync with whether the online fallback can
  // extend coverage past the bundled extract. Decoupled from the setStyle
  // effect so it applies whether or not the style is mid-load — and so we
  // can't accidentally regress by reshuffling the call order above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cap = maxZoomForSettings(manifest, settings);
    if (map.getMaxZoom() !== cap) map.setMaxZoom(cap);
  }, [manifest, settings.hasProtomapsApiKey, settings]);

  // Listen for imperative commands from other parts of the UI (RightRail's
  // "Center on map" button publishes flyTo events on the bus). Decoupled from
  // the store so the global state doesn't have to carry transient camera commands.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return subscribeMapBus((e) => {
      if (e.kind === 'flyTo') {
        map.flyTo({ center: [e.lng, e.lat], zoom: e.zoom ?? map.getZoom() });
      }
    });
  }, []);

  // Persist the viewport after the user stops interacting. Debounced so a
  // drag that fires hundreds of move events doesn't beat the IPC into the
  // ground — we only care about the resting position. Compare to the last
  // persisted values to skip no-op writes (e.g. clicks that don't move the map).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!persistViewport) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const center = map.getCenter();
      const zoom = map.getZoom();
      const bearing = map.getBearing();
      const pitch = map.getPitch();
      const current = useStore.getState().mapSettings;
      if (
        current.lastCenter?.lng === center.lng &&
        current.lastCenter?.lat === center.lat &&
        current.lastZoom === zoom &&
        current.lastBearing === bearing &&
        current.lastPitch === pitch
      ) {
        return;
      }
      const next: MapSettings = {
        ...current,
        lastCenter: { lng: center.lng, lat: center.lat },
        lastZoom: zoom,
        lastBearing: bearing,
        lastPitch: pitch,
      };
      useStore.getState().applyMapSettings(next);
      void api.putMapSettings(client, next);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, VIEWPORT_PERSIST_DEBOUNCE_MS);
    };
    map.on('moveend', schedule);
    map.on('zoomend', schedule);
    map.on('rotateend', schedule);
    map.on('pitchend', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      map.off('moveend', schedule);
      map.off('zoomend', schedule);
      map.off('rotateend', schedule);
      map.off('pitchend', schedule);
    };
  }, [client, persistViewport]);

  const overlays = renderOverlays ?? defaultOverlays;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {overlays(mapInstance)}
    </div>
  );
}

export interface InitialView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

function freshestContactFix(): { lng: number; lat: number } | null {
  // One-shot snapshot read — `pickInitialView` runs at mount only, so we don't
  // need a store subscription. Find the contact with a non-zero fix and the
  // most recent lastSeenMs.
  const contacts = useStore.getState().contacts;
  let best: { lng: number; lat: number; t: number } | null = null;
  for (const c of contacts) {
    if (!hasValidFix(c)) continue;
    const t = c.lastSeenMs ?? 0;
    if (!best || t > best.t) best = { lng: c.gpsLon, lat: c.gpsLat, t };
  }
  return best ? { lng: best.lng, lat: best.lat } : null;
}

function pickInitialView(manifest: TileManifest, settings: MapSettings): InitialView {
  // Priority:
  //  1. Persisted viewport (user left off here last time).
  //  2. Newest contact fix (radio location we just heard from).
  //  3. Bundled extract center.
  if (settings.lastCenter && settings.lastZoom != null) {
    return {
      center: [settings.lastCenter.lng, settings.lastCenter.lat],
      zoom: settings.lastZoom,
      bearing: settings.lastBearing ?? 0,
      pitch: settings.lastPitch ?? 0,
    };
  }
  const freshest = freshestContactFix();
  if (freshest) {
    return { center: [freshest.lng, freshest.lat], zoom: 12, bearing: 0, pitch: 0 };
  }
  const center: [number, number] = manifest.basemap ? [manifest.basemap.center.lng, manifest.basemap.center.lat] : [0, 0];
  const zoom = manifest.basemap?.center.zoom ?? manifest.basemap?.minZoom ?? 2;
  return {
    center,
    zoom,
    bearing: settings.lastBearing ?? 0,
    pitch: settings.lastPitch ?? 0,
  };
}
