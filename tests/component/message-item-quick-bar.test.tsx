import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Message } from '../../src/shared/types';

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
          onSelect={() => {}}
          onReply={() => {}}
          onReact={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });

  test('non-interactive previews (no onSelect) render no quick bar', () => {
    render(<MessageItem message={message} isSelf={false} style="rich" senderName="K5TH" timeFormat="24h" />);
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});
