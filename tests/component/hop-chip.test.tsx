import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { HopChip, ListRow, TableView } from '@/panels/contacts/ContactRows';
import type { DiscoveredContact } from '../../src/shared/contacts/discovered';

// ContactRows pulls in notify (sonner) and the api client at module scope.
vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ api: { addToRadio: vi.fn(), removeFromRadio: vi.fn() } }));

function contact(hops: number | undefined, lastHeardMs?: number): DiscoveredContact {
  return {
    key: `c:${'ab'.repeat(32)}`,
    publicKeyHex: 'ab'.repeat(32),
    name: 'Node A',
    kind: 'chat',
    hops,
    lastHeardMs,
    firstHeardMs: 1_750_000_000_000,
    onRadio: true,
    favourite: false,
    blocked: false,
  };
}

beforeEach(() => {
  // Keep the list row's meta line to "Type · last heard · hops" so the hop
  // segment can be read positionally.
  useStore.setState({ contactManager: { ...useStore.getState().contactManager, showKeys: false } });
});

/** The hop cell in the table layout (column 5, after checkbox/glyph/name/type). */
function tableHopText(hops: number | undefined): string {
  const { container } = render(<TableView rows={[contact(hops)]} client={null} />);
  return (container.querySelectorAll('tbody td')[4]?.textContent ?? '').trim();
}

/** The hop segment of the list layout's meta line. */
function listHopText(hops: number | undefined): string {
  const { container } = render(<ListRow c={contact(hops)} client={null} />);
  // querySelectorAll is document order, so ancestors come first; the meta line
  // is the deepest element carrying the separator.
  const meta = Array.from(container.querySelectorAll('div'))
    .filter((d) => d.textContent?.includes(' · '))
    .at(-1);
  return (meta?.textContent ?? '').split(' · ')[2]?.trim() ?? '';
}

describe('HopChip', () => {
  // The bug this replaces: an em-dash for "no learned route", which reads as
  // missing data when it is in fact the most informative state on the row —
  // the radio has no path and will flood to reach this node.
  it('names the unknown-path state instead of dashing it out', () => {
    const { container } = render(<HopChip hops={undefined} />);
    expect(container.textContent).toBe('Flood');
  });

  // Guard against the HopBadge swap: that component returns null for a null hop
  // count, which would blank the cell for the majority of a real contact pool.
  it('still renders something for an unknown hop count', () => {
    const { container } = render(<HopChip hops={undefined} />);
    expect(container.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('renders 0 as a value, not as an absence', () => {
    const { container } = render(<HopChip hops={0} />);
    expect(container.textContent).toBe('0 hops');
  });

  it('singularises one hop', () => {
    const { container } = render(<HopChip hops={1} />);
    expect(container.textContent).toBe('1 hop');
  });
});

// The table and the list each used to derive this label themselves, which is
// exactly how they drifted. Both now go through formatHops, so the same contact
// has to read identically in either layout (#45 item 8).
describe('table and list layouts agree on hop wording', () => {
  for (const hops of [undefined, 0, 1, 4]) {
    it(`renders the same label in both layouts for hops=${String(hops)}`, () => {
      const table = tableHopText(hops);
      const list = listHopText(hops);
      expect(table).toBe(list);
      expect(table.length).toBeGreaterThan(0);
    });
  }

  it('shows Flood rather than an em-dash in both layouts', () => {
    expect(tableHopText(undefined)).toBe('Flood');
    expect(listHopText(undefined)).toBe('Flood');
  });
});

/** The last-heard cell in the table layout (column 7). */
function tableLastHeardText(lastHeardMs?: number): string {
  const { container } = render(<TableView rows={[contact(1, lastHeardMs)]} client={null} />);
  return (container.querySelectorAll('tbody td')[6]?.textContent ?? '').trim();
}

/** The last-heard segment of the list layout's meta line. */
function listLastHeardText(lastHeardMs?: number): string {
  const { container } = render(<ListRow c={contact(1, lastHeardMs)} client={null} />);
  const meta = Array.from(container.querySelectorAll('div'))
    .filter((d) => d.textContent?.includes(' · '))
    .at(-1);
  return (meta?.textContent ?? '').split(' · ')[1]?.trim() ?? '';
}

// Same story as the hop cell: the table said "—" and the list said "never" for
// the identical row, and the layout toggle swaps between them in place.
describe('table and list layouts agree on last-heard wording', () => {
  it('uses one word for a contact nothing has ever been received from', () => {
    expect(tableLastHeardText(undefined)).toBe('never');
    expect(listLastHeardText(undefined)).toBe('never');
  });

  it('agrees for a contact with a real reception time', () => {
    const heard = Date.now() - 3 * 60 * 60_000;
    expect(tableLastHeardText(heard)).toBe(listLastHeardText(heard));
    expect(tableLastHeardText(heard).length).toBeGreaterThan(0);
  });
});
