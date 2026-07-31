import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import type { Message } from '../../src/shared/types';

const msg = (id: string): Message => ({ id, key: 'ch:x', fromPublicKeyHex: 'a3f9', body: id, ts: 0, state: 'received' });

beforeEach(() => {
  useStore.setState({
    messagesByKey: { 'ch:x': [msg('a'), msg('b'), msg('c')] },
    selectedMessageId: null,
    pendingJumpMid: null,
    pendingDeleteMessageId: null,
  });
});

describe('store.removeMessages', () => {
  it('removes the message from its conversation', () => {
    useStore.getState().removeMessages('ch:x', ['b']);
    expect(useStore.getState().messagesByKey['ch:x'].map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('leaves other conversations untouched', () => {
    useStore.setState({ messagesByKey: { 'ch:x': [msg('a')], 'ch:y': [msg('a')] } });
    useStore.getState().removeMessages('ch:x', ['a']);
    expect(useStore.getState().messagesByKey['ch:y']).toHaveLength(1);
  });

  it('is a no-op for an unknown conversation key', () => {
    useStore.getState().removeMessages('ch:nope', ['a']);
    expect(useStore.getState().messagesByKey['ch:x']).toHaveLength(3);
  });

  it('clears selectedMessageId when that message is deleted', () => {
    useStore.setState({ selectedMessageId: 'b' });
    useStore.getState().removeMessages('ch:x', ['b']);
    expect(useStore.getState().selectedMessageId).toBeNull();
  });

  it('keeps selectedMessageId when a different message is deleted', () => {
    useStore.setState({ selectedMessageId: 'a' });
    useStore.getState().removeMessages('ch:x', ['b']);
    expect(useStore.getState().selectedMessageId).toBe('a');
  });

  it('clears pendingJumpMid when that message is deleted', () => {
    useStore.setState({ pendingJumpMid: 'c' });
    useStore.getState().removeMessages('ch:x', ['c']);
    expect(useStore.getState().pendingJumpMid).toBeNull();
  });
});

describe('store.setPendingDeleteMessageId', () => {
  it('round-trips an id and clears back to null', () => {
    useStore.getState().setPendingDeleteMessageId('b');
    expect(useStore.getState().pendingDeleteMessageId).toBe('b');
    useStore.getState().setPendingDeleteMessageId(null);
    expect(useStore.getState().pendingDeleteMessageId).toBeNull();
  });
});
