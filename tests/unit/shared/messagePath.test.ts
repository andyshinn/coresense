import { describe, expect, it } from 'vitest';
import { firstPathStats, formatPathStats, relayHopCount } from '../../../src/shared/messagePath';
import type { Message, MessageHop } from '../../../src/shared/types';

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

  // What the transport layer actually hands us for a channel message: snr plus
  // paths, and no `hops` scalar at all. The chip has always read this shape
  // correctly; {{ hops }} did not, which is the bug this module exists to close.
  it('derives hops from paths for the library-shaped meta (snr + paths, no hops)', () => {
    const m = msg({
      snr: 5.5,
      paths: [{ id: 'p', hashMode: 1, finalSnr: 6, hops: [hop('origin'), hop('hop'), hop('hop'), hop('sink')] }],
    });
    expect(firstPathStats(m).hops).toBe(2);
  });

  // The DM shape: snr only. Nothing to derive, so null is the honest answer.
  it('returns null hops for the library-shaped DM meta (snr only)', () => {
    expect(firstPathStats(msg({ snr: 5.5 })).hops).toBeNull();
  });
});

describe('relayHopCount', () => {
  it('counts intermediate relays, excluding origin and sink', () => {
    expect(relayHopCount({ id: 'p', hashMode: 1, finalSnr: 0, hops: [hop('origin'), hop('hop'), hop('sink')] })).toBe(1);
  });

  it('is 0 for a direct path', () => {
    expect(relayHopCount({ id: 'p', hashMode: 1, finalSnr: 0, hops: [hop('origin'), hop('sink')] })).toBe(0);
  });

  it('is 0 for an empty hop list', () => {
    expect(relayHopCount({ id: 'p', hashMode: 1, finalSnr: 0, hops: [] })).toBe(0);
  });
});

describe('formatPathStats (hops label)', () => {
  it('formats the hop count, ignoring hash mode (now shown as a badge)', () => {
    expect(formatPathStats({ hops: 2, hashMode: 1 })).toBe('2h');
  });

  it('formats hops even when the hash mode is null', () => {
    expect(formatPathStats({ hops: 3, hashMode: null })).toBe('3h');
  });

  it('returns empty when hops is null regardless of hash mode', () => {
    expect(formatPathStats({ hops: null, hashMode: 2 })).toBe('');
  });

  it('returns empty when both are null', () => {
    expect(formatPathStats({ hops: null, hashMode: null })).toBe('');
  });

  it('keeps a 0-hop (direct) message as 0h', () => {
    expect(formatPathStats({ hops: 0, hashMode: 1 })).toBe('0h');
  });
});
