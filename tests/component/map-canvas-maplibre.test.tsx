import { act, render, screen } from '@testing-library/react';
import { ErrorBoundary } from 'react-error-boundary';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no WebGL, so the real maplibre Map can't boot here. Swap in a fake
// that records listeners and style calls, but keep the real
// GPUInitializationError so the fallback is tested against maplibre's actual
// error contract.
type Listener = (e?: unknown) => void;
const { setWorkerUrl, fake } = vi.hoisted(() => ({
  setWorkerUrl: vi.fn(),
  fake: {
    throwOnConstruct: null as Error | null,
    // What getStyle() returns: undefined until the style JSON is parsed.
    parsedStyle: {} as { sprite?: unknown } | undefined,
    listeners: new Map<string, Set<Listener>>(),
    setStyle: vi.fn(),
    // Sprite downloads in start order — the initial style's first, then one per
    // sprite-changing setStyle — mirroring maplibre's private Style._spriteRequest.
    spriteRequests: [] as AbortController[],
  },
}));

vi.mock('maplibre-gl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('maplibre-gl')>();
  const add = (type: string, fn: Listener) => {
    if (!fake.listeners.has(type)) fake.listeners.set(type, new Set());
    fake.listeners.get(type)?.add(fn);
  };
  class FakeMap {
    style: { _spriteRequest: AbortController | null } = { _spriteRequest: null };
    constructor() {
      if (fake.throwOnConstruct) throw fake.throwOnConstruct;
      this.startSpriteDownload();
    }
    startSpriteDownload() {
      const request = new AbortController();
      // maplibre's quirk: an aborted download's `finally` nulls
      // `_spriteRequest` a tick later, even when a newer one has replaced it.
      request.signal.addEventListener('abort', () =>
        queueMicrotask(() => {
          this.style._spriteRequest = null;
        }),
      );
      this.style._spriteRequest = request;
      fake.spriteRequests.push(request);
    }
    on(type: string, fn: Listener) {
      add(type, fn);
      return this;
    }
    once(type: string, fn: Listener) {
      const wrapped: Listener = (e) => {
        fake.listeners.get(type)?.delete(wrapped);
        fn(e);
      };
      // Keep a handle so off(type, fn) can find the wrapper, as maplibre does.
      (wrapped as Listener & { original?: Listener }).original = fn;
      add(type, wrapped);
      return this;
    }
    off(type: string, fn: Listener) {
      for (const l of fake.listeners.get(type) ?? []) {
        if (l === fn || (l as Listener & { original?: Listener }).original === fn) fake.listeners.get(type)?.delete(l);
      }
      return this;
    }
    addControl() {
      return this;
    }
    remove() {}
    getStyle() {
      return fake.parsedStyle;
    }
    // Tiles are always "still loading" here: the old isStyleLoaded() gate
    // would never let a restyle through.
    isStyleLoaded() {
      return false;
    }
    setStyle(style: { sprite?: unknown }) {
      fake.setStyle(style);
      // A diff that changes the sprite starts a download synchronously.
      if (fake.parsedStyle && fake.parsedStyle.sprite !== style.sprite) this.startSpriteDownload();
      if (fake.parsedStyle) fake.parsedStyle = style;
      return this;
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

import { GPUInitializationError, type StyleSpecification } from 'maplibre-gl';
import { MapErrorFallback } from '../../src/renderer/components/errors/ErrorFallback';
import { MapCanvas } from '../../src/renderer/components/map/MapCanvas';
import { buildStyle, SOURCE_ONLINE } from '../../src/renderer/lib/map/style-builder';
import { useStore } from '../../src/renderer/lib/store';
import { DEFAULT_MAP_SETTINGS, type MapSettings, type TileManifest } from '../../src/shared/types';

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

function mapCanvas(settings: MapSettings = DEFAULT_MAP_SETTINGS) {
  return (
    <ErrorBoundary FallbackComponent={MapErrorFallback}>
      <MapCanvas
        client={client}
        manifest={manifest}
        settings={settings}
        renderOverlays={() => null}
        persistViewport={false}
      />
    </ErrorBoundary>
  );
}

function fire(type: string, e?: unknown) {
  act(() => {
    for (const fn of [...(fake.listeners.get(type) ?? [])]) fn(e);
  });
}

const withKey = (hasProtomapsApiKey: boolean): MapSettings => ({ ...DEFAULT_MAP_SETTINGS, hasProtomapsApiKey });
const appliedStyle = (call: number) => fake.setStyle.mock.calls[call][0] as StyleSpecification;

const WEBGL2_COPY = /WebGL2 isn't available/;

beforeEach(() => {
  fake.throwOnConstruct = null;
  fake.parsedStyle = {};
  fake.listeners.clear();
  fake.setStyle.mockClear();
  fake.spriteRequests = [];
  useStore.getState().setThemePref('light');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('MapCanvas on maplibre-gl 6', () => {
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
    fake.throwOnConstruct = new GPUInitializationError({}, null);
    render(mapCanvas());
    expect(screen.getByText(WEBGL2_COPY)).toBeTruthy();
  });

  it('keeps the generic reload copy when the Map constructor throws anything else', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.throwOnConstruct = new Error('boom');
    render(mapCanvas());
    expect(screen.getByText(/Reloading the map usually recovers it/)).toBeTruthy();
    expect(screen.queryByText(WEBGL2_COPY)).toBeNull();
  });
});

describe('MapCanvas restyle (API key / theme flips)', () => {
  it('applies a flip right away once the style is parsed, even while tiles are still loading', () => {
    const { rerender } = render(mapCanvas(withKey(false)));
    rerender(mapCanvas(withKey(true)));
    expect(fake.setStyle).toHaveBeenCalledTimes(1);
    expect(appliedStyle(0).sources[SOURCE_ONLINE]).toBeDefined();
  });

  it('waits for style.load when the first style has not been parsed yet', () => {
    fake.parsedStyle = undefined;
    const { rerender } = render(mapCanvas(withKey(false)));
    rerender(mapCanvas(withKey(true)));
    expect(fake.setStyle).not.toHaveBeenCalled();
    fire('style.load');
    expect(fake.setStyle).toHaveBeenCalledTimes(1);
    expect(appliedStyle(0).sources[SOURCE_ONLINE]).toBeDefined();
  });

  // Async act so microtasks run between flips, as they do between key presses —
  // that's when maplibre nulls `_spriteRequest` behind a newer download.
  const flipTheme = (mode: 'light' | 'dark') => act(async () => useStore.getState().setThemePref(mode));
  const aborted = () => fake.spriteRequests.map((r) => r.signal.aborted);

  it("aborts the initial style's sprite download when the first flip changes the sprite", async () => {
    fake.parsedStyle = buildStyle({ baseUrl: client.baseUrl, manifest, settings: DEFAULT_MAP_SETTINGS, theme: 'light' });
    render(mapCanvas());
    await flipTheme('dark');
    // [initial light, dark]
    expect(aborted()).toEqual([true, false]);
  });

  it('aborts every superseded sprite download so an older, slower sprite cannot land last', async () => {
    fake.parsedStyle = buildStyle({ baseUrl: client.baseUrl, manifest, settings: DEFAULT_MAP_SETTINGS, theme: 'light' });
    render(mapCanvas());
    await flipTheme('dark');
    await flipTheme('light');
    await flipTheme('dark');
    // [initial light, dark, light, dark]
    expect(aborted()).toEqual([true, true, true, false]);
  });

  it('leaves the in-flight sprite download alone when a restyle keeps the same sprite', async () => {
    fake.parsedStyle = buildStyle({ baseUrl: client.baseUrl, manifest, settings: withKey(false), theme: 'light' });
    const { rerender } = render(mapCanvas(withKey(false)));
    await flipTheme('dark');
    rerender(mapCanvas(withKey(true)));
    expect(fake.setStyle).toHaveBeenCalledTimes(2);
    // [initial light, dark] — the API-key restyle started nothing and aborted nothing.
    expect(aborted()).toEqual([true, false]);
  });

  it('still aborts a tracked download after a same-sprite restyle, once maplibre has nulled its handle', async () => {
    fake.parsedStyle = buildStyle({ baseUrl: client.baseUrl, manifest, settings: withKey(false), theme: 'light' });
    const { rerender } = render(mapCanvas(withKey(false)));
    await flipTheme('dark');
    await flipTheme('light'); // aborting dark nulls style._spriteRequest while light downloads
    await act(async () => rerender(mapCanvas(withKey(true))));
    await flipTheme('dark');
    // [initial light, dark, light, dark]
    expect(aborted()).toEqual([true, true, true, false]);
  });

  it('drops a superseded pending flip so only the latest one lands', () => {
    fake.parsedStyle = undefined;
    const { rerender } = render(mapCanvas(withKey(false)));
    rerender(mapCanvas(withKey(true)));
    rerender(mapCanvas(withKey(false)));
    fire('style.load');
    expect(fake.setStyle).toHaveBeenCalledTimes(1);
    expect(appliedStyle(0).sources[SOURCE_ONLINE]).toBeUndefined();
  });
});
