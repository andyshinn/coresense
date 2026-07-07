import { describe, expect, it } from 'vitest';
import { notificationCapabilities } from '../../../src/main/notifications/capabilities';
import { buildContent, channelSenderName, formatSummaryBody, truncateBody } from '../../../src/main/notifications/format';

const mac = notificationCapabilities('darwin');
const win = notificationCapabilities('win32');

describe('channelSenderName', () => {
  it('strips the name: prefix', () => expect(channelSenderName('name:Alice')).toBe('Alice'));
  it('is empty for unknown/self', () => {
    expect(channelSenderName('unknown')).toBe('');
    expect(channelSenderName(undefined)).toBe('');
  });
  it('shortens a raw pubkey', () => expect(channelSenderName('abcdef0123456789')).toBe('abcdef01…'));
});

describe('truncateBody', () => {
  it('leaves short bodies alone', () => expect(truncateBody('hi')).toBe('hi'));
  it('truncates long bodies to 240 with an ellipsis', () => {
    const out = truncateBody('x'.repeat(300));
    expect(out.length).toBe(238);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildContent — channel', () => {
  it('macOS: channel title + sender subtitle', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: 'Alice', mention: false, body: 'hi', caps: mac }))
      .toEqual({ title: '#general', subtitle: 'Alice', body: 'hi' });
  });
  it('macOS mention: appends the mention marker to the title, sender stays in subtitle', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: 'Alice', mention: true, body: 'hi', caps: mac }))
      .toEqual({ title: '#general • mention', subtitle: 'Alice', body: 'hi' });
  });
  it('Windows: folds sender into the title with a delimiter, no subtitle', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: 'Alice', mention: false, body: 'hi', caps: win }))
      .toEqual({ title: '#general — Alice', body: 'hi' });
  });
  it('Windows mention: delimiter + mention marker', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: 'Alice', mention: true, body: 'hi', caps: win }))
      .toEqual({ title: '#general — Alice • mention', body: 'hi' });
  });
  it('no sender: bare channel title', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: '', mention: false, body: 'hi', caps: win }))
      .toEqual({ title: '#general', body: 'hi' });
  });
});

describe('buildContent — DM', () => {
  it('uses the contact name as title with no subtitle on any platform', () => {
    expect(buildContent({ isChannel: false, displayName: 'Alice', senderName: '', mention: false, body: 'hi', caps: mac }))
      .toEqual({ title: 'Alice', body: 'hi' });
  });
});

describe('formatSummaryBody', () => {
  it('no senders', () => expect(formatSummaryBody(12, [])).toBe('12 new messages'));
  it('singular', () => expect(formatSummaryBody(1, [])).toBe('1 new message'));
  it('lists up to two senders then +N', () => {
    expect(formatSummaryBody(8, ['Alice', 'Bob', 'Carol', 'Dan'])).toBe('8 messages from Alice, Bob +2');
  });
});
