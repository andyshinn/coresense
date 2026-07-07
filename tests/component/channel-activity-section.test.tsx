import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelActivityBody } from '@/shell/rightrail/sections/ChannelActivity';
import type { ChannelStats } from '../../src/shared/types';

const stats = (over: Partial<ChannelStats> = {}): ChannelStats => ({
  count: 47,
  firstTs: 1_700_000_000_000,
  lastTs: 1_700_400_000_000,
  count24h: 12,
  count7d: 47,
  distinctSenders: 7,
  roster: [],
  perDay: [1, 2, 0, 3, 5, 4, 2],
  ...over,
});

describe('ChannelActivityBody', () => {
  it('renders 24h/7d volume and a sparkline', () => {
    const { container } = render(
      <ChannelActivityBody stats={stats()} loading={false} unread={0} muted={false} onMarkAllRead={() => {}} />,
    );
    expect(screen.getByText('12 in 24h · 47 in 7d')).toBeTruthy();
    expect(container.querySelectorAll('rect')).toHaveLength(7);
  });

  it('shows unread count with a Mark all read action', () => {
    const onMark = vi.fn();
    render(<ChannelActivityBody stats={stats()} loading={false} unread={4} muted={false} onMarkAllRead={onMark} />);
    expect(screen.getByText('4 unread')).toBeTruthy();
    fireEvent.click(screen.getByText('Mark all read'));
    expect(onMark).toHaveBeenCalledTimes(1);
  });

  it('shows "muted — not counted" for a muted channel', () => {
    render(<ChannelActivityBody stats={stats()} loading={false} unread={0} muted={true} onMarkAllRead={() => {}} />);
    expect(screen.getByText('muted — not counted')).toBeTruthy();
  });

  it('renders a placeholder while loading with no stats yet', () => {
    render(<ChannelActivityBody stats={null} loading={true} unread={0} muted={false} onMarkAllRead={() => {}} />);
    expect(screen.getByText('loading…')).toBeTruthy();
  });
});
