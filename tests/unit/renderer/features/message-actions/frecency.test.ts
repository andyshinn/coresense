import { describe, expect, it } from 'vitest';
import {
  EMOJI_SEED,
  recordUsage,
  scoreEmoji,
  topEmojis,
} from '../../../../../src/renderer/features/message-actions/frecency';
import type { EmojiUsage } from '../../../../../src/shared/types';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

describe('scoreEmoji', () => {
  it('rewards higher count and more recent use', () => {
    const recent = scoreEmoji({ count: 3, lastUsedMs: NOW }, NOW);
    const old = scoreEmoji({ count: 3, lastUsedMs: NOW - 30 * DAY }, NOW);
    expect(recent).toBeGreaterThan(old);
    const more = scoreEmoji({ count: 10, lastUsedMs: NOW }, NOW);
    expect(more).toBeGreaterThan(recent);
  });
});

describe('topEmojis', () => {
  it('returns empty usage as the seed, capped to n', () => {
    expect(topEmojis({}, NOW, 5, EMOJI_SEED)).toEqual(EMOJI_SEED.slice(0, 5));
  });

  it('orders used emoji by frecency, then backfills from the seed without dupes', () => {
    const usage: EmojiUsage = {
      '🔥': { count: 5, lastUsedMs: NOW },
      '👍': { count: 1, lastUsedMs: NOW - 10 * DAY },
    };
    const top = topEmojis(usage, NOW, 5, EMOJI_SEED);
    expect(top[0]).toBe('🔥'); // highest frecency first
    expect(top).toContain('👍');
    expect(new Set(top).size).toBe(top.length); // no duplicates
    expect(top).toHaveLength(5);
  });
});

describe('recordUsage', () => {
  it('increments count and updates the timestamp immutably', () => {
    const before: EmojiUsage = { '👍': { count: 2, lastUsedMs: NOW - DAY } };
    const after = recordUsage(before, '👍', NOW);
    expect(after['👍']).toEqual({ count: 3, lastUsedMs: NOW });
    expect(before['👍'].count).toBe(2); // original untouched
  });

  it('creates a new entry for a first-seen emoji', () => {
    expect(recordUsage({}, '📡', NOW)['📡']).toEqual({ count: 1, lastUsedMs: NOW });
  });
});
