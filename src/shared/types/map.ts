// Map settings and the tile manifest/cache shapes.

import type { ContactKind } from './domain';

/** Bundled vector basemap source for the Map panel.
 *  The renderer fetches tiles via the local Hono server (`/api/tiles/:source`)
 *  using HTTP Range requests; the manifest summarizes the extract's header. */
export type TileSource = 'basemap';

export interface TileManifestEntry {
  source: TileSource;
  bytes: number;
  minZoom: number;
  maxZoom: number;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  center: { lng: number; lat: number; zoom: number };
  /** PMTiles tileType enum (0=Unknown, 1=Mvt, 2=Png, 3=Jpeg, 4=Webp, 5=Avif). */
  tileType: number;
}

export interface TileManifest {
  /** True when the bundled basemap is not available on disk — the Map panel
   *  renders an empty-state with instructions instead of mounting MapLibre. */
  missing: boolean;
  basemap: TileManifestEntry | null;
}

export interface TileCacheInfo {
  /** Total bytes of cached online tiles on disk. */
  bytes: number;
  /** Number of cached tile files. */
  count: number;
}

export interface MapSettings {
  /** Derived from the existence of the encrypted blob on disk; never written
   *  by the renderer. When true, the renderer extends the map past the bundled
   *  extract's maxZoom by proxying tiles from the Protomaps hosted API through
   *  main (the API key never leaves main). */
  hasProtomapsApiKey: boolean;
  /** Which @protomaps/basemaps flavor to compose. Follows the app theme by default. */
  styleTheme: 'light' | 'dark';
  /** Deprecated — superseded by `lastHeardHours` + `staleFadeEnabled`. Kept on
   *  the type so older persisted settings deserialise without losing keys. */
  staleFadeDays: number;
  /** Markers from contacts not heard in the last N hours are either faded
   *  (`staleFadeEnabled = true`) or hidden (`= false`). UI slider runs 1..720
   *  (= 1h..30d). */
  lastHeardHours: number;
  /** When true, contacts older than `lastHeardHours` render faded; when false,
   *  they're hidden entirely. */
  staleFadeEnabled: boolean;
  /** Per-kind filter — when `false`, that kind's markers are hidden from the map. */
  kindFilters: Record<ContactKind, boolean>;
  /** Only show contacts with `pinned = true`. Contact.pinned is never written,
   *  so this currently hides every contact (#47). */
  favouritesOnly: boolean;
  /** Combine nearby markers into a type-breakdown donut when zoomed out. */
  clusteringEnabled: boolean;
  /** Force the light basemap flavor even when the app theme is dark. */
  lightBasemap: boolean;
  /** Contacts within this many meters collapse into a single horizontal chip-row
   *  marker ("co-located site"). */
  coLocationMeters: number;
  /** Show the contact's name as a small label next to each marker. */
  showMarkerLabels: boolean;
  /** On-disk cap (bytes) for cached online tiles. Clamped server-side to
   *  [64 MB, 5 GB]. Default 512 MB. */
  tileCacheMaxBytes: number;
  /** Persisted viewport so the Map panel re-opens where the user left off. */
  lastCenter?: { lng: number; lat: number };
  lastZoom?: number;
  lastBearing?: number;
  lastPitch?: number;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  hasProtomapsApiKey: false,
  styleTheme: 'light',
  staleFadeDays: 7,
  lastHeardHours: 24,
  staleFadeEnabled: true,
  kindFilters: { chat: true, repeater: true, room: true, sensor: true },
  favouritesOnly: false,
  clusteringEnabled: true,
  lightBasemap: false,
  coLocationMeters: 150,
  showMarkerLabels: false,
  tileCacheMaxBytes: 512 * 1024 * 1024,
};

/** Runtime status of online tile access — not a user setting, not persisted.
 *  `keyConfigured` mirrors the encrypted-blob presence; `keyRejected` flips
 *  when Protomaps rejects the key (401/403) and clears on the next success. */
export interface MapTileStatus {
  keyConfigured: boolean;
  keyRejected: boolean;
}

export const DEFAULT_MAP_TILE_STATUS: MapTileStatus = {
  keyConfigured: false,
  keyRejected: false,
};
