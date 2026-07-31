import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { DeleteConfirmPopover } from '@/features/message-actions/DeleteConfirmPopover';
import { type ApiClient, api } from '@/lib/api';
import { notify } from '@/lib/notify';
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
  // Mirrors the beforeEach convention in MacroLibrary.test.tsx: without this,
  // vi.spyOn(api, 'deleteMessage') in one test returns the same mock instance
  // (with its call history) in a later test, since the property is already a
  // spy by the time the next `it` runs.
  vi.restoreAllMocks();
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

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };

describe('DeleteConfirmPopover', () => {
  it('renders nothing until its message is staged', () => {
    useStore.setState({ pendingDeleteMessageId: null });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    expect(screen.queryByTestId('confirm-delete-message')).toBeNull();
  });

  it('deletes through the API when confirmed', async () => {
    const spy = vi.spyOn(api, 'deleteMessage').mockResolvedValue({ ok: true });
    useStore.setState({ pendingDeleteMessageId: 'b' });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    fireEvent.click(await screen.findByTestId('confirm-delete-message'));
    expect(spy).toHaveBeenCalledWith(client, 'ch:x', 'b');
  });

  it('does not delete when cancelled, and unstages the message', async () => {
    const spy = vi.spyOn(api, 'deleteMessage').mockResolvedValue({ ok: true });
    useStore.setState({ pendingDeleteMessageId: 'b' });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    fireEvent.click(await screen.findByTestId('cancel-delete-message'));
    expect(spy).not.toHaveBeenCalled();
    expect(useStore.getState().pendingDeleteMessageId).toBeNull();
  });

  it('says the delete is local only', async () => {
    useStore.setState({ pendingDeleteMessageId: 'b' });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    const panel = await screen.findByTestId('delete-confirm-panel');
    expect(panel.textContent).toMatch(/this device only/i);
  });

  it('reports an error instead of silently doing nothing when there is no client', async () => {
    const spy = vi.spyOn(api, 'deleteMessage').mockResolvedValue({ ok: true });
    useStore.setState({ pendingDeleteMessageId: 'b' });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={null} />);
    fireEvent.click(await screen.findByTestId('confirm-delete-message'));
    expect(spy).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalled();
  });

  it('leaves the store untouched — the messagesDeleted broadcast prunes, not the component', async () => {
    vi.spyOn(api, 'deleteMessage').mockResolvedValue({ ok: true });
    useStore.setState({
      messagesByKey: { 'ch:x': [msg('a'), msg('b'), msg('c')] },
      pendingDeleteMessageId: 'b',
    });
    render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    fireEvent.click(await screen.findByTestId('confirm-delete-message'));
    await vi.waitFor(() => expect(api.deleteMessage).toHaveBeenCalled());
    expect(useStore.getState().messagesByKey['ch:x'].map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});
