import { describe, expect, it } from 'vitest';
import { firstUnreadMessageId } from '../../../src/renderer/lib/utils';
import type { Message } from '../../../src/shared/types';

const m = (id: string, ts: number, over: Partial<Message> = {}): Message => ({
  id,
  key: 'ch:a',
  body: 'x',
  ts,
  state: 'received',
  fromPublicKeyHex: 'name:Alice',
  ...over,
});

describe('firstUnreadMessageId', () => {
  it('returns the earliest message newer than lastRead', () => {
    const msgs = [m('a', 10), m('b', 20), m('c', 30)];
    expect(firstUnreadMessageId(msgs, 15)).toBe('b');
  });
  it('skips owner-sent messages (no fromPublicKeyHex)', () => {
    const msgs = [m('self', 20, { fromPublicKeyHex: undefined }), m('b', 25)];
    expect(firstUnreadMessageId(msgs, 15)).toBe('b');
  });
  it('returns null when all read', () => {
    expect(firstUnreadMessageId([m('a', 10)], 50)).toBeNull();
  });
});
