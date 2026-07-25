import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WindowTabs } from '@/shell/rightrail/sections/channel-activity/WindowTabs';

describe('WindowTabs', () => {
  it('renders the three windows and marks the selected one', () => {
    render(<WindowTabs value="7d" onChange={() => {}} />);
    expect(screen.getByText('24h')).toBeTruthy();
    expect(screen.getByText('30d')).toBeTruthy();
    expect(screen.getByLabelText('Last 7 days').getAttribute('data-state')).toBe('on');
    expect(screen.getByLabelText('Last 24 hours').getAttribute('data-state')).toBe('off');
  });

  it('reports the newly selected window', () => {
    const onChange = vi.fn();
    render(<WindowTabs value="24h" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Last 30 days'));
    expect(onChange).toHaveBeenCalledWith('30d');
  });

  it('ignores a deselect click on the active tab rather than clearing the window', () => {
    const onChange = vi.fn();
    render(<WindowTabs value="24h" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Last 24 hours'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
