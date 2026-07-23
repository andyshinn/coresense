import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageQuickBar } from '@/features/message-actions/MessageQuickBar';
import { type ApiClient, api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { DEFAULT_UI_STATE, type Message } from '../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const other: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };
const mine: Message = { id: 'm2', key: 'ch:x', body: 'yo', ts: 0, state: 'sent' };

// MessageQuickBar uses Radix Tooltip (via its IconBtn helper and ReactionRow),
// which requires an ancestor TooltipProvider (supplied in the real app by
// AppShell's SidebarProvider). Isolated component tests need to supply that
// context explicitly.
function renderBar(props: React.ComponentProps<typeof MessageQuickBar>) {
  return render(
    <TooltipProvider>
      <MessageQuickBar {...props} />
    </TooltipProvider>,
  );
}

const base = { message: other, isSelf: false, senderName: 'K5TH', client, onReact: () => {}, onReply: () => {} };

describe('MessageQuickBar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useStore.setState({ ui: { ...DEFAULT_UI_STATE }, macros: [] });
  });

  test('others: quick-react records usage and calls onReact', () => {
    const onReact = vi.fn();
    renderBar({ ...base, onReact });
    fireEvent.click(screen.getByRole('button', { name: 'Reply with 👍' }));
    expect(onReact).toHaveBeenCalledWith('K5TH', '👍');
    expect(useStore.getState().ui.emojiUsage['👍'].count).toBe(1);
  });

  test('others: Reply calls onReply', () => {
    const onReply = vi.fn();
    renderBar({ ...base, onReply });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith('K5TH');
  });

  test('self: shows Copy / Info / Delete and no Reply', () => {
    renderBar({ ...base, message: mine, isSelf: true, senderName: '' });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  test('hidden pill is non-interactive (pointer-events-none, not pinned open)', () => {
    renderBar(base);
    const bar = screen.getByTestId('message-quick-bar');
    expect(bar.className).toContain('pointer-events-none');
    expect(bar.getAttribute('data-open')).toBe('false');
  });

  test('with a client, the macro cluster is present', () => {
    renderBar(base);
    expect(screen.getByRole('button', { name: 'All macros' })).toBeTruthy();
  });

  test('without a client, the macro cluster is omitted (nothing can render)', () => {
    renderBar({ ...base, client: null });
    expect(screen.queryByRole('button', { name: 'All macros' })).toBeNull();
    // The rest of the bar is unaffected.
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });

  test('chips are the two most-frecent applicable macros', () => {
    useStore.setState({
      macros: [
        { id: 'a', name: 'Alpha', template: 'a', scope: 'global', createdAt: 0, updatedAt: 0 },
        { id: 'b', name: 'Bravo', template: 'b', scope: 'global', createdAt: 0, updatedAt: 0 },
        { id: 'c', name: 'Charlie', template: 'c', scope: 'global', createdAt: 0, updatedAt: 0 },
      ],
      ui: { ...DEFAULT_UI_STATE, macroUsage: { c: { count: 9, lastUsedMs: Date.now() } } },
    });
    renderBar(base);
    expect(screen.getByText('Charlie')).toBeTruthy(); // most-frecent leads
    expect(screen.getByText('Alpha')).toBeTruthy(); // then store order
    expect(screen.queryByText('Bravo')).toBeNull(); // only two chips
  });

  test('a chip click renders, records usage, and inserts into the composer', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'relaying now' });
    useStore.setState({
      macros: [{ id: 'a', name: 'Relaying', template: 'relaying now', scope: 'global', createdAt: 0, updatedAt: 0 }],
      ui: { ...DEFAULT_UI_STATE },
    });
    const onMacro = vi.fn();
    renderBar({ ...base, onMacro });
    fireEvent.click(screen.getByText('Relaying'));
    await waitFor(() => expect(onMacro).toHaveBeenCalledWith('K5TH', 'relaying now'));
    expect(useStore.getState().ui.macroUsage.a.count).toBe(1);
  });

  test('a failed render neither inserts nor records usage', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({
      ok: false,
      error: { kind: 'render', message: 'boom' },
    });
    useStore.setState({
      macros: [{ id: 'a', name: 'Relaying', template: 'relaying now', scope: 'global', createdAt: 0, updatedAt: 0 }],
      ui: { ...DEFAULT_UI_STATE },
    });
    const onMacro = vi.fn();
    renderBar({ ...base, onMacro });
    fireEvent.click(screen.getByText('Relaying'));
    await waitFor(() => expect(api.renderMacro).toHaveBeenCalled());
    expect(onMacro).not.toHaveBeenCalled();
    expect(useStore.getState().ui.macroUsage.a).toBeUndefined();
  });

  test('a contact-scoped macro does not appear on a channel message', () => {
    useStore.setState({
      macros: [
        { id: 'c1', name: 'ForKarin', template: 'x', scope: 'contact', contactKey: 'c:7b21', createdAt: 0, updatedAt: 0 },
      ],
      ui: { ...DEFAULT_UI_STATE },
    });
    renderBar(base); // message.key is 'ch:x'
    expect(screen.queryByText('ForKarin')).toBeNull();
  });
});
