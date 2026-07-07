import { describe, expect, it } from 'vitest';
import { buildChannelShareUri } from '../../../../src/renderer/lib/channelShare';
import type { Channel } from '../../../../src/shared/types';

const ch = (over: Partial<Channel> = {}): Channel => ({ key: 'ch:worldcup', name: 'worldcup', kind: 'hashtag', ...over });

describe('buildChannelShareUri', () => {
  it('builds the official channel/add URI with the hex secret', () => {
    const uri = buildChannelShareUri(ch({ secretHex: 'd5786cc7bcee5a48d5786cc7bcee5a48' }));
    expect(uri).toBe('meshcore://channel/add?name=worldcup&secret=d5786cc7bcee5a48d5786cc7bcee5a48');
  });

  it('url-encodes the channel name', () => {
    const uri = buildChannelShareUri(ch({ name: 'My Chan', secretHex: 'abcd' }));
    expect(uri).toBe('meshcore://channel/add?name=My%20Chan&secret=abcd');
  });

  it('returns null when the channel has no secret', () => {
    expect(buildChannelShareUri(ch())).toBeNull();
  });
});
