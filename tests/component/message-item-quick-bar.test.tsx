import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ApiClient } from '@/lib/api';
import type { Message } from '../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const message: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };

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
