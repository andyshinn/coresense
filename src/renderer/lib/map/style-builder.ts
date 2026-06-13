import { layers } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { MapSettings, TileManifest } from '../../../shared/types';
import { coresenseFlavor, hillshadeColors } from './flavors';
import { pmtilesUrl } from './pmtiles-protocol';

// Layer + source IDs the rest of the map module references. Centralized so the
// hillshade-insertion logic in Phase 7 has a single place to look up neighbors.
export const SOURCE_BASEMAP = 'protomaps';
export const SOURCE_TERRAIN = 'terrain-dem';
export const SOURCE_ONLINE = 'protomaps-online';

// External assets. The Protomaps basemaps style references named sprites and
// glyph PBFs that aren't bundled with the npm package — they live on the
// protomaps.github.io CDN. The renderer's CSP must permit them; otherwise
// glyphs/sprites silently fail and the map renders unlabeled.
//
// TODO: bundle these into resources/ for a fully offline build.
const GLYPHS_URL = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const SPRITE_BASE = 'https://protomaps.github.io/basemaps-assets/sprites/v4';

// Sprite variant ships per theme — `light` has white shield PNGs (suited for
// light maps), `dark` has dark shields (suited for dark maps).
function spriteForTheme(theme: 'light' | 'dark'): string {
  return `${SPRITE_BASE}/${theme}`;
}

// Shield text on the baked sprite PNG can't be recolored, but the *route number*
// drawn over the shield is a symbol layer's text — that we can override. Bump
// shield text contrast (and weight) so the route number reads strongly against
// whichever sprite variant we're on.
function applyShieldTextOverrides(
  inputLayers: StyleSpecification['layers'],
  theme: 'light' | 'dark',
): StyleSpecification['layers'] {
  const shieldText = theme === 'dark' ? '#f5f1e6' : '#1a1610';
  const shieldHalo = theme === 'dark' ? '#0c0a06' : '#f5f1e6';
  return inputLayers.map((l) => {
    if (l.type !== 'symbol') return l;
    const layout = l.layout as Record<string, unknown> | undefined;
    // Shields are the only symbol layers that pair icon-image with text-field.
    // Plain road-name labels have text but no icon; POI dots have icons but
    // no text. This filter targets shields specifically.
    if (!layout?.['icon-image'] || !layout?.['text-field']) return l;
    const paint = { ...((l.paint as Record<string, unknown> | undefined) ?? {}) };
    paint['text-color'] = shieldText;
    paint['text-halo-color'] = shieldHalo;
    paint['text-halo-width'] = 1;
    return { ...l, paint } as typeof l;
  });
}

export const LAYER_HILLSHADE = 'hillshade';
export const ONLINE_LAYER_SUFFIX = '_online';

// Protomaps layers we never render. `address_label` is the house-number / unit
// label layer that lights up around z=15 — useful for general-purpose maps,
// pure visual noise on a mesh-radio operations map.
const HIDDEN_LAYER_IDS = new Set(['address_label']);
// Maximum zoom the Protomaps v4 hosted API serves vector tiles for. Stays as
// the source's tile maxzoom so MapLibre stops fetching past it.
const ONLINE_MAX_ZOOM = 15;
// Camera ceiling we expose when online tiles are available. Past
// ONLINE_MAX_ZOOM, MapLibre overzooms the z=15 vector tiles — geometry stays
// crisp because vectors scale, but text/symbols get pixelated past ~17. 18 is
// a comfortable detail bump without the labels turning to mush.
const ONLINE_CAMERA_MAX_ZOOM = 18;

export interface BuildStyleOptions {
  baseUrl: string;
  manifest: TileManifest;
  settings: MapSettings;
  /** Resolved app theme; takes precedence over `settings.styleTheme` so the
   *  map always tracks the app's light/dark setting. */
  theme: 'light' | 'dark';
}

