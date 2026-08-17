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

  it('keeps pendingJumpMid when a different message is deleted', () => {
    useStore.setState({ pendingJumpMid: 'a' });
    useStore.getState().removeMessages('ch:x', ['b']);
    expect(useStore.getState().pendingJumpMid).toBe('a');
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

  // Virtuoso recycling the row (or the search panel navigating away) unmounts
  // the popover without radix ever firing onOpenChange, so the id would stay
  // staged and the confirm would re-open unbidden on the next mount.
  it('unstages the message when a staged confirmation unmounts', async () => {
    useStore.setState({ pendingDeleteMessageId: 'b' });
    const { unmount } = render(<DeleteConfirmPopover messageId="b" conversationKey="ch:x" preview="b" client={client} />);
    await screen.findByTestId('delete-confirm-panel');
    unmount();
    expect(useStore.getState().pendingDeleteMessageId).toBeNull();
  });

  it('leaves a different message staged when an unrelated row unmounts', () => {
    useStore.setState({ pendingDeleteMessageId: 'b' });
    const { unmount } = render(<DeleteConfirmPopover messageId="c" conversationKey="ch:x" preview="c" client={client} />);
    unmount();
    expect(useStore.getState().pendingDeleteMessageId).toBe('b');
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

describe('search result delete', () => {
  it('exposes a delete affordance per hit and stages it', async () => {
    const { SearchMessageRow } = await import('@/panels/search/MessageRow');
    useStore.setState({ pendingDeleteMessageId: null });
    render(
      <SearchMessageRow
        hit={{
          id: 'h1',
          key: 'ch:x',
          ts: 0,
          fromPublicKeyHex: null,
          body: 'found me',
          snippet: 'found <mark>me</mark>',
          score: 1,
        }}
        channelName="x"
        senderName="nate"
        onClick={() => {}}
        client={client}
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('search-delete-message'));
    expect(useStore.getState().pendingDeleteMessageId).toBe('h1');
  });

  it('reports the deletion so the panel can drop the hit', async () => {
    const { SearchMessageRow } = await import('@/panels/search/MessageRow');
    const spy = vi.spyOn(api, 'deleteMessage').mockResolvedValue({ ok: true });
    const onDeleted = vi.fn();
    useStore.setState({ pendingDeleteMessageId: 'h1' });
    render(
      <SearchMessageRow
        hit={{ id: 'h1', key: 'ch:x', ts: 0, fromPublicKeyHex: null, body: 'found me', snippet: 'found me', score: 1 }}
        channelName="x"
        senderName="nate"
        onClick={() => {}}
        client={client}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(await screen.findByTestId('confirm-delete-message'));
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(client, 'ch:x', 'h1'));
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith('h1'));
  });
});

describe('removeMessages and the rendered list', () => {
  it('leaves an empty array when the last message goes', () => {
    useStore.setState({ messagesByKey: { 'ch:x': [msg('only')] } });
    useStore.getState().removeMessages('ch:x', ['only']);
    expect(useStore.getState().messagesByKey['ch:x']).toEqual([]);
  });

  it('preserves order of the remaining messages', () => {
    useStore.setState({ messagesByKey: { 'ch:x': [msg('a'), msg('b'), msg('c'), msg('d')] } });
    useStore.getState().removeMessages('ch:x', ['b', 'c']);
    expect(useStore.getState().messagesByKey['ch:x'].map((m) => m.id)).toEqual(['a', 'd']);
  });
});
