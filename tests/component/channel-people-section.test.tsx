import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useStore } from '@/lib/store';
import { ChannelPeopleBody } from '@/shell/rightrail/sections/ChannelPeople';
import type { ChannelStats, Contact } from '../../src/shared/types';

const NOW = Date.now();

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
      loading={false}
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

  it('drops the sort and filter toggles on a narrow rail', () => {
    render(body({ railWidth: 290 }));
    expect(screen.getByLabelText('Search people')).toBeTruthy();
    expect(screen.queryByLabelText('Sort people')).toBeNull();
  });
});
