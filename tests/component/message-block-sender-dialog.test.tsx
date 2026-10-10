import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/api';
import { notify } from '../support/notifyMock';

const addBlockRules = vi.fn();
vi.mock('@/lib/api', () => ({ api: { addBlockRules: (...a: unknown[]) => addBlockRules(...a) } }));
vi.mock('@/lib/notify', () => import('../support/notifyMock'));

const { BlockSenderDialog } = await import('@/components/BlockSenderDialog');

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };

beforeEach(() => {
  addBlockRules.mockReset().mockResolvedValue(undefined);
  vi.clearAllMocks();
});

describe('BlockSenderDialog', () => {
  it('turns each checked prefill identifier into one rule, in table order', async () => {
    const onClose = vi.fn();
    render(<BlockSenderDialog client={client} open prefill={{ name: 'Bob', pubkey: 'aa11' }} onClose={onClose} />);

    // Key prefix wasn't prefilled, so its row is disabled and contributes nothing.
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.slice(0, 3).map((b) => b.getAttribute('data-state'))).toEqual(['checked', 'unchecked', 'checked']);
    expect(boxes[1].hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const rules = addBlockRules.mock.calls[0][1] as Array<{ type: string; pattern: string; enabled: boolean }>;
    expect(rules.map((r) => [r.type, r.pattern, r.enabled])).toEqual([
      ['pubkey', 'aa11', true],
      ['name', 'Bob', true],
    ]);
    expect(notify.success).toHaveBeenCalledWith('Added 2 block rules');
  });

  it('unchecking an identifier drops its rule', async () => {
    const onClose = vi.fn();
    render(<BlockSenderDialog client={client} open prefill={{ name: 'Bob', pubkey: 'aa11' }} onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((addBlockRules.mock.calls[0][1] as Array<{ type: string }>).map((r) => r.type)).toEqual(['name']);
  });

  it('reports a failed submit through notify.failure', async () => {
    const err = new Error('boom');
    addBlockRules.mockRejectedValue(err);
    render(<BlockSenderDialog client={client} open prefill={{ name: 'Bob' }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(notify.failure).toHaveBeenCalledWith('Block', err));
  });

  // Uses the danger token like the rest of the app, not a raw Tailwind red.
  it('flags an invalid regex in the danger colour', () => {
    render(<BlockSenderDialog client={client} open prefill={{}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('checkbox')[3]);
    fireEvent.change(screen.getByPlaceholderText('^Bob.*$'), { target: { value: '(' } });
    expect(screen.getByText('Invalid regex').className).toContain('text-cs-danger');
  });
});
