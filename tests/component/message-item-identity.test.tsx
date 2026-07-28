import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import { useStore } from '@/lib/store';
import type { Message } from '../../src/shared/types';

const contact = { key: 'c:abc', publicKeyHex: 'abc', name: 'alice', kind: 'chat' as const };

const message: Message = {
  id: 'm1',
  key: 'ch:x',
  fromPublicKeyHex: 'name:alice',
  body: 'hi',
  ts: 0,
  state: 'received',
};

function setMode(identityColorMode: 'byKey' | 'byName') {
  useStore.setState((s) => ({ appSettings: { ...s.appSettings, identityColorMode } }));
}

beforeEach(() => {
  useStore.setState({ contacts: [], discovered: [] });
  setMode('byKey');
});

// MessageItem resolves identity exactly once, via `useIdentityHash(message.fromPublicKeyHex, senderName)`,
// and hands that SAME value to both ColoredUsername (via `identity`) and ContactAvatar (via `identity`) — see
// MessageItem.tsx. ColoredUsername/ContactAvatar never see `sender` here (MessageItem only ever passes `name`),
// so if MessageItem stopped threading `identity` through — or the override collapsed to `identity ?? resolvedHash` —
// both would fall back to ColoredUsername's own sender-based resolution, which is always neutral for this call
// site (sender is never passed) regardless of what's saved. That is the exact bug this task fixes; these tests
// pin the fix at the MessageItem level, not just inside ColoredUsername's own unit tests.
describe('MessageItem identity wiring (byKey)', () => {
  it('colours the author name and avatar when the poster resolves to a saved contact', () => {
    useStore.setState({ contacts: [contact] });
    const { container } = render(
      <MessageItem message={message} isSelf={false} style="rich" senderName="alice" timeFormat="24h" />,
    );
    expect(screen.getByText('alice').style.color).toBeTruthy();
    const avatar = container.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(avatar).toBeTruthy();
    expect(avatar?.style.color).toBeTruthy();
  });

  it('leaves the author name and avatar neutral when the poster is unresolvable', () => {
    const { container } = render(
      <MessageItem message={message} isSelf={false} style="rich" senderName="alice" timeFormat="24h" />,
    );
    expect(screen.getByText('alice').style.color).toBe('');
    const avatar = container.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(avatar).toBeTruthy();
    expect(avatar?.style.color).toBe('');
  });
});
