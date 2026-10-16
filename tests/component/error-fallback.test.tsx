import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PanelErrorFallback } from '@/components/errors/ErrorFallback';

function renderFallback(error: unknown) {
  return render(<PanelErrorFallback error={error} resetErrorBoundary={() => {}} />);
}

describe('ErrorFallback message block', () => {
  it('shows the message of a thrown Error', () => {
    const { container } = renderFallback(new Error('boom'));
    expect(container.querySelector('pre')?.textContent).toBe('boom');
  });

  it('stringifies a thrown plain value', () => {
    const { container } = renderFallback({ code: 7 });
    expect(container.querySelector('pre')?.textContent).toBe('{"code":7}');
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
  ])('hides the block for %s', (_label, error) => {
    const { container } = renderFallback(error);
    expect(container.querySelector('pre')).toBeNull();
  });
});
