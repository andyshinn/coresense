import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Location card: the draggable pin, the coordinate fields, Save / Revert,
// and the leave guard. jsdom has no WebGL, so MapCanvas is swapped for a stub
// that just renders the overlays against a fake map, and maplibre's Marker
// records what the pin does and lets a test fire its dragend.

const { api, markers } = vi.hoisted(() => ({
  api: { putDeviceIdentity: vi.fn(async () => ({ ok: true })), confirmQuit: vi.fn(async () => ({ ok: true })) },
  markers: [] as FakeMarker[],
}));

interface FakeMarker {
  el: HTMLElement;
  lngLat: [number, number];
  draggable: boolean;
  removed: boolean;
  drop: (lat: number, lon: number) => void;
}

vi.mock('maplibre-gl', () => ({
  Marker: class {
    private rec: FakeMarker;
    private handlers: Record<string, () => void> = {};
    constructor(opts: { element: HTMLElement }) {
      this.rec = {
        el: opts.element,
        lngLat: [0, 0],
        draggable: false,
        removed: false,
        drop: (lat, lon) => {
          this.rec.lngLat = [lon, lat];
          this.handlers.dragend?.();
        },
      };
      markers.push(this.rec);
    }
    on(ev: string, fn: () => void) {
      this.handlers[ev] = fn;
      return this;
    }
    setLngLat(ll: [number, number]) {
      this.rec.lngLat = ll;
      return this;
    }
    getLngLat() {
      return { lng: this.rec.lngLat[0], lat: this.rec.lngLat[1] };
    }
    setDraggable(d: boolean) {
      this.rec.draggable = d;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      this.rec.removed = true;
    }
    getElement() {
      return this.rec.el;
    }
  },
}));

const inView = vi.hoisted(() => ({ value: true }));
const fakeMap = {
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  flyTo: vi.fn(),
  easeTo: vi.fn(),
  getBounds: () => ({ contains: () => inView.value }),
  getZoom: () => 8,
  getCenter: () => ({ lat: 51.501234567, lng: -0.14189912 }),
} as unknown as MapLibreMap;

vi.mock('../../../src/renderer/components/map/MapCanvas', () => ({
  MapCanvas: ({ renderOverlays }: { renderOverlays: (m: MapLibreMap) => ReactNode }) => (
    <div data-testid="map-canvas">{renderOverlays(fakeMap)}</div>
  ),
}));
vi.mock('../../../src/renderer/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../src/renderer/lib/api')>()),
  api,
}));
vi.mock('../../../src/renderer/lib/notify', () => import('../../support/notifyMock'));

import { useStore } from '../../../src/renderer/lib/store';
import { LocationCard } from '../../../src/renderer/panels/my-node/cards/LocationCard';
import { DEFAULT_DEVICE_IDENTITY, DEFAULT_GPS_CONFIG } from '../../../src/shared/types';
import { notify, resetNotifyMock } from '../../support/notifyMock';
import { renderWithClient } from '../../support/renderWithClient';
import { seedRadio } from '../my-radio/helpers';

const TILES = {
  missing: false,
  basemap: {
    source: 'bundled',
    bytes: 1,
    minZoom: 0,
    maxZoom: 14,
    bounds: [-1, 50, 1, 52],
    center: { lng: 0, lat: 51, zoom: 8 },
    tileType: 1,
  },
} as never;

const lat = () => screen.getByLabelText('Latitude') as HTMLInputElement;
const lon = () => screen.getByLabelText('Longitude') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const pin = () => markers.filter((m) => !m.removed).at(-1);

function seed({ position = { lat: 51.5, lon: -0.12 } as { lat: number; lon: number } | null, gps = false } = {}) {
  seedRadio();
  useStore.setState({
    mapManifest: TILES,
    deviceIdentity: {
      ...DEFAULT_DEVICE_IDENTITY,
      name: 'egrme.sh Hand',
      lat: position?.lat ?? null,
      lon: position?.lon ?? null,
    },
    gpsConfig: { ...DEFAULT_GPS_CONFIG, enabled: gps },
  });
  useStore.getState().setActiveKey('tool:node');
}

