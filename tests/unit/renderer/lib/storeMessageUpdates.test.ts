import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import type { Message, MessagePath } from '../../../../src/shared/types';

const msg = (id: string, key: string, ts: number, extra: Partial<Message> = {}): Message => ({
  id,
  key,
  body: id,
  ts,
  state: 'sending',
  ...extra,
});

const path = (id: string): MessagePath => ({ id, hops: [], hashMode: 1, finalSnr: 0 });

beforeEach(() => {
  useStore.setState({
    messagesByKey: {
      'ch:general': [msg('a1', 'ch:general', 1), msg('a2', 'ch:general', 2)],
      'c:abcd': [msg('b1', 'c:abcd', 3), msg('b2', 'c:abcd', 4)],
    },
  });
});

describe('message updates by id', () => {
  it('applyMessageState rebuilds only the list holding the id', () => {
    const before = useStore.getState().messagesByKey;
    useStore.getState().applyMessageState('b2', 'ack');
    const after = useStore.getState().messagesByKey;
    expect(after['ch:general']).toBe(before['ch:general']);
    expect(after['c:abcd']).not.toBe(before['c:abcd']);
    expect(after['c:abcd'][0]).toBe(before['c:abcd'][0]);
    expect(after['c:abcd'][1]).toMatchObject({ id: 'b2', state: 'ack' });
  });

  it('applyMessageState for an unknown id leaves messagesByKey untouched', () => {
    const before = useStore.getState().messagesByKey;
    useStore.getState().applyMessageState('nope', 'ack');
    expect(useStore.getState().messagesByKey).toBe(before);
  });

  it('appendMessagePath rebuilds only the list holding the id and counts a new path', () => {
    const before = useStore.getState().messagesByKey;
    useStore.getState().appendMessagePath('a1', path('p1'), 'heard');
    const after = useStore.getState().messagesByKey;
    expect(after['c:abcd']).toBe(before['c:abcd']);
    expect(after['ch:general'][1]).toBe(before['ch:general'][1]);
    expect(after['ch:general'][0]).toMatchObject({ state: 'heard', meta: { paths: [{ id: 'p1' }], timesHeard: 1 } });

    // A repeat of a path already held only advances the state.
    useStore.getState().appendMessagePath('a1', path('p1'), 'ack');
    expect(useStore.getState().messagesByKey['ch:general'][0]).toMatchObject({
      state: 'ack',
      meta: { paths: [{ id: 'p1' }], timesHeard: 1 },
    });
  });

  it('appendMessagePath for an unknown id leaves messagesByKey untouched', () => {
    const before = useStore.getState().messagesByKey;
    useStore.getState().appendMessagePath('nope', path('p1'), 'heard');
    expect(useStore.getState().messagesByKey).toBe(before);
  });
});
