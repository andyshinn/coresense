import { describe, expect, it } from 'vitest';
import {
  HASH_MODE_UNKNOWN,
  HOP_CEILING,
  HOP_RAMP_CAP_DIVISOR,
  hopCeiling,
  hopTint,
  hopTitle,
  hopWarmth,
  isKnownHashMode,
} from '../../../../src/renderer/lib/hopWarmth';

describe('isKnownHashMode', () => {
  it.each([1, 2, 3])('accepts the firmware-emittable mode %d', (m) => {
    expect(isKnownHashMode(m)).toBe(true);
  });

  it.each([null, undefined, 0, 4, -1, 1.5, Number.NaN])('rejects %s', (m) => {
    expect(isKnownHashMode(m as number | null)).toBe(false);
  });
});

describe('hopCeiling', () => {
  // 64-byte path buffer / bytes-per-hop.
  it('is 64 hops in 1-byte mode', () => expect(hopCeiling(1)).toBe(64));
  it('is 32 hops in 2-byte mode', () => expect(hopCeiling(2)).toBe(32));
  it('is 21 hops in 3-byte mode', () => expect(hopCeiling(3)).toBe(21));
  it('is null when the mode is unknown', () => expect(hopCeiling(null)).toBeNull());
});

describe('hopWarmth', () => {
  it('is 0 for a direct message in every mode', () => {
    expect(hopWarmth(0, 1)).toBe(0);
    expect(hopWarmth(0, 2)).toBe(0);
    expect(hopWarmth(0, 3)).toBe(0);
  });

  it('reaches 1 exactly at the soft cap (ceiling / divisor)', () => {
    expect(hopWarmth(HOP_CEILING[1] / HOP_RAMP_CAP_DIVISOR, 1)).toBe(1); // 16h
    expect(hopWarmth(HOP_CEILING[2] / HOP_RAMP_CAP_DIVISOR, 2)).toBe(1); // 8h
    expect(hopWarmth(HOP_CEILING[3] / HOP_RAMP_CAP_DIVISOR, 3)).toBe(1); // 5.25h
  });

  it('is half warm at half the cap', () => {
    expect(hopWarmth(8, 1)).toBe(0.5);
    expect(hopWarmth(4, 2)).toBe(0.5);
  });

  // The whole point of the feature: the same count reads hotter the more
  // expensive the hash mode, because the budget it spends is smaller.
  it('warms faster the smaller the ceiling', () => {
    expect(hopWarmth(4, 1)).toBeCloseTo(0.25, 5);
    expect(hopWarmth(4, 2)).toBeCloseTo(0.5, 5);
    expect(hopWarmth(4, 3)).toBeCloseTo(0.7619, 4);
  });

  it('saturates rather than exceeding 1 past the cap', () => {
    expect(hopWarmth(64, 1)).toBe(1);
    expect(hopWarmth(9, 2)).toBe(1);
  });

  it('clamps a count above the ceiling instead of overflowing', () => {
    expect(hopWarmth(9999, 1)).toBe(1);
  });

  it('clamps a negative count to the cool end', () => {
    expect(hopWarmth(-3, 2)).toBe(0);
  });

  it.each([null, undefined, HASH_MODE_UNKNOWN, 4])(
    'stays cool when the mode is %s — no ceiling means no honest distance',
    (mode) => {
      expect(hopWarmth(9, mode as number | null)).toBe(0);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('stays cool for a non-finite count (%s)', (hops) => {
    expect(hopWarmth(hops, 1)).toBe(0);
  });
});

describe('hopTint', () => {
  it('interpolates far→near in oklab at an integer percent', () => {
    expect(hopTint(4, 2)).toEqual({
      color: 'color-mix(in oklab, rgb(var(--cs-hop-far)) 50%, rgb(var(--cs-hop-near)))',
      borderColor:
        'color-mix(in srgb, color-mix(in oklab, rgb(var(--cs-hop-far)) 50%, rgb(var(--cs-hop-near))) 46%, transparent)',
    });
  });

  it('rounds to a whole percent so the emitted string is stable', () => {
    // 1/8 = 12.5% and 3/8 = 37.5% — both must land on an integer.
    expect(hopTint(1, 2).color).toContain(' 13%,');
    expect(hopTint(3, 2).color).toContain(' 38%,');
    // 1 / 5.25 = 19.047…%
    expect(hopTint(1, 3).color).toContain(' 19%,');
  });

  it('sits at 0% for a direct message', () => {
    expect(hopTint(0, 2).color).toContain(' 0%,');
  });

  it('sits at 0% when the mode is unknown, whatever the count', () => {
    expect(hopTint(9, null).color).toContain(' 0%,');
  });
});

describe('hopTitle', () => {
  it('names the ceiling and the mode so the normalisation is discoverable', () => {
    expect(hopTitle(4, 2)).toBe('4 hops · max 32 (2-byte path hash)');
  });

  it('uses the singular for a single hop', () => {
    expect(hopTitle(1, 1)).toBe('1 hop · max 64 (1-byte path hash)');
  });

  it('says "0 hops" for a direct message', () => {
    expect(hopTitle(0, 3)).toBe('0 hops · max 21 (3-byte path hash)');
  });

  it('omits the ceiling clause when the mode is unknown', () => {
    expect(hopTitle(4, null)).toBe('4 hops');
  });
});
