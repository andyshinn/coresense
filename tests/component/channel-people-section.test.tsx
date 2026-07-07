import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelPeopleBody } from '@/shell/rightrail/sections/ChannelPeople';
import type { ChannelStats } from '../../src/shared/types';

const stats = (): ChannelStats => ({
  count: 4,
  firstTs: 1,
  lastTs: 2,
  count24h: 0,
  count7d: 4,
  distinctSenders: 2,
  roster: [
    { fromPk: null, count: 1, lastTs: 1_700_000_000_000 },
    { fromPk: 'name:alice', count: 3, lastTs: 1_700_000_000_000 },
  ],
  perDay: [0, 0, 0, 0, 0, 0, 0],
});

describe('ChannelPeopleBody', () => {
  it('renders the distinct-sender count and a roster row per sender', () => {
    render(<ChannelPeopleBody stats={stats()} loading={false} />);
    expect(screen.getByText('2 people seen')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // alice's message count
  });

  it('uses the singular for one person', () => {
    const s = stats();
    s.distinctSenders = 1;
    render(<ChannelPeopleBody stats={s} loading={false} />);
    expect(screen.getByText('1 person seen')).toBeTruthy();
  });

  it('renders a placeholder while loading', () => {
    render(<ChannelPeopleBody stats={null} loading={true} />);
    expect(screen.getByText('loading…')).toBeTruthy();
  });
});
