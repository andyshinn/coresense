import { describe, expect, it } from 'vitest';
import { identiconCells } from '../../../../../src/renderer/features/quick-actions/identicon-cells';

const HEX = '1a3d3c9f2b7e4a10c8d5f6029ab14e7c3d8f5a21b9e0c4d7f6a3b2c1908e7d6f5';

describe('identiconCells', () => {
  it('returns a 25-cell grid (col*5 + row)', () => {
    expect(identiconCells(HEX)).toHaveLength(25);
  });
  it('is deterministic for the same hex', () => {
    expect(identiconCells(HEX)).toEqual(identiconCells(HEX));
  });
  it('is horizontally mirrored (col 0 == col 4, col 1 == col 3)', () => {
    const cells = identiconCells(HEX);
    for (let row = 0; row < 5; row++) {
      expect(cells[0 * 5 + row]).toBe(cells[4 * 5 + row]);
      expect(cells[1 * 5 + row]).toBe(cells[3 * 5 + row]);
    }
  });
  it('differs for different keys', () => {
    const a = identiconCells(HEX);
    const b = identiconCells('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    expect(a).not.toEqual(b);
  });
});
