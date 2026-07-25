import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendChip } from '@/shell/rightrail/sections/channel-activity/TrendChip';

describe('TrendChip', () => {
  it('renders an upward chip with the vs-prev suffix', () => {
    const { container } = render(<TrendChip pct={18} showVsPrev={true} />);
    expect(screen.getByText('18%')).toBeTruthy();
    expect(screen.getByText('vs prev')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-up')).toBeTruthy();
  });

  it('renders a downward chip with the sign stripped from the number', () => {
    const { container } = render(<TrendChip pct={-17} showVsPrev={true} />);
    expect(screen.getByText('17%')).toBeTruthy();
    expect(container.querySelector('.text-cs-trend-down')).toBeTruthy();
  });

  it('omits the vs-prev suffix in mini form', () => {
    render(<TrendChip pct={18} showVsPrev={false} />);
    expect(screen.queryByText('vs prev')).toBe(null);
  });

  it('names the direction for assistive tech, since the arrow is decorative', () => {
    render(<TrendChip pct={-17} showVsPrev={false} />);
    expect(screen.getByText('down', { exact: false })).toBeTruthy();
  });
});
