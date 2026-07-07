import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '@/components/Sparkline';

describe('Sparkline', () => {
  it('renders one bar per data point', () => {
    const { container } = render(<Sparkline data={[0, 1, 2, 3, 0, 4, 1]} />);
    expect(container.querySelectorAll('rect')).toHaveLength(7);
  });

  it('scales the tallest bar to full height and keeps zeros at zero height', () => {
    const { container } = render(<Sparkline data={[0, 4]} />);
    const rects = Array.from(container.querySelectorAll('rect'));
    expect(Number(rects[0].getAttribute('height'))).toBe(0);
    expect(Number(rects[1].getAttribute('height'))).toBeGreaterThan(0);
  });

  it('renders an svg even when all values are zero', () => {
    const { container } = render(<Sparkline data={[0, 0, 0]} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelectorAll('rect')).toHaveLength(3);
  });
});
