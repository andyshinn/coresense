import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/components/map/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}));

import { useStore } from '../../src/renderer/lib/store';
import { MapView } from '../../src/renderer/panels/MapView';
import type { TileManifest } from '../../src/shared/types';

const presentManifest: TileManifest = {
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

beforeEach(() => useStore.getState().applyMapManifest(presentManifest));
afterEach(() => useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false }));

describe('MapView gating', () => {
  it('shows the empty-state when tiles are missing', () => {
    useStore.getState().applyMapManifest({ missing: true, basemap: null });
    render(<MapView client={client} />);
    expect(screen.getByText(/Map tiles not installed/i)).toBeTruthy();
  });

  it('renders the backdrop + banner when no key is set', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false });
    render(<MapView client={client} />);
    expect(screen.getByTestId('map-canvas')).toBeTruthy();
    expect(screen.getByText(/Add a Protomaps API key/i)).toBeTruthy();
  });

  it('renders the map with no banner when the key is accepted', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: true, keyRejected: false });
    render(<MapView client={client} />);
    expect(screen.getByTestId('map-canvas')).toBeTruthy();
    expect(screen.queryByText(/Add a Protomaps API key/i)).toBeNull();
  });
});
