import { describe, expect, it } from 'vitest';
import { clampRetention } from '../../../src/shared/packetLog';
import { DEFAULT_PACKET_LOG_SETTINGS, PACKET_LOG_BOUNDS } from '../../../src/shared/types';

describe('clampRetention', () => {
  it('falls back to defaults for a null or missing packetLog instead of throwing', () => {
    expect(clampRetention(null)).toEqual(DEFAULT_PACKET_LOG_SETTINGS);
    expect(clampRetention(undefined)).toEqual(DEFAULT_PACKET_LOG_SETTINGS);
  });

  it('passes through in-bounds values unchanged', () => {
    expect(clampRetention({ liveBufferSize: 500, storedHistorySize: 1000 })).toEqual({
      liveBufferSize: 500,
      storedHistorySize: 1000,
    });
  });

  it('clamps a huge hand-edited storedHistorySize down to the max bound', () => {
    expect(clampRetention({ liveBufferSize: 500, storedHistorySize: 999_999_999 })).toEqual({
      liveBufferSize: 500,
      storedHistorySize: PACKET_LOG_BOUNDS.storedHistorySize.max,
    });
  });

  it('clamps below-minimum values up to the min bound', () => {
    expect(clampRetention({ liveBufferSize: 1, storedHistorySize: -5 })).toEqual({
      liveBufferSize: PACKET_LOG_BOUNDS.liveBufferSize.min,
      storedHistorySize: PACKET_LOG_BOUNDS.storedHistorySize.min,
    });
  });

  it('falls back to defaults for non-numeric/corrupted values', () => {
    expect(clampRetention({ liveBufferSize: 'nope' as unknown as number, storedHistorySize: Number.NaN })).toEqual(
      DEFAULT_PACKET_LOG_SETTINGS,
    );
  });
});
