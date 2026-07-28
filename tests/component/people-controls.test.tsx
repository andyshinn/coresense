import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PeopleControls } from '@/shell/rightrail/sections/PeopleControls';

function baseProps(overrides: Partial<Parameters<typeof PeopleControls>[0]> = {}) {
  return {
    query: '',
    sort: 'recent' as const,
    filter: 'all' as const,
    showToggles: true,
    onQuery: () => {},
    onSort: () => {},
    onFilter: () => {},
    ...overrides,
  };
}

describe('PeopleControls', () => {
  it('reports typed text through onQuery', () => {
    const onQuery = vi.fn();
    render(<PeopleControls {...baseProps({ onQuery })} />);
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'alice' } });
    expect(onQuery).toHaveBeenCalledWith('alice');
  });

  it('hides both toggle groups when showToggles is false, leaving search alone', () => {
    render(<PeopleControls {...baseProps({ showToggles: false })} />);
    expect(screen.getByLabelText('Search people')).toBeTruthy();
    expect(screen.queryByText('Loudest')).toBeNull();
    expect(screen.queryByText('Contacts')).toBeNull();
  });

  it('renders all sort and filter options and marks the active ones', () => {
    render(<PeopleControls {...baseProps({ sort: 'loud', filter: 'contacts' })} />);
    expect(screen.getByText('Loudest').getAttribute('data-state')).toBe('on');
    expect(screen.getByText('Recent').getAttribute('data-state')).toBe('off');
    expect(screen.getByText('A–Z').getAttribute('data-state')).toBe('off');
    expect(screen.getByText('Contacts').getAttribute('data-state')).toBe('on');
    expect(screen.getByText('All').getAttribute('data-state')).toBe('off');
  });

  it('reports a newly selected sort', () => {
    const onSort = vi.fn();
    render(<PeopleControls {...baseProps({ onSort })} />);
    fireEvent.click(screen.getByText('A–Z'));
    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('ignores a deselect click on the active sort rather than clearing it', () => {
    const onSort = vi.fn();
    render(<PeopleControls {...baseProps({ sort: 'recent', onSort })} />);
    fireEvent.click(screen.getByText('Recent'));
    expect(onSort).not.toHaveBeenCalled();
  });

  it('reports a newly selected filter', () => {
    const onFilter = vi.fn();
    render(<PeopleControls {...baseProps({ onFilter })} />);
    fireEvent.click(screen.getByText('Contacts'));
    expect(onFilter).toHaveBeenCalledWith('contacts');
  });

  it('ignores a deselect click on the active filter rather than clearing it', () => {
    const onFilter = vi.fn();
    render(<PeopleControls {...baseProps({ filter: 'all', onFilter })} />);
    fireEvent.click(screen.getByText('All'));
    expect(onFilter).not.toHaveBeenCalled();
  });
});
