import { describe, expect, it } from 'vitest';
import { getNameColor, initialsFor } from '../../../../src/renderer/lib/contactColor';

describe('getNameColor', () => {
  it('is deterministic for the same name', () => {
    expect(getNameColor('Alice')).toEqual(getNameColor('Alice'));
  });

  it('returns hsl foreground/background strings', () => {
    const c = getNameColor('Bob');
    expect(c.fg).toMatch(/^hsl\(/);
    expect(c.bg).toMatch(/^hsl\(/);
    expect(c.pillBg).toContain('color-mix');
  });
});

describe('initialsFor', () => {
  it('uses the first letter of the first two words', () => {
    expect(initialsFor('Andy Shinn')).toBe('AS');
  });

  it('uses the first two letters of a single word', () => {
    expect(initialsFor('Repeater')).toBe('Re');
  });

  it('returns ?? for an empty name', () => {
    expect(initialsFor('   ')).toBe('??');
  });

  it('returns the leading emoji as a single grapheme', () => {
    expect(initialsFor('🚀 Rocket')).toBe('🚀');
  });
});
