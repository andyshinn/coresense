import { describe, expect, it } from 'vitest';
import type { AppSettings, Message } from '../../../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';
import { classify, mentionsOwner, passesPolicy } from '../../../src/main/notifications/policy';

const notif: AppSettings['notifications'] = DEFAULT_APP_SETTINGS.notifications;
const msg = (over: Partial<Message>): Message => ({ id: 'm1', key: 'ch:general', body: 'hi', ts: 1, state: 'received', ...over });

describe('mentionsOwner', () => {
  it('matches @name, @[name], and a bare word', () => {
    expect(mentionsOwner('hey @bob', 'bob')).toBe(true);
    expect(mentionsOwner('hey @[bob] there', 'bob')).toBe(true);
    expect(mentionsOwner('bob around?', 'bob')).toBe(true);
    expect(mentionsOwner('bobby', 'bob')).toBe(false);
  });
});

describe('classify', () => {
  it('channel mention vs message', () => {
    expect(classify(msg({ body: 'yo @bob' }), 'bob', undefined)).toBe('channelMention');
    expect(classify(msg({ body: 'yo' }), 'bob', undefined)).toBe('channelMessage');
  });
  it('DM kinds by contact kind', () => {
    expect(classify(msg({ key: 'c:aa' }), 'bob', 'chat')).toBe('directMessage');
    expect(classify(msg({ key: 'c:aa' }), 'bob', 'repeater')).toBe('repeaterAlert');
    expect(classify(msg({ key: 'c:aa' }), 'bob', 'sensor')).toBe('sensorAlert');
  });
});

describe('passesPolicy', () => {
  const base = { notifications: notif, ownerName: 'bob', contactKind: undefined, muted: false, blocked: false, focused: false };
  it('shows a DM by default', () => {
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa' }), contactKind: 'chat' }).show).toBe(true);
  });
  it('drops non-received', () => {
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa', state: 'sending' }), contactKind: 'chat' }).show).toBe(false);
  });
  it('drops blocked, muted, and disabled-kind', () => {
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa' }), contactKind: 'chat', blocked: true }).show).toBe(false);
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa' }), contactKind: 'chat', muted: true }).show).toBe(false);
    // channelMessage is false by default
    expect(passesPolicy({ ...base, msg: msg({ body: 'yo' }) }).show).toBe(false);
  });
  it('suppresses when focused on the conversation', () => {
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa' }), contactKind: 'chat', focused: true }).show).toBe(false);
  });
});
