import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { type ApiClient, api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { ComposerMacroPopover } from '@/panels/macros/inchat/ComposerMacroPopover';
import type { MacroTemplate } from '../../../src/shared/macros/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const macros: MacroTemplate[] = [
  { id: 'a', name: 'Signal report', template: '{{ snr }} snr', scope: 'global', createdAt: 0, updatedAt: 0 },
  { id: 'b', name: 'Relay path', template: 'heard via {{ paths }}', scope: 'global', createdAt: 0, updatedAt: 0 },
];

beforeEach(() => {
  useStore.setState({ macros, channels: [], contacts: [] });
  vi.restoreAllMocks();
});

describe('ComposerMacroPopover', () => {
  it('expands the chosen macro in send context and reports the rendered text', async () => {
    const renderSpy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'expanded text' });
    const onExpand = vi.fn();
    render(<ComposerMacroPopover query="" client={client} targetKey="c:abc" onExpand={onExpand} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /signal report/i }));
    await waitFor(() => expect(onExpand).toHaveBeenCalledWith('expanded text'));
    expect(renderSpy.mock.calls[0][1]).toMatchObject({ macroId: 'a', mode: 'send', contactKey: 'c:abc' });
  });

  it('filters macros by the slash query', () => {
    render(<ComposerMacroPopover query="relay" client={client} onExpand={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /signal report/i })).toBeNull();
    expect(screen.getByRole('button', { name: /relay path/i })).toBeTruthy();
  });
});
