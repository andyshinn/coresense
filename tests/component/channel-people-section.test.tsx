import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelPeopleBody, contactKeyForSender } from '@/shell/rightrail/sections/ChannelPeople';
import type { ChannelStats, Contact } from '../../src/shared/types';

const PK = 'a'.repeat(64);

const contact = (over: Partial<Contact> = {}): Contact => ({
  key: 'c:abc',
  publicKeyHex: 'abc',
  name: 'alice',
  kind: 'chat',
  ...over,
});

const stats = (): ChannelStats => ({
  count: 4,
  firstTs: 1,
  lastTs: 2,
  count24h: 0,
  count7d: 4,
  distinctSenders: 2,
  roster: [
    { fromPk: null, count: 1, lastTs: 1_700_000_000_000 },
    { fromPk: 'name:alice', count: 3, lastTs: 1_700_000_000_000 },
  ],
  perDay: [0, 0, 0, 0, 0, 0, 0],
});

describe('contactKeyForSender', () => {
  it('matches a named channel poster to a saved contact by name', () => {
    expect(contactKeyForSender('name:alice', [contact()])).toBe('c:abc');
  });

  it('returns null for a named poster with no matching contact', () => {
    expect(contactKeyForSender('name:bob', [contact()])).toBeNull();
  });

  it('returns null for self and unknown senders', () => {
    expect(contactKeyForSender(null, [contact()])).toBeNull();
    expect(contactKeyForSender('unknown', [contact()])).toBeNull();
  });

  it('routes a raw pubkey straight to its contact key', () => {
    expect(contactKeyForSender(PK, [])).toBe(`c:${PK}`);
  });
});

describe('ChannelPeopleBody', () => {
  it('renders the distinct-sender count and a roster row per sender', () => {
    render(<ChannelPeopleBody stats={stats()} loading={false} />);
    expect(screen.getByText('2 people seen')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // alice's message count
  });

  it('uses the singular for one person', () => {
    const s = stats();
    s.distinctSenders = 1;
    render(<ChannelPeopleBody stats={s} loading={false} />);
    expect(screen.getByText('1 person seen')).toBeTruthy();
  });

  it('renders a placeholder while loading', () => {
    render(<ChannelPeopleBody stats={null} loading={true} />);
    expect(screen.getByText('loading…')).toBeTruthy();
  });

  it('links a poster that resolves to a contact and navigates on click', () => {
    const onSelectContact = vi.fn();
    render(
      <ChannelPeopleBody
        stats={stats()}
        loading={false}
        resolveContactKey={(fromPk) => (fromPk === 'name:alice' ? 'c:abc' : null)}
        onSelectContact={onSelectContact}
      />,
    );
    // Self (null) is not navigable, so the resolved 'alice' row is the only button.
    fireEvent.click(screen.getByRole('button'));
    expect(onSelectContact).toHaveBeenCalledWith('c:abc');
  });

  it('shows a no-contact hover hint for a named poster we do not have saved', () => {
    const onSelectContact = vi.fn();
    const { container } = render(
      <ChannelPeopleBody stats={stats()} loading={false} resolveContactKey={() => null} onSelectContact={onSelectContact} />,
    );
    // 'name:alice' is unresolved: not a navigation button, but a hover-card trigger.
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-slot="hover-card-trigger"]')).toBeTruthy();
  });
});
