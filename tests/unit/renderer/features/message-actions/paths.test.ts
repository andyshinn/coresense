import { describe, expect, it } from 'vitest';
import {
  formatAllPathsHeard,
  formatFirstPathHeard,
  formatPathHeard,
} from '../../../../../src/renderer/features/message-actions/paths';
import type { Message, MessagePath } from '../../../../../src/shared/types';

const path = (ids: string[]): MessagePath => ({
  id: ids.join('-'),
  hashMode: 1,
  finalSnr: 0,
  hops: ids.map((shortId, i) => ({
    kind: i === 0 ? 'origin' : i === ids.length - 1 ? 'sink' : 'hop',
    shortId,
  })),
});

const msg = (paths: MessagePath[]): Message => ({
  id: 'm1',
  key: 'ch:x',
  body: 'hi',
  ts: 0,
  state: 'received',
  meta: paths.length ? { paths } : undefined,
});

describe('formatPathHeard', () => {
  it('joins hop shortIds with commas in order', () => {
    expect(formatPathHeard(path(['a1', 'b2', 'c3']))).toBe('a1,b2,c3');
  });
});

describe('formatFirstPathHeard', () => {
  it('formats the first path, or null when there are none', () => {
    expect(formatFirstPathHeard(msg([path(['a1', 'b2'])]))).toBe('a1,b2');
    expect(formatFirstPathHeard(msg([]))).toBeNull();
  });
});

describe('formatAllPathsHeard', () => {
  it('lists each path on its own line, or null when there are none', () => {
    expect(formatAllPathsHeard(msg([path(['a1', 'b2']), path(['a1', 'x9', 'b2'])]))).toBe('a1,b2\na1,x9,b2');
    expect(formatAllPathsHeard(msg([]))).toBeNull();
  });
});
