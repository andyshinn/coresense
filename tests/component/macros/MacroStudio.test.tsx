import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { type ApiClient, api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { MacroStudio } from '@/panels/macros/MacroStudio';
import type { MacroTemplate } from '../../../src/shared/macros/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };

const existing: MacroTemplate = {
  id: 'm1',
  name: 'Signal report',
  template: '{{ sender_name }}: {{ snr }} snr',
  scope: 'global',
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  useStore.setState({ channels: [], contacts: [] });
  vi.restoreAllMocks();
});

describe('MacroStudio', () => {
  it('shows a Create action and an empty editor for a new macro', () => {
    render(<MacroStudio client={client} macro={null} onClose={vi.fn()} />);
    expect((screen.getByTestId('macro-editor') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByRole('button', { name: /create macro/i })).toBeTruthy();
  });

  it('loads an existing macro into the editor and name field', () => {
    render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    expect((screen.getByTestId('macro-editor') as HTMLTextAreaElement).value).toBe(existing.template);
    expect((screen.getByTestId('macro-name') as HTMLInputElement).value).toBe('Signal report');
  });

  it('updates the rendered char count as the template changes', () => {
    render(<MacroStudio client={client} macro={null} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-editor'), { target: { value: 'hello' } });
    expect(screen.getByTestId('char-count').textContent).toContain('5');
  });

  it('inserts a variable from a quick chip at the caret', () => {
    render(<MacroStudio client={client} macro={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'sender_name' }));
    expect((screen.getByTestId('macro-editor') as HTMLTextAreaElement).value).toBe('{{ sender_name }}');
  });

  it('opens a variable autocomplete from a {{ tag and inserts the choice', async () => {
    render(<MacroStudio client={client} macro={null} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-editor'), {
      target: { value: '{{ peer_l', selectionStart: 9, selectionEnd: 9 },
    });
    fireEvent.mouseDown(await screen.findByRole('button', { name: /peer_last_seen/ }));
    expect((screen.getByTestId('macro-editor') as HTMLTextAreaElement).value).toBe('{{ peer_last_seen }}');
  });

  it('disables Save when the template is invalid', () => {
    render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-editor'), { target: { value: '{{ not_a_real_var }}' } });
    expect((screen.getByRole('button', { name: /save macro/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves an edited macro through updateMacro and closes', async () => {
    const spy = vi.spyOn(api, 'updateMacro').mockResolvedValue({ ...existing, name: 'Signal' });
    const onClose = vi.fn();
    render(<MacroStudio client={client} macro={existing} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('macro-name'), { target: { value: 'Signal' } });
    fireEvent.click(screen.getByRole('button', { name: /save macro/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toBe('m1');
    expect(spy.mock.calls[0][2]).toMatchObject({ name: 'Signal' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('creates a new macro through addMacro and closes', async () => {
    const spy = vi.spyOn(api, 'addMacro').mockResolvedValue({
      id: 'new',
      name: 'Beacon',
      template: '{{ my_name }}',
      scope: 'global',
      createdAt: 2,
      updatedAt: 2,
    });
    const onClose = vi.fn();
    render(<MacroStudio client={client} macro={null} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('macro-name'), { target: { value: 'Beacon' } });
    fireEvent.change(screen.getByTestId('macro-editor'), { target: { value: '{{ my_name }}' } });
    fireEvent.click(screen.getByRole('button', { name: /create macro/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toMatchObject({ name: 'Beacon', template: '{{ my_name }}', scope: 'global' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders the editor and the preview in a single stacked column', () => {
    const { container } = render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    expect(screen.getByTestId('macro-editor')).toBeTruthy();
    expect(screen.getByTestId('preview-output')).toBeTruthy();
    // No two-column grid: the body is a flex column.
    expect(container.querySelector('.lg\\:grid-cols-\\[1\\.1fr_1fr\\]')).toBeNull();
    const editor = screen.getByTestId('macro-editor');
    const preview = screen.getByTestId('preview-output');
    // The preview follows the editor in document order.
    expect(editor.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a non-blocking warning for an unknown filter key, and still allows saving', () => {
    render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-name'), { target: { value: 'Path' } });
    fireEvent.change(screen.getByTestId('macro-editor'), {
      target: { value: '{{ paths.first.hops | map: "pubkey" }}' },
    });
    expect(screen.getByTestId('preview-warnings').textContent).toContain('pubkey');
    expect(screen.getByTestId('preview-warnings').textContent).toContain('pk');
    expect((screen.getByRole('button', { name: /save macro/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows no warnings panel for a clean template', () => {
    render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-editor'), {
      target: { value: '{{ paths.first.hops | map: "short_id" }}' },
    });
    expect(screen.queryByTestId('preview-warnings')).toBeNull();
  });

  it('derives the preview caption from the sample context instead of hardcoding it', () => {
    render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('preview-mode-reply'));
    const caption = screen.getByTestId('preview-caption').textContent ?? '';
    expect(caption).toContain('Alice');
    expect(caption).toContain('2 hops'); // the sample path has 2 relay hops
  });
});
