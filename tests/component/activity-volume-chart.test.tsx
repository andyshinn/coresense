import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VolumeChart } from '@/shell/rightrail/sections/channel-activity/VolumeChart';
import type { ActivityWindow } from '../../src/shared/types';

const midnight = (() => {
  const d = new Date(1_700_000_000_000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

const win = (len: number, fill = 0): ActivityWindow => ({
  buckets: new Array(len).fill(fill),
  total: len * fill,
  prevTotal: 0,
  startMs: midnight,
});

const renderChart = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('VolumeChart', () => {
  it('renders one bar per bucket with an axis in full mode', () => {
    const { container } = renderChart(<VolumeChart winKey="24h" data={win(24, 3)} mode="full" />);
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBeTruthy();
  });

  it('drops the axis and shortens the plot in collapsed mode', () => {
    const { container } = renderChart(<VolumeChart winKey="24h" data={win(24, 3)} mode="collapsed" />);
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBe(null);
    const plot = container.querySelector('[role="img"]') as HTMLElement;
    expect(plot.style.height).toBe('30px');
  });

  it('keeps a hover read-out on every bucket in BOTH modes', () => {
    // Collapsed mode drops the axis, so the tooltip is the only way to identify a
    // bucket there — it matters more at this size, not less. Radix merges
    // data-slot="tooltip-trigger" onto the asChild cell, so counting those counts
    // hoverable buckets.
    const collapsed = renderChart(<VolumeChart winKey="24h" data={win(24, 3)} mode="collapsed" />);
    expect(collapsed.container.querySelectorAll('[data-slot="tooltip-trigger"]')).toHaveLength(24);

    const full = renderChart(<VolumeChart winKey="24h" data={win(24, 3)} mode="full" />);
    expect(full.container.querySelectorAll('[data-slot="tooltip-trigger"]')).toHaveLength(24);
  });

  it('shows the count and bucket label when a collapsed-mode bar is hovered', async () => {
    const data: ActivityWindow = { buckets: [0, 0, 7], total: 7, prevTotal: 0, startMs: midnight };
    const { container } = renderChart(<VolumeChart winKey="7d" data={data} mode="collapsed" />);
    const cells = container.querySelectorAll('[data-slot="tooltip-trigger"]');

    fireEvent.pointerMove(cells[2], { pointerType: 'mouse' });

    // bucketStart('7d', midnight, 2) is two calendar days on from the fixture's
    // midnight, so the label is that day's short weekday name.
    const day = new Date(midnight);
    day.setDate(day.getDate() + 2);
    const label = day.toLocaleDateString(undefined, { weekday: 'short' });
    await waitFor(() => expect(screen.getAllByText(`7 msgs · ${label}`).length).toBeGreaterThan(0));
  });

  it('renders 7 and 30 bar variants', () => {
    const seven = renderChart(<VolumeChart winKey="7d" data={win(7, 2)} mode="full" />);
    expect(seven.container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(7);
    const thirty = renderChart(<VolumeChart winKey="30d" data={win(30, 2)} mode="full" />);
    expect(thirty.container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(30);
  });

  it('normalises bar heights to the window max', () => {
    const data: ActivityWindow = { buckets: [0, 5, 10], total: 15, prevTotal: 0, startMs: midnight };
    const { container } = renderChart(<VolumeChart winKey="7d" data={data} mode="full" />);
    const bars = container.querySelectorAll<HTMLElement>('[data-testid="activity-bar"]');
    expect(bars[2].style.height).toContain('100%');
    expect(bars[1].style.height).toContain('50%');
  });

  it('draws a flat baseline for an all-zero window instead of dividing by zero', () => {
    const { container } = renderChart(<VolumeChart winKey="7d" data={win(7, 0)} mode="full" />);
    const bars = container.querySelectorAll<HTMLElement>('[data-testid="activity-bar"]');
    for (const bar of bars) expect(bar.style.height).toContain('0%');
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('No messages');
  });

  it('exposes the chart to assistive tech as a single labelled image', () => {
    const { container } = renderChart(<VolumeChart winKey="24h" data={win(24, 3)} mode="full" />);
    const plot = container.querySelector('[role="img"]');
    expect(plot?.getAttribute('aria-label')).toContain('last 24 hours');
  });
});
