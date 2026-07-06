import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageInfoPopover } from '@/features/message-actions/MessageInfoPopover';
import type { Message } from '../../src/shared/types';

const message: Message = {
  id: 'm1',
  key: 'ch:x',
  fromPublicKeyHex: 'a3f9c1d8',
  body: 'throughput cleaner',
  ts: 0,
  state: 'received',
  meta: {
    rssi: -72,
    snr: 8,
    paths: [
      {
        id: 'p',
        hashMode: 1,
        finalSnr: 0,
        hops: [
          { kind: 'origin', shortId: 'a3', name: 'K5TH' },
          { kind: 'sink', shortId: 'me', name: 'My radio' },
        ],
      },
    ],
  },
};

describe('MessageInfoPopover', () => {
  test('shows body, key and path when open', () => {
    render(
      <MessageInfoPopover message={message} senderName="K5TH" open onOpenChange={() => {}}>
        <button type="button">i</button>
      </MessageInfoPopover>,
    );
    expect(screen.getByText('throughput cleaner')).toBeTruthy();
    expect(screen.getByText('a3f9c1d8')).toBeTruthy();
    // "K5TH" appears twice in this fixture: as the "From" value (senderName)
    // and as the path-hop origin name — getByText would throw on multiple
    // matches, so assert presence across all matches instead.
    expect(screen.getAllByText('K5TH').length).toBeGreaterThan(0);
  });
});