export function buildStyle({ baseUrl, manifest, settings, theme }: BuildStyleOptions): StyleSpecification {
  if (!manifest.basemap) {
    throw new Error('buildStyle requires a basemap in the manifest');
  }

  const flavor = coresenseFlavor(theme);
  const basemapLayers = applyShieldTextOverrides(
    layers(SOURCE_BASEMAP, flavor, { lang: 'en' }).filter((l) => !HIDDEN_LAYER_IDS.has(l.id)),
    theme,
  );

  const style: StyleSpecification = {
    version: 8,
    glyphs: GLYPHS_URL,
    sprite: spriteForTheme(theme),
    sources: {
      [SOURCE_BASEMAP]: {
        type: 'vector',
        url: pmtilesUrl(baseUrl, 'basemap'),
        attribution:
          '<a href="https://protomaps.com" target="_blank">Protomaps</a> © <a href="https://openstreetmap.org" target="_blank">OpenStreetMap</a>',
      },
    },
    layers: [...basemapLayers],
  };

  // Online fallback: a second vector source aliased to the proxy route on main,
  // plus a duplicate set of basemap layers bound to it. Layers above the
  // cutoff render from online, layers below from the bundled extract.
  // Terrain (hillshade + 3D) has no online counterpart — it stays bundled-only.
  // Presence of the API key is the only gate; main strips the proxied request
  // when no key exists.
  if (settings.hasProtomapsApiKey) {
    const cutoff = manifest.basemap.maxZoom;
    // Cap each bundled layer so MapLibre doesn't try to over-zoom the PMTiles
    // (which has no tiles past maxZoom).
    style.layers = style.layers.map((l) => ({ ...l, maxzoom: cutoff + 1 }));
    style.sources[SOURCE_ONLINE] = {
      type: 'vector',
      tiles: [`${baseUrl}/api/map/online-tile-proxy/basemap/{z}/{x}/{y}`],
      minzoom: cutoff,
      maxzoom: ONLINE_MAX_ZOOM,
    };
    const onlineLayers = basemapLayers.map((l) => ({
      ...l,
      id: `${l.id}${ONLINE_LAYER_SUFFIX}`,
      source: SOURCE_ONLINE,
      minzoom: cutoff,
    }));
    style.layers.push(...onlineLayers);
  }

  if (manifest.terrain) {
    style.sources[SOURCE_TERRAIN] = {
      type: 'raster-dem',
      url: pmtilesUrl(baseUrl, 'terrain'),
      tileSize: 512,
      encoding: 'mapbox',
      attribution: '<a href="https://download.mapterhorn.com" target="_blank">Mapterhorn</a>',
    };
    insertHillshade(style, settings.terrainHillshadeEnabled, theme);
  }

  return style;
}

/** Cap the map's maxZoom based on whether online fallback can extend coverage.
 *  When the online source is in use we lift the camera ceiling above the tile
 *  maxzoom so MapLibre overzooms — vector geometry stays sharp under scaling. */
export function maxZoomForSettings(manifest: TileManifest, settings: MapSettings): number {
  const bundled = manifest.basemap?.maxZoom ?? 0;
  return settings.hasProtomapsApiKey ? ONLINE_CAMERA_MAX_ZOOM : bundled;
}

// Insert the hillshade paint layer over land/water but under roads + labels so
// road colors and label haloes win when they coincide. Done with a single
// search for the first id starting with `roads_` to keep the @protomaps/basemaps
// schema as the source of truth.
function insertHillshade(style: StyleSpecification, visible: boolean, theme: 'light' | 'dark'): void {
  const insertBefore = style.layers.findIndex((l) => l.id.startsWith('roads_'));
  const colors = hillshadeColors(theme);
  const layer = {
    id: LAYER_HILLSHADE,
    type: 'hillshade' as const,
    source: SOURCE_TERRAIN,
    layout: { visibility: visible ? ('visible' as const) : ('none' as const) },
    paint: {
      'hillshade-exaggeration': colors.exaggeration,
      'hillshade-shadow-color': colors.shadow,
      'hillshade-highlight-color': colors.highlight,
    },
  };
  if (insertBefore < 0) {
    style.layers.push(layer);
  } else {
    style.layers.splice(insertBefore, 0, layer);
  }
}
