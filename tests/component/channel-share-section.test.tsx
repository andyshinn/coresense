import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelShareSection } from '@/shell/rightrail/sections/ChannelShare';
import type { Channel } from '../../src/shared/types';

const ch = (over: Partial<Channel> = {}): Channel => ({ key: 'ch:worldcup', name: 'worldcup', kind: 'hashtag', ...over });

describe('ChannelShareSection', () => {
  it('renders a QR svg and copy controls when a secret is present', () => {
    const { container } = render(<ChannelShareSection channel={ch({ secretHex: 'd5786cc7bcee5a48d5786cc7bcee5a48' })} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('Copy link')).toBeTruthy();
    expect(screen.getByText('Copy secret')).toBeTruthy();
  });

  it('shows a placeholder when the channel has no secret', () => {
    render(<ChannelShareSection channel={ch()} />);
    expect(screen.getByText('secret unavailable — cannot generate a share code')).toBeTruthy();
  });
});
