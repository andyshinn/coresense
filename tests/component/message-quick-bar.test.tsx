import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageQuickBar } from '@/features/message-actions/MessageQuickBar';
import { useStore } from '@/lib/store';
import { DEFAULT_UI_STATE, type Message } from '../../src/shared/types';

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

describe('MessageQuickBar', () => {
  beforeEach(() => useStore.setState({ ui: { ...DEFAULT_UI_STATE } }));

  test('others: quick-react records usage and calls onReact', () => {
    const onReact = vi.fn();
    renderBar({ message: other, isSelf: false, senderName: 'K5TH', onReact, onReply: () => {} });
    fireEvent.click(screen.getByRole('button', { name: 'Reply with 👍' }));
    expect(onReact).toHaveBeenCalledWith('K5TH', '👍');
    expect(useStore.getState().ui.emojiUsage['👍'].count).toBe(1);
  });

  test('others: Reply calls onReply', () => {
    const onReply = vi.fn();
    renderBar({ message: other, isSelf: false, senderName: 'K5TH', onReact: () => {}, onReply });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith('K5TH');
  });

  test('self: shows Copy / Info / Delete and no Reply', () => {
    renderBar({ message: mine, isSelf: true, senderName: '', onReact: () => {}, onReply: () => {} });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  test('hidden pill is non-interactive (pointer-events-none, not pinned open)', () => {
    renderBar({ message: other, isSelf: false, senderName: 'K5TH', onReact: () => {}, onReply: () => {} });
    const bar = screen.getByTestId('message-quick-bar');
    expect(bar.className).toContain('pointer-events-none');
    expect(bar.getAttribute('data-open')).toBe('false');
  });
});
