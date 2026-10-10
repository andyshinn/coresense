import { describe, expect, it } from 'vitest';
import { capList } from '../../../../src/renderer/lib/capList';

describe('capList', () => {
  it('passes the list straight through, by identity, when the cap is null', () => {
    const input = [1, 2, 3, 4];
    const out = capList(input, null);
    expect(out.rows).toBe(input);
    expect(out.hidden).toBe(0);
  });

  it('caps to a prefix and counts the rest', () => {
    expect(capList(['a', 'b', 'c', 'd'], 2)).toEqual({ rows: ['a', 'b'], hidden: 2 });
  });

  it('withholds everything at a zero cap', () => {
    expect(capList(['a', 'b'], 0)).toEqual({ rows: [], hidden: 2 });
  });
});
