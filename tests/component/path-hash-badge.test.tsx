import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathHashBadge } from '../../src/renderer/components/PathHashBadge';

function badgeEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-slot="badge"]');
  if (!el) throw new Error('badge not found');
  return el as HTMLElement;
}

describe('PathHashBadge', () => {
  it.each([1, 2, 3] as const)('renders %db with the mode tone, an icon, and a title', (bytes) => {
    const { container } = render(<PathHashBadge bytes={bytes} />);
    const badge = badgeEl(container);
    expect(badge.textContent).toBe(`${bytes}b`);
    expect(badge.className).toContain(`text-cs-hash-${bytes}`);
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.getAttribute('title')).toContain('Path hash size');
  });

  it('uses the singular "byte" in the 1-byte title', () => {
    const { container } = render(<PathHashBadge bytes={1} />);
    expect(badgeEl(container).getAttribute('title')).toBe('Path hash size: 1 byte per hop');
  });

  it('uses the plural "bytes" in the 2-byte title', () => {
    const { container } = render(<PathHashBadge bytes={2} />);
    expect(badgeEl(container).getAttribute('title')).toBe('Path hash size: 2 bytes per hop');
  });

  it('falls back to a neutral tone for an out-of-domain value', () => {
    const { container } = render(<PathHashBadge bytes={4} />);
    const badge = badgeEl(container);
    expect(badge.textContent).toBe('4b');
    expect(badge.className).toContain('text-cs-text-dim');
    expect(badge.className).not.toMatch(/text-cs-hash-/);
  });

  it('merges a passed className', () => {
    const { container } = render(<PathHashBadge bytes={2} className="ml-2" />);
    expect(badgeEl(container).className).toContain('ml-2');
  });

  // Regression: the number and unit must be one flex child so the badge's
  // gap-1 spaces only the icon — otherwise "2b" renders as "2 b". Assert the
  // "2b" text lives in a single element that does NOT contain the icon.
  it('groups the number and unit so the gap does not split "2b"', () => {
    const { container } = render(<PathHashBadge bytes={2} />);
    const badge = badgeEl(container);
    const group = Array.from(badge.querySelectorAll('span')).find((s) => s.textContent === '2b');
    expect(group).toBeDefined();
    expect(group?.querySelector('svg')).toBeNull();
  });
});
