import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useStore } from '@/lib/store';
import { LeftNav } from '@/shell/leftnav';
import type { Channel, Contact } from '../../src/shared/types';

// LeftNav is composed of LeftNavSearch, ChannelsBranch, ContactsTree and
// ToolsGroup, with a single context-menu slot at the root. These pin the
// behaviour that crosses those seams.

const PK_A = 'a1'.repeat(32);
const PK_B = 'b2'.repeat(32);

const channel: Channel = { key: 'ch:Public', name: 'Public', kind: 'public', idx: 0 };
const contact = (pk: string, name: string): Contact => ({ key: `c:${pk}`, publicKeyHex: pk, name, kind: 'chat' });

function seed(over: { grouping?: 'nested' | 'top-level'; limit?: number } = {}) {
  const s = useStore.getState();
  useStore.setState({
    channels: [channel],
    contacts: [contact(PK_A, 'Alice'), contact(PK_B, 'Bob')],
    channelPresence: new Set([channel.key]),
    messagesByKey: {},
    transportState: 'connected',
    searchQuery: '',
    navPast: [],
    navFuture: [],
    ui: { ...s.ui, activeKey: channel.key, pinned: [] },
    appSettings: {
      ...s.appSettings,
      showLeftNavSearch: true,
      contactGrouping: over.grouping ?? 'nested',
      leftNavCollapseLists: { enabled: over.limit != null, limit: over.limit ?? 10 },
    },
  });
}

const renderNav = () =>
  render(
    <SidebarProvider>
      <LeftNav client={null} />
    </SidebarProvider>,
  );

beforeEach(() => seed());

describe('LeftNav', () => {
  it('jumps to search on typing and goes back on Escape', () => {
    renderNav();
    const input = screen.getByLabelText('Search messages, channels, and contacts');

    fireEvent.change(input, { target: { value: 'hello' } });
    expect(useStore.getState().ui.activeKey).toBe('tool:search');
    expect(useStore.getState().searchQuery).toBe('hello');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useStore.getState().ui.activeKey).toBe(channel.key);
    expect(useStore.getState().searchQuery).toBe('');
  });

  it('keeps at most one context menu open, switching between kinds', () => {
    renderNav();

    fireEvent.contextMenu(screen.getByText('Public'));
    expect(screen.getByText('Copy name')).toBeTruthy();

    fireEvent.contextMenu(screen.getByText('Alice'));
    expect(screen.getByText('Copy public key')).toBeTruthy();
    expect(screen.queryByText('Copy name')).toBeNull();
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });

  it('offers Add channel from the Channels row menu and opens the popover', () => {
    renderNav();
    fireEvent.contextMenu(screen.getByText('Channels'));
    act(() => {
      fireEvent.click(screen.getByText('Add channel…'));
    });
    expect(useStore.getState().addChannelOpen).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('caps a contact kind and reveals the rest on Show more', () => {
    seed({ limit: 1 });
    renderNav();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('Bob')).toBeNull();

    fireEvent.click(screen.getByText('Show 1 more'));
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('nests the kind groups under one Contacts branch, or lifts them to the top level', () => {
    const { unmount } = renderNav();
    expect(screen.getByText('Contacts')).toBeTruthy();
    expect(screen.getByText('Users')).toBeTruthy();
    unmount();

    seed({ grouping: 'top-level' });
    renderNav();
    expect(screen.queryByText('Contacts')).toBeNull();
    expect(screen.getByText('Users')).toBeTruthy();
  });
});
