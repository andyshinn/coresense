import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import { fmtDateTime, fmtMessageTime } from '@/lib/time';
import { MessageInfoSection } from '@/shell/rightrail/sections/MessageInfo';
import type { Message } from '../../src/shared/types';

const RECEIVED = 1_800_000_000_000;
const SENT = RECEIVED + 11 * 3_600_000;

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  key: 'ch:x',
  fromPublicKeyHex: 'name:barry',
  body: 'test from new config',
  ts: RECEIVED,
  sentTs: SENT,
  state: 'received',
  ...over,
});

describe('message timestamps', () => {
  it('shows the received time on the row and both times on hover', () => {
    render(<MessageItem message={msg()} isSelf={false} style="rich" senderName="barry" timeFormat="24h" />);
    const stamp = screen.getByText(fmtMessageTime(RECEIVED, '24h'));
    expect(stamp.getAttribute('title')).toBe(
      `Received: ${fmtDateTime(RECEIVED, '24h')}\nSender clock: ${fmtDateTime(SENT, '24h')} (+11h)`,
    );
  });

  it('lists received, sender clock and skew in the info rail', () => {
    render(<MessageInfoSection message={msg()} />);
    expect(screen.getByText('Received')).toBeTruthy();
    expect(screen.getByText('Sender clock')).toBeTruthy();
    expect(screen.getByText('+11h')).toBeTruthy();
    expect(screen.queryByText('Time')).toBeNull();
  });

  it('falls back to a single Time row without a packet time', () => {
    render(<MessageInfoSection message={msg({ sentTs: undefined })} />);
    expect(screen.getByText('Time')).toBeTruthy();
    expect(screen.queryByText('Sender clock')).toBeNull();
  });
});
