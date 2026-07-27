import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const getChannelStats = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = (await orig()) as typeof import('@/lib/api');
  return { ...actual, api: { ...actual.api, getChannelStats: (...a: unknown[]) => getChannelStats(...a) } };
});

import { __resetChannelStatsCacheForTests } from '@/hooks/useChannelStats';
import { useStore } from '@/lib/store';
import { ChannelPeopleBody, ChannelPeopleCount, ChannelPeopleSection } from '@/shell/rightrail/sections/ChannelPeople';
import type { Channel, ChannelStats, Contact } from '../../src/shared/types';

// Pinned, not Date.now(). `bucketFor` is calendar-relative (spec §5.6), so a
// fixture built from the real clock puts "3 hours ago" on the *previous*
// calendar day whenever the suite runs between local midnight and 03:00 — the
// row buckets to "Yesterday" and this file's bucket test fails looking for
// "Today". CI caught it at 02:31 UTC. Noon keeps every offset below well clear
// of a day boundary in any timezone, and `useNowTick` is pinned to the same
// instant so the component's clock and the fixture can never disagree.
const { NOW } = vi.hoisted(() => ({ NOW: new Date('2026-07-25T12:00:00').getTime() }));
vi.mock('@/hooks/useNowTick', () => ({ useNowTick: () => NOW }));

const contact = (over: Partial<Contact> = {}): Contact => ({
  key: 'c:abc',
  publicKeyHex: 'abc',
  name: 'alice',
  kind: 'chat',
  ...over,
});

const stats = (): ChannelStats => ({
  count: 6,
  firstTs: 1,
  lastTs: NOW,
  count24h: 0,
  count7d: 6,
  distinctSenders: 2,
  roster: [
    { fromPk: null, count: 1, lastTs: NOW }, // self — excluded
    { fromPk: 'unknown', count: 2, lastTs: NOW }, // aggregate — excluded
    { fromPk: 'name:alice', count: 3, lastTs: NOW - 3 * 3_600_000 },
    { fromPk: 'name:zora', count: 7, lastTs: NOW - 2 * 86_400_000 },
  ],
  perDay: [0, 0, 0, 0, 0, 0, 0],
});

beforeEach(() => {
  useStore.setState({ contacts: [contact()], discovered: [], peopleQuery: '' });
});

const body = (over: Partial<ComponentProps<typeof ChannelPeopleBody>> = {}) => (
  <TooltipProvider>
    <ChannelPeopleBody
      stats={stats()}
      railWidth={320}
      sort="recent"
      filter="all"
      query=""
      onQuery={() => {}}
      onSort={() => {}}
      onFilter={() => {}}
      onOpenContact={() => {}}
      onAddContact={() => {}}
      {...over}
    />
  </TooltipProvider>
);

