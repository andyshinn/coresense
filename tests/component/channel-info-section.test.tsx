import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelInfoBody } from '@/shell/rightrail/sections/ChannelInfo';
import type { Channel } from '../../src/shared/types';

const ch = (over: Partial<Channel> = {}): Channel => ({
  key: 'ch:worldcup',
  name: 'worldcup',
  kind: 'hashtag',
  secretHex: 'd5786cc7bcee5a48d5786cc7bcee5a48',
  idx: 3,
  ...over,
});

describe('ChannelInfoBody', () => {
  it('renders kind, slot and a masked secret', () => {
    render(<ChannelInfoBody channel={ch()} lastActiveTs={null} muted={false} onToggleMuted={() => {}} />);
    expect(screen.getByText('hashtag')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByLabelText('Reveal secret')).toBeTruthy();
  });

  it('shows "not synced" when the radio slot is unknown', () => {
    render(<ChannelInfoBody channel={ch({ idx: undefined })} lastActiveTs={null} muted={false} onToggleMuted={() => {}} />);
    expect(screen.getByText('not synced')).toBeTruthy();
  });

  it('shows "unknown" for a channel with no createdAt', () => {
    render(<ChannelInfoBody channel={ch()} lastActiveTs={null} muted={false} onToggleMuted={() => {}} />);
    expect(screen.getByText('unknown')).toBeTruthy();
  });

  it('toggles mute', () => {
    const onToggle = vi.fn();
    render(<ChannelInfoBody channel={ch({ muted: false })} lastActiveTs={null} muted={false} onToggleMuted={onToggle} />);
    fireEvent.click(screen.getByText('no'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
