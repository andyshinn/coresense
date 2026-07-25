import { describe, expect, it } from 'vitest';
import { djb2, getNameColor, identitySlotFor, initialsFor } from '../../../../src/renderer/lib/contactColor';

describe('identitySlotFor', () => {
  it('is deterministic and lands in 0..11', () => {
    for (const name of ['Alice', 'Bob', 'Carol', '🚀 Rocket', '']) {
      const slot = identitySlotFor(name);
      expect(slot).toBe(identitySlotFor(name));
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(12);
    }
  });

  it('uses djb2 modulo 12', () => {
    expect(identitySlotFor('Alice')).toBe(djb2('Alice') % 12);
  });
});

describe('getNameColor', () => {
  it('is deterministic for the same id', () => {
    expect(getNameColor('Alice')).toEqual(getNameColor('Alice'));
  });

  it('returns css var references, not literal colours', () => {
    const c = getNameColor('Bob');
    const slot = identitySlotFor('Bob');
    expect(c.fg).toBe(`rgb(var(--cs-id-fg-${slot}))`);
    expect(c.bg).toBe(`rgb(var(--cs-id-bg-${slot}))`);
    expect(c.pillBg).toBe(`color-mix(in srgb, rgb(var(--cs-id-fg-${slot})) 18%, transparent)`);
  });

  it('never emits an hsl literal', () => {
    for (const name of ['Alice', 'Bob', 'Carol']) {
      expect(getNameColor(name).fg).not.toMatch(/^hsl\(/);
    }
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
