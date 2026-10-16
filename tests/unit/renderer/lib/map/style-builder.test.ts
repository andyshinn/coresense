import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import styleSpecPkg from '@maplibre/maplibre-gl-style-spec/package.json';
import maplibrePkg from 'maplibre-gl/package.json';
import semver from 'semver';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/map/pmtiles-protocol', () => ({
  pmtilesUrl: (baseUrl: string, source: string) => `pmtiles://${baseUrl}/api/tiles/${source}`,
}));

import { buildStyle, maxZoomFor, SOURCE_BASEMAP, SOURCE_ONLINE } from '../../../../../src/renderer/lib/map/style-builder';
import type { TileManifest } from '../../../../../src/shared/types';

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

describe('buildStyle', () => {
  it('has no terrain source or hillshade layer', () => {
    const style = buildStyle({ baseUrl: 'http://x', manifest, theme: 'light', onlineTiles: false });
    expect(style.sources['terrain-dem']).toBeUndefined();
    expect(style.layers.some((l) => l.type === 'hillshade')).toBe(false);
    expect(style.sources[SOURCE_BASEMAP]).toBeDefined();
  });

  it('adds the online source only when a key is configured', () => {
    const withoutKey = buildStyle({ baseUrl: 'http://x', manifest, theme: 'light', onlineTiles: false });
    expect(withoutKey.sources[SOURCE_ONLINE]).toBeUndefined();
    const withKey = buildStyle({ baseUrl: 'http://x', manifest, theme: 'light', onlineTiles: true });
    expect(withKey.sources[SOURCE_ONLINE]).toBeDefined();
  });

  it('validates against the style-spec version maplibre-gl itself uses', () => {
    // maplibre-gl bundles its own style-spec, so a maplibre bump that moves to a
    // new style-spec major would leave our devDependency validating against the
    // old rules without any install-time complaint.
    const range = maplibrePkg.dependencies['@maplibre/maplibre-gl-style-spec'];
    expect(semver.satisfies(styleSpecPkg.version, range)).toBe(true);
  });

  it.each([
    ['light', false],
    ['light', true],
    ['dark', false],
    ['dark', true],
  ] as const)('builds a spec-valid style (theme=%s, online=%s)', (theme, onlineTiles) => {
    const style = buildStyle({ baseUrl: 'http://x', manifest, theme, onlineTiles });
    // Since style-spec 25, legacy-filter problems come back as warning-severity
    // entries that maplibre only console.warns at runtime — fail on any entry.
    expect(validateStyleMin(style)).toEqual([]);
  });

  it('caps the camera near the bundled maxzoom without a key and at 18 with one', () => {
    expect(maxZoomFor(manifest, false)).toBe(5);
    expect(maxZoomFor(manifest, true)).toBe(18);
  });
});
