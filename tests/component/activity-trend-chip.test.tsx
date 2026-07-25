import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendChip } from '@/shell/rightrail/sections/channel-activity/TrendChip';

describe('TrendChip', () => {
  it('renders an upward chip with the vs-prev suffix', () => {
    const { container } = render(<TrendChip pct={18} showVsPrev={true} />);
    expect(screen.getByText('18%')).toBeTruthy();
    expect(screen.getByText('vs prev')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-up')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-down')).toBe(null);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders a downward chip with the sign stripped from the number', () => {
    const { container } = render(<TrendChip pct={-17} showVsPrev={true} />);
    expect(screen.getByText('17%')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-down')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-up')).toBe(null);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders a neutral chip for a true no-change period, with no arrow or direction colour', () => {
    // A flat period has no sign to assert — it must not borrow the up (or down)
    // treatment. This was a live defect: pct=0 previously fell into the `up`
    // branch (`pct >= 0`) and rendered a green "▲ 0%".
    const { container } = render(<TrendChip pct={0} showVsPrev={true} />);
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('vs prev')).toBeTruthy();
    expect(container.querySelector('.text-cs-text-muted')).toBeTruthy();
    expect(container.querySelector('.bg-cs-bg-3')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-up')).toBe(null);
    expect(container.querySelector('.text-cs-trend-down')).toBe(null);
    expect(container.querySelector('svg')).toBe(null);
  });

  it('omits the vs-prev suffix in mini form', () => {
    render(<TrendChip pct={18} showVsPrev={false} />);
    expect(screen.queryByText('vs prev')).toBe(null);
  });

  it('names the direction for assistive tech, since the arrow is decorative', () => {
    render(<TrendChip pct={-17} showVsPrev={false} />);
    expect(screen.getByText('down', { exact: false })).toBeTruthy();
  });

  it('names a flat period "unchanged" for assistive tech, not "up"', () => {
    render(<TrendChip pct={0} showVsPrev={false} />);
    expect(screen.getByText('unchanged', { exact: false })).toBeTruthy();
  });
});
