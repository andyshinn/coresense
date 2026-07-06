import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { type ApiClient, api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { QuickReplyMenu } from '@/panels/macros/inchat/QuickReplyMenu';
import type { Message } from '../../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const message: Message = { id: 'msg1', key: 'c:abc', body: 'hi', ts: 0, state: 'received' };

beforeEach(() => {
  useStore.setState({
    macros: [{ id: 'a', name: 'Signal report', template: '{{ snr }} snr', scope: 'global', createdAt: 0, updatedAt: 0 }],
  });
  vi.restoreAllMocks();
});

describe('QuickReplyMenu', () => {
  it('renders a reply macro against the message and sends it', async () => {
    const renderSpy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'rendered reply' });
    const sendSpy = vi.spyOn(api, 'sendMessage').mockResolvedValue({ ok: true, id: 'x' });
    render(<QuickReplyMenu message={message} client={client} />);
    fireEvent.click(screen.getByRole('button', { name: /quick reply/i }));
    fireEvent.click(screen.getByRole('button', { name: /signal report/i }));
    await waitFor(() => expect(renderSpy).toHaveBeenCalled());
    expect(renderSpy.mock.calls[0][1]).toMatchObject({ macroId: 'a', mode: 'reply', messageId: 'msg1' });
    await waitFor(() => expect(sendSpy).toHaveBeenCalledWith(client, 'c:abc', 'rendered reply'));
  });

  it('shows an empty hint when there are no macros', () => {
    useStore.setState({ macros: [] });
    render(<QuickReplyMenu message={message} client={client} />);
    fireEvent.click(screen.getByRole('button', { name: /quick reply/i }));
    expect(screen.getByText(/no macros/i)).toBeTruthy();
  });
});
