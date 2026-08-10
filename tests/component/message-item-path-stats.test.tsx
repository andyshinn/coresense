import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MessageItem } from '@/components/MessageItem';
import { useStore } from '@/lib/store';
import type { Message, MessageHop, MessageStyle } from '../../src/shared/types';

const hop = (kind: MessageHop['kind'], shortId = 'xx'): MessageHop => ({ kind, shortId });

function msg(meta: Message['meta']): Message {
  return { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'name:nodey', body: 'hi', ts: 0, state: 'received', meta };
}

function renderItem(meta: Message['meta'], style: MessageStyle = 'rich') {
  return render(<MessageItem message={msg(meta)} isSelf={false} style={style} senderName="nodey" timeFormat="24h" />);
}

function badgeTexts(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-slot="badge"]')).map((b) => b.textContent);
}

beforeEach(() => {
  useStore.setState({ contacts: [], discovered: [] });
});

describe('MessageItem path stats', () => {
  it('renders the hop count as a badge, not as bare text', () => {
    const { container } = renderItem({
      paths: [{ id: 'p', hashMode: 2, finalSnr: 0, hops: [hop('origin'), hop('hop'), hop('hop'), hop('sink')] }],
    });
    expect(badgeTexts(container)).toContain('2h');
  });

  it('pairs the hop badge with the path-hash badge', () => {
    const { container } = renderItem({
      paths: [{ id: 'p', hashMode: 2, finalSnr: 0, hops: [hop('origin'), hop('hop'), hop('sink')] }],
    });
    expect(badgeTexts(container)).toContain('1h');
    expect(badgeTexts(container)).toContain('2b');
  });

  it('shows the hop badge but no hash badge when the mode was never observed', () => {
    const { container } = renderItem({ hops: 3 });
    expect(badgeTexts(container)).toContain('3h');
    expect(badgeTexts(container).some((t) => t?.endsWith('b'))).toBe(false);
  });

  it('renders no hop badge at all when there is no path data', () => {
    const { container } = renderItem(undefined);
    expect(badgeTexts(container).some((t) => t?.endsWith('h'))).toBe(false);
  });

  // The compact density reaches PathStatsMeta through TrailingMeta's own
  // `hasPath` gate, so it needs covering separately from rich.
  it('renders the badge in the compact density too', () => {
    const { container } = renderItem(
      { paths: [{ id: 'p', hashMode: 3, finalSnr: 0, hops: [hop('origin'), hop('hop'), hop('sink')] }] },
      'compact',
    );
    expect(badgeTexts(container)).toContain('1h');
    expect(badgeTexts(container)).toContain('3b');
  });
});
