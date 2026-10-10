import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedNeighbour } from '@/lib/neighbours';
import { NeighbourList } from '@/shell/rightrail/sections/NeighbourList';

const nb = (prefix: string, name: string, located: boolean): ResolvedNeighbour => ({
  pubKeyPrefixHex: prefix,
  heardSecsAgo: 30,
  snrDb: 5,
  name,
  nameSource: 'contacts',
  contactKey: `c:${prefix}`,
  lat: located ? 1 : null,
  lon: located ? 2 : null,
  located,
  ambiguous: false,
});

const neighbours = [nb('aa', 'Off One', false), nb('bb', 'On One', true), nb('cc', 'On Two', true)];

function renderList(mapShown: boolean) {
  return render(
    <NeighbourList
      neighbours={neighbours}
      total={3}
      mapShown={mapShown}
      sortKey="snr-desc"
      count={8}
      busy={false}
      hasFetched
      onSort={vi.fn()}
      onCount={vi.fn()}
      onFetch={vi.fn()}
      showNames={false}
      onShowNames={vi.fn()}
      selectedId={null}
      hoveredId={null}
      onHover={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
}

// Row names in document order, with the off-map group heading marked.
function rowOrder(container: HTMLElement): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? '';
    if (['Off One', 'On One', 'On Two', 'No location advert'].includes(t)) out.push(t);
  }
  return out;
}

describe('NeighbourList grouping', () => {
  it('lists located rows first, then the off-map group, when the map is shown', () => {
    const { container } = renderList(true);
    expect(rowOrder(container)).toEqual(['On One', 'On Two', 'No location advert', 'Off One']);
    expect(screen.getByText(/2 on map · 3 of 3 heard/)).toBeTruthy();
  });

  it('puts every row in the off-map group when no map is shown', () => {
    const { container } = renderList(false);
    expect(rowOrder(container)).toEqual(['No location advert', 'Off One', 'On One', 'On Two']);
  });
});
