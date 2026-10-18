import { act, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '@/components/messageListItems';
import type { Message } from '../../src/shared/types';

// The real list needs layout, so this stand-in just renders every seeded item
// through the ItemContent MessageList hands it, with the row context it builds.
// That is the hand-off under test: MessageList → ItemRow → MessageItem.
vi.mock('@virtuoso.dev/message-list', () => ({
  VirtuosoMessageListLicense: ({ children }: { children: React.ReactNode }) => children,
  VirtuosoMessageList: ({
    initialData,
    context,
    ItemContent,
  }: {
    initialData?: Item[];
    context: unknown;
    ItemContent: React.ComponentType<{ data: Item; index: number; context: unknown }>;
  }) => (
    <>
      {(initialData ?? []).map((data, index) => (
        <ItemContent key={data.kind === 'msg' ? data.m.id : data.id} data={data} index={index} context={context} />
      ))}
    </>
  ),
  scrollToBottomAlways: () => 'ALWAYS',
  scrollToBottomIfAtBottom: () => false,
}));

const { MessageList } = await import('@/components/MessageList');
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { useStore } = await import('@/lib/store');
const { fmtMessageTime } = await import('@/lib/time');

// Today at 13:05, so the 12h and 24h renderings differ.
const now = new Date();
const TS = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 5).getTime();
const message: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: TS, state: 'received' };

function renderList() {
  return render(
    <TooltipProvider>
      <MessageList
        conversationKey="ch:x"
        messages={[message]}
        contacts={[]}
        selectedId={null}
        onSelect={() => {}}
        style="rich"
        lastReadMs={0}
        onMarkRead={() => {}}
        onReact={() => {}}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useStore.setState((s) => ({ windowFocused: true, appSettings: { ...s.appSettings, timeFormat: '24h' } }));
});

describe('MessageList row hand-off', () => {
  // A dropped prop between the list's row context and MessageItem is exactly
  // the regression this threading invites — assert the flag survives it.
  it('suppresses the quick bar while the row context menu is open', async () => {
    renderList();
    expect(screen.getByTestId('message-quick-bar')).toBeTruthy();

    fireEvent.contextMenu(screen.getByText('hi'));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.queryByTestId('message-quick-bar')).toBeNull();

    // The menu attaches its dismiss listeners on the next tick.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('message-quick-bar')).toBeTruthy();
  });

  it('renders the clock in the stored time format', () => {
    renderList();
    expect(screen.getByText(fmtMessageTime(TS, '24h'))).toBeTruthy();
    expect(screen.queryByText(fmtMessageTime(TS, '12h'))).toBeNull();
  });
});
