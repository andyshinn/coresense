import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/map/pmtiles-protocol', () => ({
  pmtilesUrl: (baseUrl: string, source: string) => `pmtiles://${baseUrl}/api/tiles/${source}`,
}));

import {
  buildStyle,
  maxZoomForSettings,
  SOURCE_BASEMAP,
  SOURCE_ONLINE,
} from '../../../../../src/renderer/lib/map/style-builder';
import { DEFAULT_MAP_SETTINGS, type MapSettings, type TileManifest } from '../../../../../src/shared/types';

const manifest: TileManifest = {
  missing: false,
  basemap: {
    source: 'basemap',
    bytes: 14_000_000,
    minZoom: 0,
    maxZoom: 5,
    bounds: [-180, -85, 180, 85],
    center: { lng: 0, lat: 0, zoom: 2 },
    tileType: 1,
  },
};
const settings = (over: Partial<MapSettings> = {}): MapSettings => ({ ...DEFAULT_MAP_SETTINGS, ...over });

describe('buildStyle', () => {
  it('has no terrain source or hillshade layer', () => {
    const style = buildStyle({ baseUrl: 'http://x', manifest, settings: settings(), theme: 'light' });
    expect(style.sources['terrain-dem']).toBeUndefined();
    expect(style.layers.some((l) => l.type === 'hillshade')).toBe(false);
    expect(style.sources[SOURCE_BASEMAP]).toBeDefined();
  });

  it('adds the online source only when a key is configured', () => {
    const withoutKey = buildStyle({
      baseUrl: 'http://x',
      manifest,
      settings: settings({ hasProtomapsApiKey: false }),
      theme: 'light',
    });
    expect(withoutKey.sources[SOURCE_ONLINE]).toBeUndefined();
    const withKey = buildStyle({
      baseUrl: 'http://x',
      manifest,
      settings: settings({ hasProtomapsApiKey: true }),
      theme: 'light',
    });
    expect(withKey.sources[SOURCE_ONLINE]).toBeDefined();
  });

  it('caps the camera near the bundled maxzoom without a key and at 18 with one', () => {
    expect(maxZoomForSettings(manifest, settings({ hasProtomapsApiKey: false }))).toBe(5);
    expect(maxZoomForSettings(manifest, settings({ hasProtomapsApiKey: true }))).toBe(18);
  });
});
