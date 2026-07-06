import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { OverflowMenu } from '@/features/message-actions/OverflowMenu';
import { useStore } from '@/lib/store';
import type { Message } from '../../src/shared/types';

const message: Message = {
  id: 'm1',
  key: 'ch:x',
  fromPublicKeyHex: 'a3f9c1d8',
  body: 'hi',
  ts: 0,
  state: 'received',
  meta: {
    paths: [
      {
        id: 'p',
        hashMode: 1,
        finalSnr: 0,
        hops: [
          { kind: 'origin', shortId: 'a3' },
          { kind: 'sink', shortId: 'me' },
        ],
      },
    ],
  },
};

describe('OverflowMenu', () => {
  test('copies the public key', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <OverflowMenu message={message} open onOpenChange={() => {}}>
        <button type="button">⋯</button>
      </OverflowMenu>,
    );
    fireEvent.click(screen.getByText('Copy public key'));
    expect(writeText).toHaveBeenCalledWith('a3f9c1d8');
  });

  test('view contact routes to the sender', () => {
    render(
      <OverflowMenu message={message} open onOpenChange={() => {}}>
        <button type="button">⋯</button>
      </OverflowMenu>,
    );
    fireEvent.click(screen.getByText('View contact'));
    expect(useStore.getState().ui.activeKey).toBe('c:a3f9c1d8');
  });
});