beforeEach(() => {
  markers.length = 0;
  resetNotifyMock();
  api.putDeviceIdentity.mockClear();
  useStore.getState().clearPendingTarget();
  seed();
});

afterEach(() => {
  useStore.getState().setLocationDirty(false);
});

describe('Location card', () => {
  it('shows the saved position in the fields and on a draggable pin', () => {
    renderWithClient(<LocationCard />);
    expect(lat().value).toBe('51.5');
    expect(lon().value).toBe('-0.12');
    expect(pin()?.lngLat).toEqual([-0.12, 51.5]);
    expect(pin()?.draggable).toBe(true);
    expect(pin()?.el.title).toBe('Drag to move');
    expect(pin()?.el.textContent).toContain('egrme.sh Hand');
    expect(screen.queryByText('Unsaved')).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it('dropping the pin makes a 5-decimal draft and marks the card unsaved', () => {
    renderWithClient(<LocationCard />);
    act(() => pin()?.drop(51.5123456, -0.1298765));
    expect(lat().value).toBe('51.51235');
    expect(lon().value).toBe('-0.12988');
    expect(screen.getByText('Unsaved')).toBeTruthy();
    expect(useStore.getState().myNodeUi.locationDirty).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });

  it('typing moves the pin; a bad value shows its error and blocks Save', () => {
    renderWithClient(<LocationCard />);
    fireEvent.change(lat(), { target: { value: '52.25' } });
    expect(pin()?.lngLat).toEqual([-0.12, 52.25]);
    fireEvent.change(lat(), { target: { value: '95' } });
    expect(screen.getByText('Latitude must be between -90 and 90')).toBeTruthy();
    expect(lat().getAttribute('aria-invalid')).toBe('true');
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(lon(), { target: { value: '1.123456' } });
    expect(screen.getByText('Longitude allows at most 5 decimal places')).toBeTruthy();
  });

  it('Revert puts the saved position back', () => {
    renderWithClient(<LocationCard />);
    act(() => pin()?.drop(40, 10));
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    expect(lat().value).toBe('51.5');
    expect(pin()?.lngLat).toEqual([-0.12, 51.5]);
    expect(useStore.getState().myNodeUi.locationDirty).toBe(false);
  });

  it('Save pushes the draft to the radio and toasts it', async () => {
    renderWithClient(<LocationCard />);
    fireEvent.change(lat(), { target: { value: '51.6' } });
    fireEvent.change(lon(), { target: { value: '-0.2' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Position pushed to radio'));
    expect(api.putDeviceIdentity).toHaveBeenCalledWith(expect.anything(), { lat: 51.6, lon: -0.2 });
    // The radio's reply updates the store, which ends the draft.
    act(() => useStore.setState({ deviceIdentity: { ...useStore.getState().deviceIdentity, lat: 51.6, lon: -0.2 } }));
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('a failed save keeps the draft and says why', async () => {
    api.putDeviceIdentity.mockRejectedValueOnce(new Error('radio busy'));
    renderWithClient(<LocationCard />);
    fireEvent.change(lat(), { target: { value: '51.6' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(notify.failure).toHaveBeenCalledWith('Save', expect.any(Error)));
    expect(lat().value).toBe('51.6');
    expect(screen.getByText('Unsaved')).toBeTruthy();
  });

  it('GPS on: the radio owns the position, so the pin and fields are read-only', () => {
    seed({ gps: true });
    renderWithClient(<LocationCard />);
    expect(pin()?.draggable).toBe(false);
    expect(pin()?.el.title).toBe('');
    expect(lat().disabled).toBe(true);
    expect(screen.getByText(/GPS is on, so the radio sets its own position/)).toBeTruthy();
  });

  it('no position: no pin until one is dropped at the map center', () => {
    seed({ position: null });
    renderWithClient(<LocationCard />);
    expect(pin()).toBeUndefined();
    expect(lat().value).toBe('');
    expect(screen.queryByText(/is required/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Drop pin at map center' }));
    expect(lat().value).toBe('51.50123');
    expect(lon().value).toBe('-0.1419');
    expect(pin()?.lngLat).toEqual([-0.1419, 51.50123]);
  });

  it('pans to a typed position that lands off the map, and leaves an in-view one be', () => {
    renderWithClient(<LocationCard />);
    vi.mocked(fakeMap.easeTo).mockClear();
    fireEvent.change(lat(), { target: { value: '51.6' } });
    expect(fakeMap.easeTo).not.toHaveBeenCalled();
    inView.value = false;
    fireEvent.change(lat(), { target: { value: '30.2' } });
    expect(fakeMap.easeTo).toHaveBeenCalledWith({ center: [-0.12, 30.2] });
    inView.value = true;
  });

  it('the map buttons zoom and recenter on the pin', () => {
    renderWithClient(<LocationCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recenter on my node' }));
    expect(fakeMap.zoomIn).toHaveBeenCalled();
    expect(fakeMap.zoomOut).toHaveBeenCalled();
    expect(fakeMap.flyTo).toHaveBeenCalledWith({ center: [-0.12, 51.5], zoom: 13 });
  });

  it('without map tiles the fields still work', () => {
    useStore.setState({ mapManifest: { missing: true, basemap: null } });
    renderWithClient(<LocationCard />);
    expect(screen.queryByTestId('map-canvas')).toBeNull();
    expect(screen.getByText("Map tiles aren't installed. Type the position below.")).toBeTruthy();
    fireEvent.change(lat(), { target: { value: '50' } });
    expect(saveButton().disabled).toBe(false);
  });

  it('unmounting drops the dirty flag so the guard can’t get stuck', () => {
    const { unmount } = renderWithClient(<LocationCard />);
    act(() => pin()?.drop(40, 10));
    expect(useStore.getState().myNodeUi.locationDirty).toBe(true);
    unmount();
    expect(useStore.getState().myNodeUi.locationDirty).toBe(false);
  });
});

describe('Location card leave guard', () => {
  function dirtyThenLeave() {
    renderWithClient(<LocationCard />);
    act(() => pin()?.drop(40, 10));
    act(() => useStore.getState().setActiveKey('ch:0'));
  }

  it('leaving with an unsaved position asks first, and Cancel stays', () => {
    dirtyThenLeave();
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
    expect(screen.getByText('Unsaved position')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
    expect(lat().value).toBe('40');
  });

  it('Save position pushes it, then carries out the move', async () => {
    dirtyThenLeave();
    fireEvent.click(screen.getByRole('button', { name: 'Save position' }));
    await waitFor(() => expect(useStore.getState().ui.activeKey).toBe('ch:0'));
    expect(api.putDeviceIdentity).toHaveBeenCalledWith(expect.anything(), { lat: 40, lon: 10 });
  });

  it('a failed save keeps the dialog open and stays put', async () => {
    api.putDeviceIdentity.mockRejectedValueOnce(new Error('radio busy'));
    dirtyThenLeave();
    fireEvent.click(screen.getByRole('button', { name: 'Save position' }));
    await waitFor(() => expect(notify.failure).toHaveBeenCalledWith('Save', expect.any(Error)));
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
    expect(screen.getByText('Unsaved position')).toBeTruthy();
  });

  it('quitting with an unsaved position asks too, and Discard lets the quit go ahead', async () => {
    renderWithClient(<LocationCard />);
    act(() => pin()?.drop(40, 10));
    act(() => useStore.getState().setPendingTarget({ kind: 'quit' }));
    expect(screen.getByText(/Push it to the radio before quitting\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(api.confirmQuit).toHaveBeenCalledTimes(1));
    expect(api.putDeviceIdentity).not.toHaveBeenCalled();
  });

  it('Discard reverts and carries out the move', () => {
    dirtyThenLeave();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useStore.getState().ui.activeKey).toBe('ch:0');
    expect(api.putDeviceIdentity).not.toHaveBeenCalled();
  });
});
