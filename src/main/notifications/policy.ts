import type { AppSettings, ContactKind, Message } from '../../shared/types';

export type Kind = 'directMessage' | 'channelMention' | 'channelMessage' | 'repeaterAlert' | 'sensorAlert';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mention detection: @name, @[name], or the bare owner name on a word
// boundary. Case-insensitive.
export function mentionsOwner(body: string, ownerName: string): boolean {
  const lower = body.toLowerCase();
  const target = ownerName.toLowerCase();
  if (lower.includes(`@${target}`)) return true;
  if (lower.includes(`@[${target}]`)) return true;
  return new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i').test(body);
}

export function classify(m: Message, ownerName: string | undefined, contactKind: ContactKind | undefined): Kind {
  if (m.key.startsWith('c:')) {
    if (contactKind === 'repeater') return 'repeaterAlert';
    if (contactKind === 'sensor') return 'sensorAlert';
    return 'directMessage';
  }
  if (m.key.startsWith('ch:')) {
    if (ownerName && mentionsOwner(m.body, ownerName)) return 'channelMention';
    return 'channelMessage';
  }
  return 'directMessage';
}

export interface PolicyArgs {
  msg: Message;
  notifications: AppSettings['notifications'];
  ownerName: string | undefined;
  contactKind: ContactKind | undefined;
  muted: boolean;
  blocked: boolean;
  /** True when the app window is focused AND the user is viewing this key. */
  focused: boolean;
}

export function passesPolicy(a: PolicyArgs): { show: boolean; kind: Kind } {
  const kind = classify(a.msg, a.ownerName, a.contactKind);
  if (a.msg.state !== 'received') return { show: false, kind };
  if (a.blocked) return { show: false, kind };
  if (a.muted) return { show: false, kind };
  if (!a.notifications[kind]) return { show: false, kind };
  if (a.notifications.suppressWhenFocused && a.focused) return { show: false, kind };
  return { show: true, kind };
}
