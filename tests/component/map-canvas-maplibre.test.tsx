import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from 'react-error-boundary';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no WebGL, so the real maplibre Map can't boot here. Swap in a fake,
// but keep the real GPUInitializationError so the fallback is tested against
// maplibre's actual error contract.
const { setWorkerUrl, mapBehaviour } = vi.hoisted(() => ({
  setWorkerUrl: vi.fn(),
  mapBehaviour: { throwOnConstruct: null as Error | null },
}));

vi.mock('maplibre-gl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('maplibre-gl')>();
  class FakeMap {
    constructor() {
      if (mapBehaviour.throwOnConstruct) throw mapBehaviour.throwOnConstruct;
    }
    on() {
      return this;
    }
    off() {
      return this;
    }
    once() {
      return this;
    }
    addControl() {
      return this;
    }
    remove() {}
    isStyleLoaded() {
      return true;
    }
    getMaxZoom() {
      return 5;
    }
    setMaxZoom() {}
  }
  return {
    GPUInitializationError: actual.GPUInitializationError,
    setWorkerUrl,
    Map: FakeMap,
    NavigationControl: class {},
    Marker: class {},
    addProtocol: vi.fn(),
    removeProtocol: vi.fn(),
  };
});

import { GPUInitializationError } from 'maplibre-gl';
import { MapErrorFallback } from '../../src/renderer/components/errors/ErrorFallback';
import { MapCanvas } from '../../src/renderer/components/map/MapCanvas';
import { DEFAULT_MAP_SETTINGS, type TileManifest } from '../../src/shared/types';

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
const client = { baseUrl: 'http://x', apiKey: 'k' };

function renderMap() {
  return render(
    <ErrorBoundary FallbackComponent={MapErrorFallback}>
      <MapCanvas
        client={client}
        manifest={manifest}
        settings={DEFAULT_MAP_SETTINGS}
        renderOverlays={() => null}
        persistViewport={false}
      />
    </ErrorBoundary>,
  );
}

const WEBGL2_COPY = /WebGL2 isn't available/;

describe('MapCanvas on maplibre-gl 6', () => {
  beforeEach(() => {
    mapBehaviour.throwOnConstruct = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the Vite-bundled worker when MapCanvas is imported', () => {
    // Without this call the v6 worker 404s and the map stays blank, silently.
    expect(setWorkerUrl).toHaveBeenCalledTimes(1);
    const [url] = setWorkerUrl.mock.calls[0];
    expect(url).toContain('maplibre-gl-worker');
    // `?worker&url` goes through Vite's worker pipeline (…?worker_file…); a
    // plain `?url` would ship a worker missing its shared chunk in production.
    expect(url).toContain('worker_file');
  });

  it('shows the WebGL2 fallback when the Map constructor throws GPUInitializationError', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mapBehaviour.throwOnConstruct = new GPUInitializationError({}, null);
    renderMap();
    expect(screen.getByText(WEBGL2_COPY)).toBeTruthy();
  });

  it('keeps the generic reload copy when the Map constructor throws anything else', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mapBehaviour.throwOnConstruct = new Error('boom');
    renderMap();
    expect(screen.getByText(/Reloading the map usually recovers it/)).toBeTruthy();
    expect(screen.queryByText(WEBGL2_COPY)).toBeNull();
  });
});
