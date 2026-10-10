import { describe, expect, it } from 'vitest';
import {
  channelKey,
  channelNameFromKey,
  contactKey,
  conversationKind,
  isChannelKey,
  isContactKey,
  pubkeyFromKey,
} from '../../../src/shared/conversationKey';

describe('conversation keys', () => {
  it('builds channel and contact keys', () => {
    expect(channelKey('Public')).toBe('ch:Public');
    expect(contactKey('ab12')).toBe('c:ab12');
  });

  it('classifies keys regardless of check order', () => {
    expect(isChannelKey('ch:Public')).toBe(true);
    expect(isContactKey('ch:Public')).toBe(false);
    expect(isContactKey('c:ab12')).toBe(true);
    expect(isChannelKey('c:ab12')).toBe(false);
    expect(isChannelKey('tool:map')).toBe(false);
    expect(isContactKey('tool:map')).toBe(false);
  });

  it('channelNameFromKey strips only the channel prefix', () => {
    expect(channelNameFromKey('ch:Public')).toBe('Public');
    expect(channelNameFromKey('ch:')).toBe('');
    expect(channelNameFromKey('Public')).toBe('Public');
  });

  it('conversationKind maps each key family', () => {
    expect(conversationKind('ch:Public')).toBe('channel');
    expect(conversationKind('c:ab12')).toBe('dm');
    expect(conversationKind('tool:packetlog')).toBeNull();
    expect(conversationKind('')).toBeNull();
  });

  it('pubkeyFromKey strips the contact prefix and tolerates a bare pubkey', () => {
    expect(pubkeyFromKey('c:ab12')).toBe('ab12');
    expect(pubkeyFromKey('ab12')).toBe('ab12');
    expect(pubkeyFromKey(contactKey('ff00'))).toBe('ff00');
  });
});
