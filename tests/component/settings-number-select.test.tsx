import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberSelect } from '@/components/settings/Field';

const OPTIONS = [
  { value: 7800, label: '7.8 kHz' },
  { value: 62500, label: '62.5 kHz' },
];

describe('NumberSelect', () => {
  it('shows the numeric value and emits the picked option as a number', () => {
    const onChange = vi.fn();
    render(<NumberSelect value={7800} options={OPTIONS} onChange={onChange} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('7800');

    fireEvent.change(select, { target: { value: '62500' } });
    expect(onChange).toHaveBeenCalledWith(62500);
  });
});
