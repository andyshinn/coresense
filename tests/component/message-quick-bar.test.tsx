import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageQuickBar } from '@/features/message-actions/MessageQuickBar';
import type { ApiClient } from '@/lib/api';
import { useStore } from '@/lib/store';
import { DEFAULT_UI_STATE, type Message } from '../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const other: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };
const mine: Message = { id: 'm2', key: 'ch:x', body: 'yo', ts: 0, state: 'sent' };

// MessageQuickBar uses Radix Tooltip (via its IconBtn helper and ReactionRow),
// which requires an ancestor TooltipProvider (supplied in the real app by
// AppShell's SidebarProvider). Isolated component tests need to supply that
// context explicitly.
function renderBar(props: React.ComponentProps<typeof MessageQuickBar>) {
  return render(
    <TooltipProvider>
      <MessageQuickBar {...props} />
    </TooltipProvider>,
  );
}

const base = { message: other, isSelf: false, senderName: 'K5TH', client, onReact: () => {}, onReply: () => {} };

describe('MessageQuickBar', () => {
  beforeEach(() => useStore.setState({ ui: { ...DEFAULT_UI_STATE }, macros: [] }));

  test('others: quick-react records usage and calls onReact', () => {
    const onReact = vi.fn();
    renderBar({ ...base, onReact });
    fireEvent.click(screen.getByRole('button', { name: 'Reply with 👍' }));
    expect(onReact).toHaveBeenCalledWith('K5TH', '👍');
    expect(useStore.getState().ui.emojiUsage['👍'].count).toBe(1);
  });

  test('others: Reply calls onReply', () => {
    const onReply = vi.fn();
    renderBar({ ...base, onReply });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith('K5TH');
  });

  test('self: shows Copy / Info / Delete and no Reply', () => {
    renderBar({ ...base, message: mine, isSelf: true, senderName: '' });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  test('hidden pill is non-interactive (pointer-events-none, not pinned open)', () => {
    renderBar(base);
    const bar = screen.getByTestId('message-quick-bar');
    expect(bar.className).toContain('pointer-events-none');
    expect(bar.getAttribute('data-open')).toBe('false');
  });

  test('with a client, the macro cluster is present', () => {
    renderBar(base);
    expect(screen.getByRole('button', { name: 'All macros' })).toBeTruthy();
  });

  test('without a client, the macro cluster is omitted (nothing can render)', () => {
    renderBar({ ...base, client: null });
    expect(screen.queryByRole('button', { name: 'All macros' })).toBeNull();
    // The rest of the bar is unaffected.
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });
});
