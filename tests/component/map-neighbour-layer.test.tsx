import { render } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no WebGL. The layer only needs Marker to hold the element it was
// given; recording each one lets the test inspect the DOM the layer built.
const markerEls = vi.hoisted(() => [] as HTMLElement[]);
vi.mock('maplibre-gl', () => ({
  Marker: class {
    private el: HTMLElement;
    constructor(opts: { element: HTMLElement }) {
      this.el = opts.element;
      markerEls.push(opts.element);
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
    getElement() {
      return this.el;
    }
  },
}));

import { NeighbourMapLayer } from '../../src/renderer/components/map/NeighbourMapLayer';
import type { ResolvedNeighbour } from '../../src/renderer/lib/neighbours';

function stubMap() {
  const map = {
    on: () => map,
    off: () => map,
    getSource: () => ({ setData: vi.fn() }),
    getLayer: () => ({}),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getZoom: () => 10,
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
  };
  return map as unknown as MapLibreMap;
}

function neighbour(id: string, name: string, lat: number): ResolvedNeighbour {
  return {
    pubKeyPrefixHex: id,
    heardSecsAgo: 60,
    snrDb: 5,
    name,
    nameSource: 'contacts',
    contactKey: `c:${id}`,
    lat,
    lon: 1,
    located: true,
    ambiguous: false,
  };
}

const ids = ['aa', 'bb', 'cc'];
const list = [neighbour('aa', 'Alpha', 1), neighbour('bb', 'Bravo', 2), neighbour('cc', 'Charlie', 3)];

function mount() {
  const props = {
    map: stubMap(),
    focal: { lat: 0, lon: 0, name: 'Focal' },
    selectedId: null,
    hoveredId: null,
    showNames: false,
    onHover: () => {},
    onSelect: () => {},
  };
  const view = render(<NeighbourMapLayer {...props} neighbours={list} />);
  const marker = (id: string) => markerEls.find((el) => el.dataset.contactKey === `c:${id}`) as HTMLElement;
  // syncMarkerVisual replaces innerHTML, so the inner shape node's identity
  // tells a re-synced marker from a skipped one.
  const shape = (id: string) => marker(id).querySelector('.cs-map-marker__shape');
  return { ...view, props, marker, shape };
}

beforeEach(() => {
  markerEls.length = 0;
});

describe('NeighbourMapLayer marker re-sync', () => {
  it('re-syncs only the markers whose state changed on hover', () => {
    const { rerender, props, marker, shape } = mount();
    const before = ids.map(shape);
    rerender(<NeighbourMapLayer {...props} neighbours={list} hoveredId="aa" />);
    expect(ids.map((id) => marker(id).classList.contains('is-faded'))).toEqual([false, true, true]);
    expect(shape('aa')).toBe(before[0]);
    expect(shape('bb')).not.toBe(before[1]);
    expect(shape('cc')).not.toBe(before[2]);
  });

  it('re-syncs the label and accessible name of a renamed neighbour', () => {
    const { rerender, props, marker } = mount();
    const renamed = list.map((n) => (n.pubKeyPrefixHex === 'bb' ? { ...n, name: 'Bravo II' } : n));
    rerender(<NeighbourMapLayer {...props} neighbours={renamed} />);
    expect(marker('bb').querySelector('.cs-map-marker__label')?.textContent).toBe('Bravo II');
    expect(marker('bb').getAttribute('aria-label')).toBe('Bravo II (Repeater)');
  });

  it('leaves every marker untouched on an unchanged re-render', () => {
    const { rerender, props, shape } = mount();
    const before = ids.map(shape);
    // A fresh array with equal contents still re-runs the render pass.
    rerender(<NeighbourMapLayer {...props} neighbours={[...list]} />);
    ids.forEach((id, i) => {
      expect(shape(id)).toBe(before[i]);
    });
    expect(markerEls).toHaveLength(ids.length + 1); // + the focal marker; nothing rebuilt
  });
});
