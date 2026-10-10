import { act, render, screen } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no WebGL; these overlays only need maplibre's Marker class, and
// with no contacts on the map MapClusters never constructs one.
vi.mock('maplibre-gl', () => ({ Marker: class {} }));

import { MapClusters } from '../../src/renderer/components/map/MapClusters';
import { MapInfo } from '../../src/renderer/components/map/MapInfo';
import { useStore } from '../../src/renderer/lib/store';

type Listener = () => void;

// A stub with just what the overlays call. `setData` on the spiderfy leader
// source runs once per MapClusters render pass, so it counts passes.
function stubMap() {
  const listeners = new Map<string, Set<Listener>>();
  const setData = vi.fn();
  const camera = { lng: 1, lat: 2, zoom: 3, bearing: 0, pitch: 0 };
  const map = {
    on(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
      return map;
    },
    off(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
      return map;
    },
    getSource: () => ({ setData }),
    getLayer: () => ({}),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getBounds: () => ({ getWest: () => -180, getSouth: () => -85, getEast: () => 180, getNorth: () => 85 }),
    getZoom: () => camera.zoom,
    getCenter: () => ({ lng: camera.lng, lat: camera.lat }),
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
  };
  // What maplibre fires for one frame of a zoom animation: `move`, then `zoom`.
  const fire = (...types: string[]) =>
    act(() => {
      for (const type of types) for (const fn of [...(listeners.get(type) ?? [])]) fn();
    });
  return { map: map as unknown as MapLibreMap, setData, camera, fire };
}

beforeEach(() => {
  useStore.getState().setSelectedSite(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('MapClusters map events', () => {
  it('re-renders once per animation frame while a site is spiderfied', () => {
    const { map, setData, fire } = stubMap();
    render(<MapClusters map={map} />);
    act(() => useStore.getState().setSelectedSite('site:a|b'));
    setData.mockClear();
    fire('move', 'zoom');
    expect(setData).toHaveBeenCalledTimes(1);
  });

  it('waits for the camera to settle when nothing is spiderfied', () => {
    vi.useFakeTimers();
    const { map, setData, fire } = stubMap();
    render(<MapClusters map={map} />);
    setData.mockClear();
    fire('move', 'zoom');
    expect(setData).not.toHaveBeenCalled();
    fire('zoomend', 'moveend');
    act(() => vi.advanceTimersByTime(80));
    expect(setData).toHaveBeenCalledTimes(1);
  });
});

describe('MapInfo map events', () => {
  it('tracks the camera through move events', () => {
    const { map, camera, fire } = stubMap();
    render(<MapInfo map={map} />);
    expect(screen.getByText('3.00')).toBeTruthy();
    Object.assign(camera, { zoom: 4.5, bearing: 12 });
    fire('move', 'zoom', 'rotate');
    expect(screen.getByText('4.50')).toBeTruthy();
    expect(screen.getByText('12.0°')).toBeTruthy();
  });
});
