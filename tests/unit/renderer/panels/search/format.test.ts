import { describe, expect, it } from 'vitest';
import { shortPk } from '@/panels/search/format';

describe('shortPk', () => {
  it('returns the input unchanged when 12 chars or fewer', () => {
    expect(shortPk('abcdef')).toBe('abcdef');
    expect(shortPk('aabbccddeeff')).toBe('aabbccddeeff'); // exactly 12 — boundary
  });

  it('truncates a longer key to first 6 + ellipsis + last 4', () => {
    expect(shortPk('1234567890abc')).toBe('123456…0abc'); // 13 chars
    expect(shortPk('aabbccddeeff00112233445566778899')).toBe('aabbcc…8899');
  });
});