describe('ChannelPeopleBody', () => {
  it('drops self and the unknown aggregate from the roster', () => {
    render(body());
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('zora')).toBeTruthy();
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('renders the compact age ladder, never prose', () => {
    render(body());
    expect(screen.getByText('3h')).toBeTruthy();
    expect(screen.getByText('2d')).toBeTruthy();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it('buckets by recency and omits empty buckets', () => {
    render(body());
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.queryByText('Yesterday')).toBeNull();
  });

  it('flattens the buckets when sorting by volume', () => {
    render(body({ sort: 'loud' }));
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('navigates on a row click', () => {
    const onOpenContact = vi.fn();
    render(body({ onOpenContact }));
    fireEvent.click(screen.getByText('alice'));
    expect(onOpenContact).toHaveBeenCalledWith('c:abc');
  });

  it('explains why an unheard poster has no actions', () => {
    render(body());
    const zora = screen.getByText('zora').closest('div') as HTMLElement;
    expect(within(zora).getByText('No advert heard from this node yet')).toBeTruthy();
  });

  it('filters to contacts', () => {
    render(body({ filter: 'contacts' }));
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.queryByText('zora')).toBeNull();
  });

  it('reports no match for a query, echoing it', () => {
    render(body({ query: 'zzz' }));
    expect(screen.getByText(/No one matches/)).toBeTruthy();
    expect(screen.getByText(/zzz/)).toBeTruthy();
  });

  it('hides the controls when nobody has been heard', () => {
    const empty = { ...stats(), roster: [] };
    render(body({ stats: empty }));
    expect(screen.getByText('No one has been heard in this channel yet.')).toBeTruthy();
    expect(screen.queryByLabelText('Search people')).toBeNull();
  });

  // Regression test for M-1: the old guard was `loading && !stats`. `loading`
  // starts false, so the very first painted frame (stats still null, loading
  // not yet flipped true) fell through to `all.length === 0` and flashed the
  // empty message before the skeletons ever appeared — and showed it
  // permanently whenever there's no client to fetch with, since `loading`
  // never turns true in that case either. `stats === null` alone must mean
  // "no data yet" (skeletons), never the empty message.
  it('shows skeletons, not the empty message, while stats has not loaded yet', () => {
    render(body({ stats: null }));
    expect(screen.queryByText('No one has been heard in this channel yet.')).toBeNull();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });

  it('drops the sort and filter toggles on a narrow rail', () => {
    render(body({ railWidth: 290 }));
    expect(screen.getByLabelText('Search people')).toBeTruthy();
    expect(screen.queryByLabelText('Sort people')).toBeNull();
  });
});

const client = { baseUrl: 'http://x', apiKey: 'k' };
const ch: Channel = { key: 'ch:public', name: 'public', kind: 'public' };

describe('ChannelPeopleCount', () => {
  beforeEach(() => {
    getChannelStats.mockReset();
    __resetChannelStatsCacheForTests();
    useStore.setState({ contacts: [contact()], discovered: [], peopleQuery: '', messagesByKey: {} });
  });

  it('shows the plain total with no filter or query', async () => {
    getChannelStats.mockResolvedValue(stats());
    render(<ChannelPeopleCount channel={ch} client={client} />);
    expect(await screen.findByText('2')).toBeTruthy();
  });

  // Smoke case missing from the spec: the header count switches to
  // "«n» / «total»" once a query narrows the roster.
  it('switches to «n» / «total» once a query narrows the roster', async () => {
    getChannelStats.mockResolvedValue(stats());
    useStore.setState({ peopleQuery: 'zora' });
    render(<ChannelPeopleCount channel={ch} client={client} />);
    expect(await screen.findByText('1 / 2')).toBeTruthy();
  });
});

// Regression test for I-3: `peopleQuery` is store-root state, so it outlives
// `ChannelPeopleSection`, which the rail's Collapsible mounts only while open
// (Collapsible.tsx: `{open && <div>{children}</div>}`). `ChannelPeopleCount`
// renders unconditionally from the section header, outside that guard. Before
// the fix, narrowing the roster then collapsing the section left the header
// count silently narrowed with no visible search box to explain or clear it.
describe('ChannelPeopleSection clears the query on unmount (I-3)', () => {
  beforeEach(() => {
    getChannelStats.mockReset();
    __resetChannelStatsCacheForTests();
    useStore.setState({ contacts: [contact()], discovered: [], peopleQuery: '', messagesByKey: {} });
  });

  function Harness({ open }: { open: boolean }) {
    return (
      <TooltipProvider>
        <ChannelPeopleCount channel={ch} client={client} />
        {open && <ChannelPeopleSection channel={ch} client={client} />}
      </TooltipProvider>
    );
  }

  it('collapsing the section clears peopleQuery so the header count stops showing a stale filter', async () => {
    getChannelStats.mockResolvedValue(stats());

    const { rerender } = render(<Harness open />);
    fireEvent.change(await screen.findByLabelText('Search people'), { target: { value: 'zora' } });
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeTruthy());

    // Collapse: ChannelPeopleSection unmounts exactly as it would under the
    // rail's Collapsible when the user clicks the section header.
    rerender(<Harness open={false} />);

    await waitFor(() => expect(useStore.getState().peopleQuery).toBe(''));
    expect(screen.getByText('2')).toBeTruthy();
  });
});
