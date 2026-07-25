import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActivityBody } from '@/shell/rightrail/sections/channel-activity';
import type { ActivityWindow, ChannelActivity } from '../../src/shared/types';

const NOW = 1_700_000_000_000;
const midnight = (() => {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

const w = (len: number, total: number, prevTotal: number): ActivityWindow => ({
  buckets: new Array(len).fill(Math.floor(total / len)),
  total,
  prevTotal,
  startMs: midnight,
});

const activity = (over: Partial<ChannelActivity> = {}): ChannelActivity => ({
  windows: { '24h': w(24, 123, 104), '7d': w(7, 412, 498), '30d': w(30, 1637, 1290) },
  peakBand: { startHour: 19, endHour: 22 },
  quietBand: { startHour: 2, endHour: 6 },
  lastTs: NOW - 180_000,
  ...over,
});

const body = (props: Partial<React.ComponentProps<typeof ActivityBody>> = {}) =>
  render(
    <TooltipProvider>
      <ActivityBody
        activity={activity()}
        loading={false}
        error={null}
        mode="full"
        win="24h"
        onWindow={() => {}}
        now={NOW}
        {...props}
      />
    </TooltipProvider>,
  );

describe('ActivityBody', () => {
  it('renders the full treatment: tabs, lead number, trend, 24 bars, axis, rhythm', () => {
    const { container } = body();
    expect(screen.getByLabelText('Last 24 hours')).toBeTruthy();
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('in 24h')).toBeTruthy();
    expect(screen.getByText('18%')).toBeTruthy(); // (123-104)/104
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBeTruthy();
    expect(container.textContent).toContain('2–6 AM');
  });

  it('collapses to number, mini trend, bare sparkline and a two-clause rhythm line', () => {
    const { container } = body({ mode: 'collapsed' });
    expect(screen.queryByLabelText('Last 24 hours')).toBe(null);
    expect(screen.getByText('msgs · 24h')).toBeTruthy();
    expect(screen.queryByText('vs prev')).toBe(null);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBe(null);
    expect(container.textContent).not.toContain('2–6 AM');
    expect(container.textContent).toContain('3m ago');
  });

  it('pins the collapsed view to 24h even when a wider window is stored', () => {
    body({ mode: 'collapsed', win: '30d' });
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('msgs · 24h')).toBeTruthy();
  });

  it('reports tab changes to the caller', () => {
    const onWindow = vi.fn();
    body({ onWindow });
    fireEvent.click(screen.getByLabelText('Last 7 days'));
    expect(onWindow).toHaveBeenCalledWith('7d');
  });

  it('renders the selected window when the caller passes one', () => {
    const { container } = body({ win: '7d' });
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('in 7d')).toBeTruthy();
    expect(screen.getByText('17%')).toBeTruthy(); // (412-498)/498 rounds to -17
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(7);
  });

  it('hides the trend chip when there is no previous period to compare against', () => {
    const a = activity();
    a.windows['24h'] = { ...a.windows['24h'], total: 40, prevTotal: 0 };
    const { container } = body({ activity: a });
    expect(screen.getByText('40')).toBeTruthy();
    expect(container.textContent).not.toContain('%');
  });

  it('renders a zero window without NaN', () => {
    const a = activity();
    a.windows['24h'] = { buckets: new Array(24).fill(0), total: 0, prevTotal: 40, startMs: midnight };
    const { container } = body({ activity: a });
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
  });

  it('shows a placeholder for a channel that has never had a message', () => {
    body({ activity: activity({ lastTs: null }) });
    expect(screen.getByText('no activity yet')).toBeTruthy();
  });

  it('shows a placeholder while loading', () => {
    body({ activity: null, loading: true });
    expect(screen.getByText('loading…')).toBeTruthy();
  });

  it('surfaces a fetch error instead of pretending there is no activity', () => {
    body({ activity: null, loading: false, error: 'network unreachable' });
    expect(screen.getByText('network unreachable')).toBeTruthy();
    expect(screen.queryByText('no activity yet')).toBe(null);
  });
});
