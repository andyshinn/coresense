import { describe, expect, it } from 'vitest';
import { firstPathStats, formatPathStats } from '../../../../src/renderer/lib/messagePath';
import type { Message, MessageHop } from '../../../../src/shared/types';

const msg = (meta: Message['meta']): Message => ({
  id: '1',
  key: 'ch:x',
  body: 'hi',
  ts: 0,
  state: 'received',
  meta,
});

const hop = (kind: MessageHop['kind'], shortId = 'xx'): MessageHop => ({ kind, shortId });

describe('firstPathStats', () => {
  it('counts only kind==="hop" entries from the first path', () => {
    const m = msg({
      paths: [
        {
          id: 'p',
          hashMode: 1,
          finalSnr: 0,
          hops: [hop('origin'), hop('hop'), hop('hop'), hop('sink')],
        },
      ],
    });
    expect(firstPathStats(m)).toEqual({ hops: 2, hashMode: 1 });
  });

  it('uses only the FIRST path when several are present', () => {
    const m = msg({
      paths: [
        { id: 'p1', hashMode: 2, finalSnr: 0, hops: [hop('hop')] },
        { id: 'p2', hashMode: 3, finalSnr: 0, hops: [hop('hop'), hop('hop')] },
      ],
    });
    expect(firstPathStats(m)).toEqual({ hops: 1, hashMode: 2 });
  });

  it('falls back to meta.hops with null hashMode when no paths', () => {
    expect(firstPathStats(msg({ hops: 3 }))).toEqual({ hops: 3, hashMode: null });
  });

  it('returns nulls when meta is absent', () => {
    expect(firstPathStats(msg(undefined))).toEqual({ hops: null, hashMode: null });
  });

  it('returns 0 hops for a direct (origin→sink only) first path', () => {
    const m = msg({
      paths: [{ id: 'p', hashMode: 1, finalSnr: 0, hops: [hop('origin'), hop('sink')] }],
    });
    expect(firstPathStats(m)).toEqual({ hops: 0, hashMode: 1 });
  });
});

describe('formatPathStats', () => {
  it('joins hops and hashMode', () => {
    expect(formatPathStats({ hops: 2, hashMode: 1 })).toBe('2h · 1b');
  });

  it('shows hops only when hashMode null', () => {
    expect(formatPathStats({ hops: 3, hashMode: null })).toBe('3h');
  });

  it('shows hash only when hops null', () => {
    expect(formatPathStats({ hops: null, hashMode: 2 })).toBe('2b');
  });

  it('returns empty string when both null', () => {
    expect(formatPathStats({ hops: null, hashMode: null })).toBe('');
  });

  it('renders 0 hops rather than blank', () => {
    expect(formatPathStats({ hops: 0, hashMode: 1 })).toBe('0h · 1b');
  });
});
