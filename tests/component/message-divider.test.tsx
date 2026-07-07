import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageDivider } from '@/components/MessageDivider';

describe('MessageDivider', () => {
  test('renders the label text', () => {
    render(<MessageDivider label="New" tone="accent" />);
    expect(screen.getByText('New')).not.toBeNull();
  });

  test('accent tone uses the unread accent palette', () => {
    const { container } = render(<MessageDivider label="New" tone="accent" />);
    expect(container.querySelector('.text-cs-accent')).not.toBeNull();
    expect(container.querySelector('.bg-cs-accent\\/40')).not.toBeNull();
  });

  test('date tone uses the muted-warm palette and not the accent one', () => {
    const { container } = render(<MessageDivider label="July 2, 2026" tone="date" />);
    expect(screen.getByText('July 2, 2026')).not.toBeNull();
    expect(container.querySelector('.text-cs-text-muted')).not.toBeNull();
    expect(container.querySelector('.bg-cs-border')).not.toBeNull();
    expect(container.querySelector('.text-cs-accent')).toBeNull();
  });
});
