import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HopBadge } from '../../src/renderer/components/HopBadge';

function badgeEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-slot="badge"]');
  if (!el) throw new Error('badge not found');
  return el as HTMLElement;
}

describe('HopBadge', () => {
  it('renders the count with a de-emphasised unit', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    expect(badgeEl(container).textContent).toBe('4h');
  });

  it('renders 0h for a direct message rather than nothing', () => {
    const { container } = render(<HopBadge hops={0} hashMode={2} />);
    expect(badgeEl(container).textContent).toBe('0h');
  });

  it('renders nothing when the hop count is unknown', () => {
    const { container } = render(<HopBadge hops={null} hashMode={2} />);
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('still renders the count when only the hash mode is unknown', () => {
    const { container } = render(<HopBadge hops={7} hashMode={null} />);
    expect(badgeEl(container).textContent).toBe('7h');
  });

  it('titles the badge with the ceiling its mode implies', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    expect(badgeEl(container).getAttribute('title')).toBe('4 hops · max 32 (2-byte path hash)');
  });

  it('drops the ceiling clause from the title when the mode is unknown', () => {
    const { container } = render(<HopBadge hops={4} hashMode={null} />);
    expect(badgeEl(container).getAttribute('title')).toBe('4 hops');
  });

  // The unit must be a separate element so it can be weight-de-emphasised, but
  // both must sit inside ONE flex child — badgeVariants ships `gap-1`, which
  // would otherwise render "4 h" instead of "4h". Same trap PathHashBadge hit.
  it('groups the number and unit so the badge gap cannot split "4h"', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    const badge = badgeEl(container);
    const group = Array.from(badge.querySelectorAll('span')).find((s) => s.textContent === '4h');
    expect(group).toBeDefined();
    const unit = group?.querySelector('span');
    expect(unit?.textContent).toBe('h');
    expect(unit?.className).toContain('font-normal');
  });

  // Regression, inherited from PathHashBadge: `text-[10px]` is an arbitrary
  // value, so Tailwind emits font-size only and the badge would inherit a
  // unitless line-height from whichever ancestor it lands under.
  it('pins its own line-height so ancestors cannot inflate it', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    expect(badgeEl(container).className).toContain('leading-none');
  });

  // The badge is unfilled — that is what separates it from the filled
  // PathHashBadge beside it and what makes the panel the contrast substrate.
  it('uses the outline variant so it carries no fill', () => {
    const { container } = render(<HopBadge hops={4} hashMode={2} />);
    expect(badgeEl(container).getAttribute('data-variant')).toBe('outline');
    // Anchored to a token boundary on purpose: badgeVariants' own outline
    // string carries `[a&]:hover:bg-accent`, so a bare /bg-/ would always
    // match. What must be absent is an UNPREFIXED background utility.
    expect(badgeEl(container).className).not.toMatch(/(^|\s)bg-/);
  });
});
