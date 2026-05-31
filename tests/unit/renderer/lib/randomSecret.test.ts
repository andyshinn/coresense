import { describe, expect, it } from 'vitest';
import { generate16ByteHex } from '../../../../src/renderer/lib/randomSecret';

describe('generate16ByteHex', () => {
  it('returns 32 lowercase hex chars (16 bytes)', () => {
    expect(generate16ByteHex()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is overwhelmingly unlikely to repeat', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generate16ByteHex()));
    expect(seen.size).toBe(100);
  });
});
