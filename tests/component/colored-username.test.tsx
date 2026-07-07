import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColoredUsername } from '@/components/ColoredUsername';

describe('ColoredUsername', () => {
  it('colors a given name with getNameColor', () => {
    render(<ColoredUsername name="alice" />);
    const el = screen.getByText('alice');
    expect(el.style.color).toBeTruthy();
    // jsdom may normalize hsl(...) — assert a color was set, not the exact string.
  });

  it('decodes a name-based sender', () => {
    render(<ColoredUsername sender="name:bob" />);
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('renders self neutrally as the selfLabel when no name/sender', () => {
    render(<ColoredUsername />);
    const el = screen.getByText('You');
    expect(el.style.color).toBe(''); // neutral: no inline color
  });

  it('renders an unknown sender as "Unknown", neutral', () => {
    render(<ColoredUsername sender="unknown" />);
    const el = screen.getByText('Unknown');
    expect(el.style.color).toBe('');
  });

  it('pill variant sets a background', () => {
    render(<ColoredUsername name="carol" variant="pill" />);
    const el = screen.getByText('carol');
    expect(el.style.backgroundColor).toBeTruthy();
  });
});
