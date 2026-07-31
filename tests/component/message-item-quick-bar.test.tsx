import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ApiClient } from '@/lib/api';
import type { Message } from '../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const message: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };
const mine = (over: Partial<Message> = {}): Message => ({
  id: 'm2',
  key: 'ch:x',
  body: 'yo',
  ts: 0,
  state: 'sent',
  ...over,
});

describe('MessageItem quick bar', () => {
  test('interactive rows render the quick bar (Reply present for others)', () => {
    render(
      <TooltipProvider>
        <MessageItem
          message={message}
          isSelf={false}
          style="rich"
          senderName="K5TH"
          timeFormat="24h"
          client={client}
          onSelect={() => {}}
          onReply={() => {}}
          onReact={() => {}}
          onMacro={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });

  test('passes its client through, so the macro cluster is reachable', () => {
    render(
      <TooltipProvider>
        <MessageItem
          message={message}
          isSelf={false}
          style="rich"
          senderName="K5TH"
          timeFormat="24h"
          client={client}
          onSelect={() => {}}
          onReply={() => {}}
          onReact={() => {}}
          onMacro={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'All macros' })).toBeTruthy();
  });

  test('without a client the macro cluster is omitted', () => {
    render(
      <TooltipProvider>
        <MessageItem
          message={message}
          isSelf={false}
          style="rich"
          senderName="K5TH"
          timeFormat="24h"
          onSelect={() => {}}
          onReply={() => {}}
          onReact={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'All macros' })).toBeNull();
  });

  test('non-interactive previews (no onSelect) render no quick bar', () => {
    render(<MessageItem message={message} isSelf={false} style="rich" senderName="K5TH" timeFormat="24h" />);
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});

// Re-send is the one item where the right-click/overflow gap costs a recovery
// action, so assert it survives the MessageItem → MessageQuickBar →
// OverflowMenu hand-off rather than only unit-testing buildMessageMenuItems.
describe('MessageItem overflow menu: Re-send', () => {
  const renderOwn = (message: Message, onResend?: (m: Message) => void) =>
    render(
      <TooltipProvider>
        <MessageItem
          message={message}
          isSelf
          style="rich"
          senderName=""
          timeFormat="24h"
          client={client}
          onSelect={() => {}}
          onReact={() => {}}
          onResend={onResend}
        />
      </TooltipProvider>,
    );

  test('a failed own message offers Re-send in the overflow menu', () => {
    const onResend = vi.fn();
    const failed = mine({ state: 'failed' });
    renderOwn(failed, onResend);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByText('Re-send'));
    expect(onResend).toHaveBeenCalledWith(failed);
  });

  test('a delivered own message does not', () => {
    renderOwn(mine({ state: 'sent' }), vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('Delete message')).toBeTruthy();
    expect(screen.queryByText('Re-send')).toBeNull();
  });

  test('without an onResend handler a failed message offers nothing to click', () => {
    renderOwn(mine({ state: 'failed' }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByText('Re-send')).toBeNull();
  });
});
