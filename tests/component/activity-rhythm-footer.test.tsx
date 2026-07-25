import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RhythmFooter } from '@/shell/rightrail/sections/channel-activity/RhythmFooter';

const NOW = 1_700_000_000_000;
const peak = { startHour: 19, endHour: 22 };
const quiet = { startHour: 2, endHour: 6 };

describe('RhythmFooter', () => {
  it('renders peak, quiet and last message in full mode', () => {
    const { container } = render(<RhythmFooter peak={peak} quiet={quiet} lastTs={NOW - 180_000} mode="full" now={NOW} />);
    expect(container.textContent).toContain('7–10 PM');
    expect(container.textContent).toContain('2–6 AM');
    expect(container.textContent).toContain('3m ago');
  });

  it('drops the quiet band in collapsed mode', () => {
    const { container } = render(
      <RhythmFooter peak={peak} quiet={quiet} lastTs={NOW - 180_000} mode="collapsed" now={NOW} />,
    );
    expect(container.textContent).toContain('7–10 PM');
    expect(container.textContent).not.toContain('2–6 AM');
    expect(container.textContent).toContain('3m ago');
  });

  it('degrades to just the last message when the channel is too sparse for bands', () => {
    const { container } = render(<RhythmFooter peak={null} quiet={null} lastTs={NOW - 180_000} mode="full" now={NOW} />);
    expect(container.textContent).toContain('3m ago');
    expect(container.textContent).not.toContain('Peak');
  });

  it('renders nothing when there is neither a band nor a last message', () => {
    const { container } = render(<RhythmFooter peak={null} quiet={null} lastTs={null} mode="full" now={NOW} />);
    expect(container.querySelector('[data-testid="activity-rhythm"]')).toBe(null);
  });

  it('omits the last-message clause but keeps the bands when lastTs is null', () => {
    render(<RhythmFooter peak={peak} quiet={quiet} lastTs={null} mode="full" now={NOW} />);
    expect(screen.getByText('7–10 PM')).toBeTruthy();
    expect(screen.queryByText(/last msg/)).toBe(null);
  });
});
