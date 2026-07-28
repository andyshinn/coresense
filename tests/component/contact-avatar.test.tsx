import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContactAvatar } from '@/components/ContactAvatar';

describe('ContactAvatar', () => {
  it('hashes the name when identity is omitted', () => {
    const { container } = render(<ContactAvatar name="alice" />);
    const el = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(el.style.color).toBeTruthy();
  });

  it('overrides the hash input when identity is an explicit string', () => {
    // Same name, different identity ⇒ a caller (MessageItem) sharing one
    // resolved value with ColoredUsername still lands on a real colour.
    const { container } = render(<ContactAvatar name="alice" identity="abc" />);
    const el = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(el.style.color).toBeTruthy();
  });

  it('renders a neutral disc when identity is explicitly null, even though the name alone would colour', () => {
    const { container } = render(<ContactAvatar name="alice" identity={null} />);
    const el = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(el.style.color).toBe('');
    expect(el.className).toContain('bg-cs-bg-3');
    expect(el.className).toContain('text-cs-text-dim');
  });
});
